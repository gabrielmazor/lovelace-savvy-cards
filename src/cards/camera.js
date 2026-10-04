// savvy-camera-card: live cameras, and Frigate's recordings when the cameras come from it.
//
// Layout follows the card's width (a camera per ~380px, or `columns:`):
//   pager   one camera at a time, swipe between them; playback keeps its moment when you
//           swipe, so the same second can be seen from another angle
//   grid    every camera side by side, all live; playback is synced: the timeline, a
//           review, play / pause and the seek bar drive every camera at once
//
// `area` finds the room's cameras (or list them in `cameras`). Frigate turns itself on
// when the cameras come from the Frigate integration (`frigate: false` turns it off,
// `frigate: { instance: … }` names another instance). Through Home Assistant's own APIs:
//   reviews    frigate/reviews/get (alerts, detections), else frigate/events/get
//   activity   frigate/recordings/get: every segment's motion score is the activity graph
//   playback   Frigate's HLS playlist where the browser plays HLS (Safari, iOS), else the
//              MP4 the integration cuts; URLs signed with auth/sign_path
//
//   type: custom:savvy-camera-card
//   area: living_room                 recordings: popup | inline | false
//   audio_button: false               hides the speaker button (shown only when the stream has sound; always starts muted)

const DAY = 86400;
const TILE_MIN = 380;         // px of card width per camera before the grid adds a column
const REFRESH_MS = 60000;     // today's reviews/activity, while on screen
const SUMMARY_MS = 600000;
const SIGN_TTL = 3600;
const PAD_S = 3;              // seconds of context either side of a review
const DRIFT_S = 0.45;         // synced playback: re-align a camera further off than this
const BUCKETS = 288;          // activity graph: 5-minute buckets

const MOTION = {
  press:   { response: 0.12, damping: 1 },
  release: { response: 0.3,  damping: 0.82 },
  ui:      { response: 0.4,  damping: 1 },
  pager:   { response: 0.42, damping: 0.86 },
  pill:    { response: 0.34, damping: 0.82 },
  scrub:   { response: 0.1,  damping: 1 },
  drag:    { response: 0.34, damping: 1 },
  graph:   { response: 0.7,  damping: 1 },
  sheetIn:  { response: 0.38, damping: 0.82 },
  sheetOut: { response: 0.24, damping: 1 },
};

const COLORS = { live: TONE.bad, alert: TONE.bad, detection: TONE.warn };

const LABEL_ICONS = {
  person: "mdi:account", car: "mdi:car", motorcycle: "mdi:motorbike", bicycle: "mdi:bicycle",
  dog: "mdi:dog", cat: "mdi:cat", bird: "mdi:bird", package: "mdi:package-variant-closed",
  face: "mdi:face-recognition", license_plate: "mdi:card-text-outline", speech: "mdi:account-voice",
};



const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (s) => { const d = new Date(s * 1000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const mmss = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`;
};
const span = (s) => {
  const m = Math.round(s / 60);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
const dayStart = (offset) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return d.getTime() / 1000;
};
const ymd = (s) => { const d = new Date(s * 1000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nowS = () => Date.now() / 1000;
const parseWS = (r) => (typeof r === "string" ? JSON.parse(r) : r) || [];

const STYLE = `
:host {
  display: block; -webkit-tap-highlight-color: transparent;
  /* repeated here from ha-card so the recordings popup, which lives outside it, matches */
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --live: ${COLORS.live};
  --alert-c: ${COLORS.alert};
  --det-c: ${COLORS.detection};
  --accent: 88 142 233;
}
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }

ha-card {
  --radius: var(--ha-card-border-radius, 18px);
  --pad: 12px;
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --live: ${COLORS.live};
  --alert-c: ${COLORS.alert};
  --det-c: ${COLORS.detection};
  --accent: 88 142 233;
  position: relative;
  box-sizing: border-box;
  display: flex; flex-direction: column; gap: 10px;
  padding: var(--pad);
  border-radius: var(--radius);
  border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--line));
  background: var(--ha-card-background, var(--card-background-color));
  box-shadow: var(--ha-card-box-shadow, none);
  color: var(--primary-text-color);
  font-family: var(--camera-card-font-family, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  isolation: isolate;
  container-type: inline-size;
  transition: background-color 240ms ease, border-color 240ms ease;
}
@supports (corner-shape: squircle) {
  ha-card { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); }
}
:host([dark]) ha-card::after {
  content: ""; position: absolute; inset: 0; z-index: 9;
  border-radius: inherit; corner-shape: inherit;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
  pointer-events: none;
}

/* ---------- stage: pager (one camera) or grid (all cameras) ---------- */
.stage { position: relative; user-select: none; -webkit-user-select: none; }
:host(:not([grid])) .stage {
  overflow: hidden; border-radius: calc(var(--radius) * 0.72); aspect-ratio: var(--ar, 16 / 9);
  background: #000; touch-action: pan-y;
}
:host(:not([grid])) .track { position: absolute; inset: 0; display: flex; will-change: transform; }
:host(:not([grid])) .tile { flex: 0 0 100%; height: 100%; }
:host([grid]) .stage { display: flex; flex-direction: column; gap: 8px; }
:host([grid]) .track { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 8px; }
:host([grid]) .tile { aspect-ratio: var(--ar, 16 / 9); border-radius: calc(var(--radius) * 0.72); }
@supports (corner-shape: squircle) {
  :host(:not([grid])) .stage, :host([grid]) .tile { corner-shape: squircle; border-radius: calc(var(--radius) * 1.2); }
}

.tile { position: relative; overflow: hidden; background: #111; color: #fff; transform-origin: 50% 50%; }
.tile img.still, .tile .live, .tile ha-camera-stream {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;
}
.tile ha-camera-stream { --video-max-height: 100%; }
.tile .ph {
  position: absolute; inset: 0; display: grid; place-items: center; gap: 6px; align-content: center;
  color: rgb(255 255 255 / 0.55); font-size: 12px; font-weight: 550; --mdc-icon-size: 28px;
}
.player { position: absolute; inset: 0; background: #000; }
.player video { width: 100%; height: 100%; object-fit: contain; display: block; }

.shade-top, .shade-bot { position: absolute; left: 0; right: 0; pointer-events: none; }
.shade-top { top: 0; height: 64px; background: linear-gradient(rgb(0 0 0 / 0.45), transparent); }
.shade-bot { bottom: 0; height: 84px; background: linear-gradient(transparent, rgb(0 0 0 / 0.62)); }

.tl-row { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; align-items: center; gap: 6px; pointer-events: none; }
.badge {
  display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 8px;
  background: rgb(0 0 0 / 0.42); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase;
  white-space: nowrap; --mdc-icon-size: 14px; min-width: 0;
}
.badge .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 3px rgb(224 102 102 / 0.28); flex: none; }
.badge .pi { display: none; }
.badge[data-mode="play"] { text-transform: none; letter-spacing: -0.003em; font-size: 12px; padding-left: 6px; }
.badge[data-mode="play"] .pi { display: flex; }
.badge[data-mode="play"] .dot { display: none; }
.det { background: color-mix(in oklab, var(--det-c) 78%, black); }
.spacer { flex: 1; }

.bot-row {
  position: absolute; left: 12px; right: 8px; bottom: 9px; display: flex; align-items: flex-end; gap: 8px;
  pointer-events: none;
}
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; text-shadow: 0 1px 2px rgb(0 0 0 / 0.4); }
.who b { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who span { font-size: 12px; line-height: 16px; font-weight: 500; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:host(:not([grid])) .tile[data-playing] .bot-row { display: none; }
.dots { position: absolute; left: 50%; top: 19px; transform: translateX(-50%); display: flex; gap: 5px; pointer-events: none; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: rgb(255 255 255 / 0.4); }
.dots i[data-on] { background: #fff; }
:host([grid]) .dots, :host([playing]) .dots { display: none; }
.iconbtn[hidden] { display: none; }
.iconbtn {
  pointer-events: auto; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
  background: rgb(0 0 0 / 0.38); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  --mdc-icon-size: 19px; color: #fff; flex: none; transform-origin: 50% 50%;
}

.msg {
  position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 8px;
  text-align: center; padding: 14px 16px 56px; font-size: 13px; line-height: 17px; font-weight: 550; color: rgb(255 255 255 / 0.88);
  background: rgb(0 0 0 / 0.55); --mdc-icon-size: 26px;
}
:host([grid]) .msg { padding-bottom: 14px; }
.msg .mt { max-width: 34ch; }
.msgd { max-width: 44ch; font-size: 11px; line-height: 14px; font-weight: 500; color: rgb(255 255 255 / 0.6);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }

/* playback controls: overlaid in the pager, their own row under the grid */
.ctrl {
  position: absolute; left: 8px; right: 8px; bottom: 8px; height: 40px; box-sizing: border-box; z-index: 2;
  display: flex; align-items: center; gap: 8px; padding: 0 6px 0 4px; border-radius: 13px; color: #fff;
  background: rgb(0 0 0 / 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
}
:host([grid]) .ctrl { position: static; background: var(--well); color: var(--primary-text-color); backdrop-filter: none; -webkit-backdrop-filter: none; }
.snd[data-on] { background: rgb(255 255 255 / 0.24); }
.ctrl .snd[data-on] { background: color-mix(in oklab, currentColor 16%, transparent); }
.ctrl .iconbtn { background: none; backdrop-filter: none; -webkit-backdrop-filter: none; width: 32px; height: 32px; color: inherit; }
.bar { position: relative; flex: 1; height: 28px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
.bar .rail { position: absolute; left: 0; right: 0; height: 4px; border-radius: 2px; background: color-mix(in oklab, currentColor 25%, transparent); overflow: hidden; }
.bar .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: currentColor; transform-origin: 0 50%; }
.bar .knob { position: absolute; left: 0; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: currentColor; box-shadow: 0 1px 3px rgb(0 0 0 / 0.4); }
.ctime { font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap; min-width: 34px; text-align: end; }
.sync { font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; opacity: 0.7; white-space: nowrap; }
.livebtn {
  height: 28px; padding: 0 10px; border-radius: 9px; display: flex; align-items: center; gap: 6px;
  background: color-mix(in oklab, currentColor 16%, transparent); font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  pointer-events: auto; transform-origin: 50% 50%; flex: none;
}
.livebtn .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); }

/* ---------- camera picker (pager only) ---------- */
.pills { position: relative; display: flex; gap: 2px; padding: 3px; border-radius: 13px; background: var(--well); }
:host([grid]) .pills { display: none; }
.pills .ind {
  position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 10px; pointer-events: none;
  background: var(--card-background-color, #fff);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 0 0 0.5px var(--line);
}
:host([dark]) .pills .ind { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
.pill {
  position: relative; flex: 1 1 0; min-width: 0; height: 30px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em;
  color: var(--secondary-text-color); --mdc-icon-size: 16px; white-space: nowrap;
}
.pill span { overflow: hidden; text-overflow: ellipsis; }
.pill[aria-selected="true"] { color: var(--primary-text-color); }

/* ---------- timeline ---------- */
.tlhead { display: flex; align-items: center; gap: 4px; min-width: 0; }
.step {
  width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center;
  --mdc-icon-size: 20px; color: var(--primary-text-color); transform-origin: 50% 50%;
}
.step[disabled] { opacity: 0.3; cursor: default; }
.dayname { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; min-width: 0; white-space: nowrap; }
.daysum { flex: 1; text-align: end; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tl { position: relative; height: 44px; cursor: pointer; touch-action: none; border-radius: 11px; background: var(--well); outline-offset: 2px; }
.tl .hours { position: absolute; inset: 0; display: flex; border-radius: inherit; overflow: hidden; }
.tl .hours i { flex: 1; border-inline-start: 1px solid color-mix(in oklab, var(--primary-text-color) 5%, transparent); }
.tl .hours i:first-child { border: 0; }
.tl .hours i[data-norec] {
  background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklab, var(--primary-text-color) 7%, transparent) 4px 5px);
}
.tl .act { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; width: 100%; border-radius: 0 0 11px 11px; overflow: hidden; pointer-events: none; }
.tl .act path { fill: color-mix(in oklab, var(--primary-text-color) 22%, transparent); }
.tl .future { position: absolute; top: 0; bottom: 0; right: 0; border-radius: 0 11px 11px 0;
  background: var(--card-background-color, transparent); opacity: 0.55; }
.tl .marks { position: absolute; inset: 6px 0 auto; height: 10px; }
.tl .mk { position: absolute; top: 0; height: 10px; min-width: 4px; margin-left: -2px; border-radius: 3px; background: var(--det-c); }
.tl .mk[data-sev="alert"] { background: var(--alert-c); }
.tl .mk[data-dim] { opacity: 0.2; }
.tl .ph { position: absolute; top: -3px; bottom: -3px; left: 0; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--primary-text-color); pointer-events: none; opacity: 0; }
.tl .now { position: absolute; top: 4px; bottom: 4px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--live); pointer-events: none; }
.tl .bubble {
  position: absolute; bottom: calc(100% + 6px); left: 0; transform: translateX(-50%);
  padding: 3px 8px; border-radius: 8px; white-space: nowrap; pointer-events: none; opacity: 0;
  font-size: 12px; line-height: 16px; font-weight: 650;
  background: color-mix(in oklab, var(--card-background-color, canvas) 80%, var(--primary-text-color) 20%);
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.2);
}
.axis { display: flex; justify-content: space-between; margin-top: -6px; padding: 0 2px;
  font-size: 10.5px; line-height: 13px; font-weight: 550; letter-spacing: 0.006em; color: var(--secondary-text-color); }
.axis i { font-style: normal; }
.legend { display: flex; gap: 12px; margin-top: -4px; font-size: 11px; line-height: 13px; font-weight: 550; color: var(--secondary-text-color); }
.legend span { display: flex; align-items: center; gap: 5px; }
.legend i { width: 10px; height: 6px; border-radius: 2px; }
.legend .l-a { background: var(--alert-c); }
.legend .l-d { background: var(--det-c); }
.legend .l-m { background: color-mix(in oklab, var(--primary-text-color) 30%, transparent); }

/* ---------- reviews ---------- */
.filters, .reviews {
  display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  padding: 3px; margin: -3px;
}
.filters::-webkit-scrollbar, .reviews::-webkit-scrollbar { display: none; }
.filters[data-overflow], .reviews[data-overflow] {
  mask-image: linear-gradient(to left, transparent 0, #000 26px);
  -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px);
}
.chip {
  flex: none; height: 30px; padding: 0 11px 0 9px; border-radius: 10px; display: flex; align-items: center; gap: 5px;
  background: var(--well); font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em;
  color: var(--secondary-text-color); --mdc-icon-size: 16px; white-space: nowrap; transform-origin: 50% 50%;
}
.chip[aria-pressed="true"] { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); color: var(--primary-text-color); }
.chip .n { font-weight: 500; opacity: 0.7; }

.rv { flex: none; width: 132px; display: flex; flex-direction: column; gap: 5px; text-align: start; transform-origin: 50% 50%; }
.rv .th {
  position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 11px; overflow: hidden;
  background: var(--well); display: grid; place-items: center; --mdc-icon-size: 22px; color: var(--secondary-text-color);
}
.rv .th img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.rv[data-active] .th { box-shadow: 0 0 0 2px var(--primary-text-color); }
.rv .lbl {
  position: absolute; left: 5px; bottom: 5px; height: 20px; padding: 0 6px 0 4px; border-radius: 6px;
  display: flex; align-items: center; gap: 3px; color: #fff; background: rgb(0 0 0 / 0.5);
  font-size: 11px; font-weight: 650; --mdc-icon-size: 13px;
}
.rv .new { position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--det-c); box-shadow: 0 0 0 2px rgb(0 0 0 / 0.35); }
.rv[data-sev="alert"] .new { background: var(--alert-c); }
.rv .meta { display: flex; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: -0.003em; min-width: 0; }
.rv .meta .d { font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.note { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); padding: 2px; }

:host(:not([kbd])) :focus { outline: none; }
:host([kbd]) :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; }
@media (prefers-contrast: more) {
  ha-card { border-width: 1.5px; }
  .daysum, .axis, .legend, .note, .rv .meta .d { color: var(--primary-text-color); opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) { ha-card { transition: none; } }

/* ---------- recordings button: the timeline and reviews open from here ---------- */
.recbtn {
  display: flex; align-items: center; gap: 9px; min-width: 0; height: 40px; padding: 0 10px 0 12px;
  border-radius: 12px; background: var(--well); color: var(--primary-text-color);
  font-size: 13.5px; line-height: 17px; font-weight: 600; letter-spacing: -0.008em;
  transform-origin: 50% 50%;
}
.recbtn ha-icon { --mdc-icon-size: 18px; display: flex; flex: none; color: var(--secondary-text-color); }
.recbtn .rl { flex: none; }
.recbtn .rsum {
  flex: 1; min-width: 0; text-align: end; font-size: 12px; font-weight: 500; color: var(--secondary-text-color);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ---------- popup (CARD-DESIGN.md 8): outside ha-card, position: fixed ---------- */
.dscrim { position: fixed; inset: 0; z-index: 998; background: rgb(0 0 0 / 0.45); opacity: 0; }
.dlg {
  position: fixed; z-index: 999; box-sizing: border-box; display: flex; flex-direction: column;
  left: 50%; top: 50%; width: min(560px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 48px));
  border-radius: 22px; overflow: hidden; opacity: 0;
  background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line);
  font-family: var(--camera-card-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
}
@supports (corner-shape: squircle) { .dlg { corner-shape: squircle; border-radius: 36px; } }
/* phones: a bottom sheet you can reach with a thumb */
.dlg[data-sheet] { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 85vh; border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); }
.dlg .grab { align-self: center; width: 36px; height: 5px; border-radius: 3px; margin: 7px 0 -3px; background: color-mix(in oklab, var(--primary-text-color) 20%, transparent); }
.dlg:not([data-sheet]) .grab { display: none; }
.dh { display: flex; align-items: center; gap: 8px; padding: 14px 12px 8px 18px; }
.dh .dt { flex: 1; font-size: 18px; line-height: 23px; font-weight: 650; letter-spacing: -0.022em; }
.dh .dx { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--well); --mdc-icon-size: 18px; transform-origin: 50% 50%; }
/* its own container, so the card's width breakpoints follow the popup's width */
.db { overflow: auto; overscroll-behavior: contain; padding: 4px 16px 18px; display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }

@container (max-width: 380px) {
  .pill ha-icon { display: none; }
  .rv { width: 116px; }
  .sync { display: none; }
}
@container (max-width: 300px) {
  .who span { display: none; }
  .ctime { display: none; }
  .axis i:nth-child(even) { visibility: hidden; }
}
`;

const TILE_HTML = `
  <img class="still" alt="" hidden>
  <div class="ph" hidden><ha-icon icon="mdi:cctv-off"></ha-icon><span></span></div>
  <div class="player" hidden><video playsinline muted preload="auto"></video></div>
  <div class="shade-top"></div><div class="shade-bot"></div>
  <div class="tl-row">
    <span class="badge"><span class="dot"></span><ha-icon class="pi" icon="mdi:play"></ha-icon><span class="bt">Live</span></span>
    <span class="spacer"></span>
    <span class="badge det" hidden><ha-icon></ha-icon><span></span></span>
  </div>
  <div class="bot-row">
    <span class="who"><b></b><span></span></span>
    <button class="iconbtn snd" aria-label="Unmute" aria-pressed="false" hidden><ha-icon icon="mdi:volume-off"></ha-icon></button>
    <button class="iconbtn fs" aria-label="Full screen"><ha-icon icon="mdi:fullscreen"></ha-icon></button>
  </div>
  <div class="msg" hidden><ha-icon icon="mdi:filmstrip-off"></ha-icon><span class="mt"></span><span class="msgd" hidden></span></div>`;

// the <video> inside Home Assistant's camera player, whose real element sits a few shadow roots down
function deepVideo(node) {
  if (!node) return null;
  if (node.localName === "video") return node;
  for (const k of [node.shadowRoot, ...(node.children || [])]) {
    const v = deepVideo(k);
    if (v) return v;
  }
  return null;
}

class SavvyCameraCard extends HTMLElement {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).some((id) => domainOf(id) === "camera"));
    if (a) return { area: a.id };
    const cam = Object.keys(hass?.states || {}).find((id) => id.startsWith("camera."));
    return cam ? { cameras: [cam] } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._onHidden = () => { if (document.hidden) this._muteAll(); };
    this._onscreen = true;
    this._index = 0;
    this._day = 0;
    this._filter = "all";
    this._mode = "live";
    this._cols = 1;
    this._signed = new Map();      // path -> { url, until }
    this._reviews = new Map();     // scope|day -> { at, items, source, error }
    this._summary = new Map();     // cam -> { at, days }
    this._motion = new Map();      // cam|day -> { at, rows: [[start, end, motion]], last }
  }

  setConfig(config) {
    if (!config?.cameras && !config?.entity && !config?.area && !config?.areas) throw new Error('savvy-camera-card: set an "area" (or "cameras")');
    this._given = config;
    this._sig = null;
    if (this._hass) this.hass = this._hass;
  }

  // The cameras (given, else the area's) and whether Frigate is on (given, else found
  // from the cameras' integration). -> true when that changed.
  _resolve(hass) {
    const g = this._given;
    let cams = asItems(g.cameras || g.entity);
    if (!cams.length) {
      cams = [].concat(g.area || g.areas || []).flatMap((a) => pick(hass, areaEntities(hass, a), { domains: "camera" })
        .sort((x, y) => (hass.states[x].attributes.friendly_name || x).localeCompare(hass.states[y].attributes.friendly_name || y))
        .map((entity) => ({ entity, area: a })));
    }
    const found = cams.some((c) => hass.entities?.[c.entity]?.platform === "frigate");
    const fr = g.frigate === false ? false
      : g.frigate && typeof g.frigate === "object" ? { instance: "frigate", ...g.frigate }
      : g.frigate === true || found ? { instance: "frigate" } : false;
    const sig = JSON.stringify([cams, fr, g]);
    if (sig === this._sig) return false;
    this._sig = sig;
    this._config = { days: 7, columns: "auto", ...g, cameras: cams, frigate: fr };
    // recordings: popup (default) | inline (the timeline and reviews in the card) | false
    this._recMode = !fr || g.recordings === false ? false : g.recordings === "inline" ? "inline" : "popup";
    this._index = clamp(this._index || 0, 0, Math.max(0, cams.length - 1));
    return true;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._given) return;
    const changed = this._resolve(hass);
    if (!this._config.cameras.length) return this._renderMissing();
    if (!this._root || changed || this._missing) { this._missing = false; this._build(); }
    for (const t of this._tiles || []) if (t.liveEl) t.liveEl.hass = hass;
    this._update();
    if (first || changed) this._loadAll();
  }

  _renderMissing() {
    this._missing = true;
    this._root = this.shadowRoot || this.attachShadow({ mode: "open" });
    const where = this._given.area ? ` in ${esc(areaInfo(this._hass, this._given.area).name)}` : "";
    this._root.innerHTML = `<style>${BASE_CSS} ha-card { padding: 16px; font-size: 13px; color: var(--secondary-text-color); }</style><ha-card>No cameras${where}.</ha-card>`;
  }

  connectedCallback() {
    this._observe();
    this._timer = this._timer || setInterval(() => this._refresh(), REFRESH_MS);
    this._soundTimer = this._soundTimer || setInterval(() => this._syncSound(), 1000);
    document.addEventListener("visibilitychange", this._onHidden);
    this._wake();
  }
  disconnectedCallback() {
    clearInterval(this._soundTimer);
    this._soundTimer = 0;
    document.removeEventListener("visibilitychange", this._onHidden);
    Clock.remove(this._job);
    this._io?.disconnect();
    this._ro?.disconnect();
    clearInterval(this._timer);
    this._timer = 0;
    for (const t of this._tiles || []) { this._dropLive(t); this._stopVideo(t); }
    this._closeDialog(true);
    this._finishClosing();
  }

  getCardSize() { return this._recMode === "inline" ? 8 : 5; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  get _grid() { return this._cols > 1; }
  get _cam() { return this._config.cameras[this._index]; }
  // the cameras currently on screen: all of them in the grid, the selected one otherwise
  _active() { return this._grid ? this._config.cameras.map((_, i) => i) : [this._index]; }
  _fcam(cam = this._cam) { return cam.frigate_camera || cam.entity.split(".")[1]; }
  _scope() { return this._active().map((i) => this._fcam(this._config.cameras[i])); }
  _camName(cam) {
    const st = this._hass?.states[cam.entity];
    if (cam.name) return cam.name;
    if (cam.area && this._hass?.areas?.[cam.area]?.name) return this._hass.areas[cam.area].name;
    return st?.attributes.friendly_name || title(cam.entity.split(".")[1]);
  }
  _camByFrigate(name) { return this._config.cameras.find((c) => this._fcam(c) === name); }

  // ---------- build ----------
  _build() {
    this._root = this._shadow || (this._shadow = this.attachShadow({ mode: "open" }));
    for (const t of this._tiles || []) { this._dropLive(t); this._stopVideo(t); }
    this._springs = [];
    this._pressNodes = [];
    const cams = this._config.cameras;
    const fr = !!this._config.frigate;
    const popup = this._recMode === "popup";
    this._closeDialog(true);
    this._finishClosing();
    const ar = String(this._config.aspect_ratio || "16/9").replace(/\s*[/:x]\s*/, " / ");

    this._root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="stage" id="stage" role="group" aria-roledescription="camera viewer" style="--ar:${ar}">
          <div class="track" id="track">
            ${cams.map((c, i) => `<div class="tile" data-i="${i}">${TILE_HTML}</div>`).join("")}
          </div>
          <span class="dots" id="dots" ${cams.length > 1 ? "" : "hidden"}>${cams.map(() => "<i></i>").join("")}</span>
          <div class="ctrl" id="ctrl" hidden>
            <button class="iconbtn" id="pp" aria-label="Pause"><ha-icon id="ppIcon" icon="mdi:pause"></ha-icon></button>
            <div class="bar" id="bar" role="slider" tabindex="0" aria-label="Playback position">
              <div class="rail"><div class="fill" id="fill"></div></div><div class="knob" id="knob"></div>
            </div>
            <span class="ctime" id="ctime"></span>
            <button class="iconbtn snd" id="snd" aria-label="Unmute" aria-pressed="false" hidden><ha-icon icon="mdi:volume-off"></ha-icon></button>
            <span class="sync" id="sync" hidden>Synced</span>
            <button class="livebtn" id="live"><span class="dot"></span>Live</button>
          </div>
        </div>
        <div class="pills" id="pills" role="tablist" ${cams.length > 1 ? "" : "hidden"}>
          <span class="ind" id="ind"></span>
          ${cams.map((c, i) => `<button class="pill" role="tab" data-i="${i}"><ha-icon></ha-icon><span></span></button>`).join("")}
        </div>
        <button class="recbtn" id="recBtn" aria-haspopup="dialog" ${popup ? "" : "hidden"}>
          <ha-icon icon="mdi:history"></ha-icon><span class="rl">Recordings</span><span class="rsum" id="recSum"></span>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
        ${popup ? '<div id="holder" hidden>' : ""}
        <div id="rec" ${this._recMode ? "" : "hidden"} style="display:contents">
          <div class="tlhead">
            <button class="step" id="prev" aria-label="Previous day"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
            <span class="dayname" id="dayname"></span>
            <button class="step" id="next" aria-label="Next day"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
            <span class="daysum" id="daysum"></span>
          </div>
          <div class="tl" id="tl" role="slider" tabindex="0" aria-label="Recording timeline" aria-valuemin="0" aria-valuemax="86400">
            <div class="hours" id="hours">${"<i></i>".repeat(24)}</div>
            <svg class="act" id="act" viewBox="0 0 ${BUCKETS} 100" preserveAspectRatio="none" aria-hidden="true"><path id="actPath" d=""></path></svg>
            <div class="future" id="future"></div>
            <div class="marks" id="marks"></div>
            <div class="now" id="now"></div>
            <div class="ph" id="playhead"></div>
            <div class="bubble" id="bubble"></div>
          </div>
          <div class="axis"><i>00</i><i>06</i><i>12</i><i>18</i><i>24</i></div>
          <div class="legend" id="legend" hidden>
            <span><i class="l-m"></i>Motion</span><span><i class="l-d"></i>Detection</span><span><i class="l-a"></i>Alert</span>
          </div>
          <div class="filters" id="filters"></div>
          <div class="reviews" id="reviews" role="list"></div>
          <div class="note" id="note" hidden></div>
        </div>
        ${popup ? "</div>" : ""}
      </ha-card>`;

    const $ = (id) => this._root.getElementById(id);
    const ids = ["stage", "track", "dots", "ctrl", "pp", "ppIcon", "bar", "fill", "knob", "ctime", "snd", "sync", "live",
      "pills", "ind", "prev", "next", "dayname", "daysum", "tl", "hours", "act", "actPath", "future", "marks",
      "now", "playhead", "bubble", "legend", "filters", "reviews", "note", "rec", "recBtn", "recSum", "holder"];
    this._el = Object.fromEntries(ids.map((id) => [id, $(id)]));
    this._el.card = this._root.querySelector("ha-card");
    // a camera card shows no name of its own (each camera names itself), so a title is its own line, which can link
    mountTitleLine(this._root, this._el.card, this._config, (el, onTap) => this._press(el, onTap, { haptic: null }));
    this._el.pillBtns = [...this._root.querySelectorAll(".pill")];

    this._tiles = [...this._root.querySelectorAll(".tile")].map((node, i) => {
      const q = (s) => node.querySelector(s);
      const t = {
        i, cam: cams[i], node,
        still: q("img.still"), ph: q(".ph"), phText: q(".ph span"), player: q(".player"), video: q("video"),
        badge: q(".badge"), badgeText: q(".badge .bt"), det: q(".det"), detIcon: q(".det ha-icon"), detText: q(".det span"),
        name: q(".who b"), status: q(".who span"), fs: q(".fs"), snd: q(".snd"), sound: false,
        msg: q(".msg"), msgIcon: q(".msg ha-icon"), msgText: q(".msg .mt"), msgDetail: q(".msg .msgd"),
        liveEl: null, liveFor: null,
      };
      this._wireVideo(t);
      this._press(t.fs, () => this._fullscreen(t));
      this._press(t.snd, () => this._setSound(t, !t.sound));
      return t;
    });

    this._pager = new Spring(this._index, MOTION.pager, "pager");
    this._indX = new Spring(0, MOTION.pill, "pill");
    this._indW = new Spring(0, MOTION.pill, "pill");
    this._scrub = new Spring(0, MOTION.scrub, "scrub");
    this._head = new Spring(0, MOTION.drag, "head");
    this._headOn = new Spring(0, MOTION.ui, "head");
    this._actIn = new Spring(0, MOTION.graph, "act");
    this._springs.push(this._pager, this._indX, this._indW, this._scrub, this._head, this._headOn, this._actIn);
    this._pillReady = false;
    this._laidOut = false;

    this._wireStage();
    this._wireTimeline();
    this._wireBar();
    this._el.pillBtns.forEach((b, i) => this._press(b, () => this._select(i)));
    this._press(this._el.prev, () => this._stepDay(1));
    this._press(this._el.next, () => this._stepDay(-1));
    this._press(this._el.live, () => this._goLive());
    this._press(this._el.pp, () => this._togglePlay());
    this._press(this._el.snd, () => { const l = this._lead(); if (l) this._setSound(l, !l.sound); });
    if (popup) this._press(this._el.recBtn, () => this._openRec());

    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => {
      this._layout();
      this._pillReady = false;
      this._fitRows();
      this._renderActivity();
      this._paint(null);
      this._wake();
    });
    this._ro.observe(this._el.card);
    this._ro.observe(this._el.filters);
    this._ro.observe(this._el.reviews);
    this._layout();
    this._observe();
  }

  // One camera per TILE_MIN px of the card's own width, never more than there are
  // cameras. `columns:` forces it (1 = always the pager).
  _layout() {
    const n = this._config.cameras.length;
    const want = this._config.columns;
    const w = this._el.card.clientWidth || 0;
    let cols = want !== "auto" && Number.isFinite(+want) ? clamp(Math.round(+want), 1, n)
      : (w ? clamp(Math.floor((w + 8) / TILE_MIN), 1, n) : 1);
    if (n === 1) cols = 1;
    if (cols === this._cols && this._laidOut) return;
    const was = this._laidOut ? this._grid : null;
    this._laidOut = true;
    this._cols = cols;
    this.toggleAttribute("grid", cols > 1);
    put(this._el.stage, "--cols", String(cols));
    if (was === null || was === this._grid || !this._hass) return;
    // switching pager <-> grid changes which cameras are on screen
    this._filter = "all";
    if (this._mode === "play") this._replayAt(this._leadOffset());
    else this._syncLive();
    this._loadAll();
    this._update();
  }

  _observe() {
    if (!this._root || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      // a stream nobody is looking at is pure load on the Pi and the network
      if (!this._onscreen) for (const t of this._tiles) this._dropLive(t);
      else { this._syncLive(); this._paint(null); this._wake(); this._refresh(); }
    });
    this._io.disconnect();
    this._io.observe(this);
  }

  // Feedback on pointer-down, commit on release; a press that travels is a scroll.
  _press(el, onTap, { haptic = "light" } = {}) {
    const spring = new Spring(0, MOTION.press, `p${this._springs.length}`);
    this._springs.push(spring);
    this._pressNodes.push(el);
    el.__spring = spring;
    let origin = null, armed = false, swallow = false;
    const settle = (motion) => { origin = null; spring.to(0, motion); this._wake(); };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      origin = [e.clientX, e.clientY];
      armed = true; swallow = false;
      spring.to(1, MOTION.press);
      this._wake();
    });
    el.addEventListener("pointermove", (e) => {
      if (!origin || Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) < SLOP) return;
      swallow = true;
      settle(MOTION.release);
    });
    el.addEventListener("pointerup", () => origin && settle(MOTION.release));
    for (const t of ["pointercancel", "pointerleave"]) {
      el.addEventListener(t, () => { if (origin) { swallow = true; settle(MOTION.release); } });
    }
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const ok = (armed || e.detail === 0) && !swallow;
      armed = false; swallow = false;
      if (!ok || el.disabled) return;
      if (haptic) this._haptic(haptic);
      onTap(e);
    });
    if (el.tagName !== "BUTTON") {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
      });
    }
    return spring;
  }

  // ---------- stage: pager swipe, taps ----------
  _wireStage() {
    const stage = this._el.stage;
    let start = null, dragging = false, samples = [];
    const onControl = (e) => e.composedPath().some((n) => n.classList?.contains("iconbtn")
      || n.classList?.contains("ctrl") || n.classList?.contains("livebtn"));
    const tileOf = (e) => e.composedPath().find((n) => n.classList?.contains("tile"));

    stage.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || onControl(e)) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, from: this._pager.x, tile: tileOf(e) };
      dragging = false;
      samples = [[performance.now(), e.clientX]];
    });
    stage.addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < SLOP) return;
        // vertical intent goes back to the page; the grid has nothing to page
        if (Math.abs(dy) > Math.abs(dx) || this._grid || this._config.cameras.length < 2) { start = null; return; }
        dragging = true;
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      const W = stage.clientWidth || 1, n = this._config.cameras.length;
      let x = start.from - dx / W;
      if (x < 0) x = -rubber(-x * W, W) / W;
      if (x > n - 1) x = n - 1 + rubber((x - (n - 1)) * W, W) / W;
      this._pager.snap(x);
      samples.push([performance.now(), e.clientX]);
      if (samples.length > 6) samples.shift();
      this._paint(new Set(["pager"]));
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const was = dragging, tile = start.tile;
      start = null; dragging = false;
      if (!was) {
        if (e.type === "pointerup" && tile) this._tileTap(+tile.dataset.i);
        return;
      }
      const [t0, x0] = samples[0], [t1, x1] = samples[samples.length - 1];
      const v = t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
      const W = stage.clientWidth || 1;
      const landing = this._pager.x - project(v) / W;
      const target = clamp(Math.round(landing), Math.max(0, this._index - 1),
        Math.min(this._config.cameras.length - 1, this._index + 1));
      this._pager.v = -v / W;
      this._select(target, { fromSwipe: true });
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("keydown", (e) => {
      if (this._grid || e.target !== stage) return;
      if (e.key === "ArrowRight") { e.preventDefault(); this._select(Math.min(this._index + 1, this._config.cameras.length - 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); this._select(Math.max(this._index - 1, 0)); }
    });
    attr(stage, "tabindex", "0");
  }

  _tileTap(i) {
    if (this._mode === "play") return this._togglePlay();
    this._moreInfo(this._config.cameras[i].entity);
  }

  _select(i, { fromSwipe = false } = {}) {
    const changed = i !== this._index;
    const offset = this._mode === "play" ? this._leadOffset() : 0;
    this._index = i;
    this._pager.to(i, MOTION.pager);
    if (changed) {
      this._haptic(fromSwipe ? "light" : "selection");
      this._filter = "all";
      // playback follows you to the other camera at the same moment
      if (this._mode === "play") this._replayAt(offset);
      else this._syncLive();
      this._loadAll();
    }
    this._update();
    this._wake();
  }

  // ---------- live ----------
  // HA lazy-loads its camera player; creating a picture-entity card through the card
  // helpers is the supported way to make sure <ha-camera-stream> gets defined.
  async _ensureStreamElement() {
    if (customElements.get("ha-camera-stream")) return true;
    if (!this._streamLoad && window.loadCardHelpers) {
      this._streamLoad = window.loadCardHelpers()
        .then((helpers) => helpers.createCardElement({ type: "picture-entity", entity: this._cam.entity, camera_view: "live" }))
        .then(() => Promise.race([customElements.whenDefined("ha-camera-stream"), new Promise((r) => setTimeout(r, 4000))]))
        .catch(() => {});
    }
    if (this._streamLoad) await this._streamLoad;
    return !!customElements.get("ha-camera-stream");
  }

  _syncLive() {
    if (!this._root || !this._hass) return;
    const active = new Set(this._active());
    for (const t of this._tiles) {
      const st = this._hass.states[t.cam.entity];
      const want = this._onscreen && this.isConnected && this._mode === "live" && active.has(t.i)
        && st && st.state !== "unavailable";
      if (!want) this._dropLive(t);
      else if (!t.liveEl && !t.liveToken) this._startLive(t, st);
    }
  }

  async _startLive(t, st) {
    t.liveFor = t.cam.entity;
    const token = (t.liveToken = {});
    const stream = await this._ensureStreamElement();
    if (t.liveToken !== token) return;
    // the moment passed (scrolled away, playback started): leave it for the next sync
    if (!this._onscreen || this._mode !== "live") { t.liveToken = null; t.liveFor = null; return; }
    let el;
    if (stream) {
      el = document.createElement("ha-camera-stream");
      el.hass = this._hass;
      el.stateObj = st;
      el.muted = true;
      el.controls = false;
      el.fitMode = "cover";
      el.allowExoPlayer = true;
    } else {
      el = document.createElement("img");
      el.className = "live";
      el.alt = "";
      const refresh = () => {
        const pic = this._hass.states[t.cam.entity]?.attributes.entity_picture;
        if (pic) el.src = `${pic}${pic.includes("?") ? "&" : "?"}t=${Date.now()}`;
      };
      refresh();
      el.__timer = setInterval(refresh, 2000);
    }
    t.liveEl = el;
    t.player.before(el);
  }

  _dropLive(t) {
    t.liveToken = null;
    t.sound = false;
    if (t.liveEl) {
      clearInterval(t.liveEl.__timer);
      t.liveEl.remove();
    }
    t.liveEl = null;
    t.liveFor = null;
  }

  // ---------- sound ----------
  // Every picture starts muted. The speaker button turns one tile's sound on (one tap is the gesture
  // browsers want), one tile at a time, and it goes back to muted whenever the picture restarts, the
  // card leaves the screen, a popup closes or the tab is hidden. It only shows when the stream has sound.
  _voiceOf(t) { return t.playing ? t.video : t.liveEl ? deepVideo(t.liveEl) : null; }

  _hasSound(t) {
    const v = this._voiceOf(t);
    if (!v) return false;
    if (v.audioTracks?.length || v.mozHasAudio === true) return true;
    if (v.srcObject?.getAudioTracks?.().length) return true;
    return (v.webkitAudioDecodedByteCount || 0) > 0;
  }

  _setSound(t, on) {
    on = !!on;
    if (on) for (const o of this._tiles) if (o !== t && o.sound) this._setSound(o, false);
    t.sound = on;
    if (t.liveEl && t.liveEl.localName === "ha-camera-stream") t.liveEl.muted = !on;
    const v = this._voiceOf(t);
    if (v) v.muted = !on;
    this._paintSound();
  }

  _muteAll() { for (const t of this._tiles || []) if (t.sound) this._setSound(t, false); }

  _syncSound() {
    if (!this._el || !this._tiles) return;
    const enabled = this._config.audio_button !== false;
    for (const t of this._tiles) {
      const show = enabled && !t.playing && !!t.liveEl && this._hasSound(t);
      t.snd.hidden = !show;
      if (!show && t.sound && !t.playing) this._setSound(t, false);
    }
    const lead = this._mode === "play" ? this._lead() : null;
    this._el.snd.hidden = !(enabled && lead && this._hasSound(lead));
    if (this._el.snd.hidden && lead?.sound) this._setSound(lead, false);
    this._paintSound();
  }

  _paintSound() {
    if (!this._el || !this._tiles) return;
    const paint = (btn, on) => {
      btn.toggleAttribute("data-on", on);
      attr(btn, "aria-pressed", on ? "true" : "false");
      attr(btn, "aria-label", on ? "Mute" : "Unmute");
      attr(btn.querySelector("ha-icon"), "icon", on ? "mdi:volume-high" : "mdi:volume-off");
    };
    for (const t of this._tiles) paint(t.snd, t.sound);
    paint(this._el.snd, !!this._lead()?.sound);
  }

  // ---------- playback ----------
  _wireVideo(t) {
    const v = t.video;
    for (const ev of ["loadeddata", "playing"]) v.addEventListener(ev, () => this._syncSound());
    v.addEventListener("loadedmetadata", () => {
      if (t.offset > 0 && Number.isFinite(v.duration)) v.currentTime = Math.min(t.offset, Math.max(0, v.duration - 0.5));
      t.offset = 0;
      this._syncPlayer();
    });
    // Frigate cuts/segments on request; a long span can take a few seconds to arrive
    v.addEventListener("loadeddata", () => {
      if (this._mode !== "play") return;
      this._hideMsg(t);
      this._syncPlayer();
    });
    v.addEventListener("timeupdate", () => {
      if (t === this._lead()) this._keepInSync();
      this._syncPlayer();
    });
    for (const ev of ["play", "pause", "ended"]) v.addEventListener(ev, () => this._syncPlayer());
    v.addEventListener("error", () => {
      if (this._mode !== "play" || !v.getAttribute("src") || !t.sources) return;
      const src = t.sources[t.source];
      t.tried.push({ kind: src?.kind, code: v.error?.code ?? null });
      // try the next way of fetching the same footage before giving up
      if (t.source < t.sources.length - 1) return this._loadSource(t, t.source + 1);
      this._diagnose(t, v.getAttribute("src"), v.error);
    });
  }

  _wireBar() {
    // the progress bar owns its horizontal axis (CARD-DESIGN.md 3.2), and the finger
    // owns the position while it's down (4): timeupdates mustn't yank it back
    const bar = this._el.bar;
    let seeking = false;
    const seek = (e) => {
      const r = bar.getBoundingClientRect();
      const f = clamp((e.clientX - r.left) / (r.width || 1));
      this._seekFrac = f;
      this._seekAll(f);
      this._syncPlayer(f);
    };
    bar.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      seeking = true;
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      seek(e);
    });
    bar.addEventListener("pointermove", (e) => { if (seeking) seek(e); });
    for (const ev of ["pointerup", "pointercancel"]) {
      bar.addEventListener(ev, () => {
        if (!seeking) return;
        seeking = false;
        this._seekFrac = null;
        this._syncPlayer();
      });
    }
    bar.addEventListener("keydown", (e) => {
      const lead = this._lead()?.video;
      if (!lead || !Number.isFinite(lead.duration)) return;
      const d = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
      if (!d) return;
      e.preventDefault();
      this._seekAll(clamp((lead.currentTime + d) / lead.duration));
    });
  }

  _playingTiles() { return this._tiles.filter((t) => t.playing); }

  // The tile whose clock the controls show: the first playing camera that has
  // actually loaded, so one camera with no footage can't stall the others.
  _lead() {
    const list = this._playingTiles();
    return list.find((t) => t.video.getAttribute("src") && !t.video.error && t.video.readyState >= 1) || list[0] || null;
  }
  _leadOffset() {
    const v = this._lead()?.video;
    return v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
  }

  _seekAll(f) {
    const lead = this._lead()?.video;
    const dur = lead && Number.isFinite(lead.duration) ? lead.duration : null;
    for (const t of this._playingTiles()) {
      const v = t.video, d = Number.isFinite(v.duration) ? v.duration : dur;
      if (d && !v.error && v.readyState >= 1) v.currentTime = f * d;
    }
  }

  // Every camera plays the same span, so equal offsets are the same moment; nudge
  // back any camera that drifted (buffering, a slower segment) past DRIFT_S.
  _keepInSync() {
    if (this._seekFrac != null) return;
    const lead = this._lead();
    if (!lead) return;
    const t0 = lead.video.currentTime;
    for (const t of this._playingTiles()) {
      if (t === lead) continue;
      const v = t.video;
      if (v.error || v.readyState < 2 || !Number.isFinite(v.duration)) continue;
      if (Math.abs(v.currentTime - t0) > DRIFT_S && t0 < v.duration) v.currentTime = t0;
      if (lead.video.paused !== v.paused && !lead.video.ended) {
        if (lead.video.paused) v.pause(); else v.play?.().catch(() => {});
      }
    }
  }

  async _playSpan(start, end, meta = {}, offset = 0) {
    const fr = this._config.frigate;
    if (!fr) return;
    end = Math.min(end, nowS());
    if (end - start < 2) return this._goLive();
    this._mode = "play";
    this._play = { start, end, ...meta };
    const play = this._play;
    this.toggleAttribute("playing", true);
    const active = new Set(this._active());
    for (const t of this._tiles) {
      this._dropLive(t);
      this._stopVideo(t);
      t.playing = active.has(t.i);
      t.player.hidden = !t.playing;
      attr(t.node, "data-playing", t.playing ? "" : null);
      this._hideMsg(t);
    }
    this._el.ctrl.hidden = false;
    this._el.sync.hidden = this._playingTiles().length < 2;
    this._headOn.to(1, MOTION.ui);
    this._head.snap(clamp(start + offset - dayStart(this._day), 0, DAY));
    const at = hhmm(start + offset + (meta.review && !offset ? PAD_S : 0));
    this._update();
    await Promise.all(this._playingTiles().map((t) => {
      t.offset = offset;
      this._showMsg(t, `Preparing the recording from ${at}…`, { icon: "mdi:progress-clock", loading: true });
      return this._loadTile(t, play);
    }));
    this._wake();
  }

  _replayAt(offset) {
    const p = this._play;
    if (!p) return;
    const { start, end, ...meta } = p;
    this._playSpan(start, end, meta, offset);
  }

  // Two ways to get the same footage out of Frigate, tried in order:
  //   hls   Frigate's VOD playlist, the same thing Frigate's own UI plays. Segmented,
  //         so it needs no byte ranges, and Safari/iOS play H.265 through it. Only
  //         where the browser plays HLS natively.
  //   mp4   one file Frigate cuts on request. Plays anywhere the codec does, but
  //         Safari refuses it for H.265 (hev1 tag, no byte ranges through the proxy).
  async _loadTile(t, play) {
    const fr = this._config.frigate, cam = this._fcam(t.cam);
    const s0 = Math.floor(play.start), s1 = Math.ceil(play.end);
    t.sources = [];
    if (t.video.canPlayType("application/vnd.apple.mpegurl")) {
      t.sources.push({ kind: "hls", path: `/api/frigate/${fr.instance}/vod/${cam}/start/${s0}/end/${s1}/index.m3u8` });
    }
    t.sources.push({ kind: "mp4", path: `/api/frigate/${fr.instance}/recording/${cam}/start/${s0}/end/${s1}` });
    t.tried = [];
    await this._loadSource(t, 0);
  }

  async _loadSource(t, k) {
    const play = this._play, src = t.sources?.[k];
    if (!src) return;
    t.source = k;
    const token = (t.playToken = {});
    let url;
    try { url = await this._sign(src.path); }
    catch (err) { url = null; }
    if (t.playToken !== token || this._play !== play) return;
    if (!url) { this._showMsg(t, "Couldn't open the recording."); return; }
    const v = t.video;
    v.muted = !t.sound;
    v.src = url;
    v.play?.().catch(() => {});
  }

  _playReview(item) {
    if (this._dialog) this._closeDialog();
    this._activeReview = item.id;
    if (item.source === "review" && !item.reviewed) {
      item.reviewed = true;
      this._hass.callWS({ type: "frigate/reviews/viewed", instance_id: this._config.frigate.instance, ids: [item.id] })
        .catch(() => {});
    }
    const label = item.labels[0] ? title(item.labels[0]) : "";
    this._playSpan(item.start - PAD_S, (item.end || nowS()) + PAD_S, { review: item.id, label });
    this._renderReviews();
  }

  // ---------- recordings popup ----------
  // The real #rec node moves into the popup and back, so it keeps updating from hass
  // while open. Outside ha-card: its container-type would clip a fixed popup.
  _openRec() {
    const rec = this._el.rec;
    if (!rec || this._dialog) return;
    this._finishClosing();
    this._haptic("selection");
    const scrim = document.createElement("div");
    scrim.className = "dscrim";
    const dlg = document.createElement("div");
    dlg.className = "dlg";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-label", "Recordings");
    dlg.innerHTML = `<span class="grab" aria-hidden="true"></span>
      <div class="dh"><span class="dt">Recordings</span><button class="dx" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="db"></div>`;
    dlg.querySelector(".db").appendChild(rec);
    this._layer().append(scrim, dlg);
    const place = () => dlg.toggleAttribute("data-sheet", window.innerWidth < 600);
    place();
    const open = new Spring(0, MOTION.sheetIn, "dlg");
    open.to(1, MOTION.sheetIn);
    this._springs.push(open);
    const close = () => this._closeDialog();
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    dlg.querySelector(".dx").addEventListener("click", (e) => { e.stopPropagation(); close(); });
    guardBackdrop(scrim, dlg, close, ".db");
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    this._dialog = { rec, scrim, dlg, open, anchor: this._el.recBtn, off: () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    } };
    attr(this._el.recBtn, "aria-expanded", "true");
    this._fitRows();
    this._renderActivity();
    dlg.querySelector(".dx").focus({ preventScroll: true });
    this._paint(new Set(["dlg"]));
    this._wake();
  }

  _closeDialog(now = false) {
    this._muteAll();
    const d = this._dialog;
    if (!d) return;
    this._dialog = null;
    d.off();
    if (this._el?.recBtn) attr(this._el.recBtn, "aria-expanded", "false");
    d.anchor?.focus?.({ preventScroll: true });
    if (now || !this.isConnected) {
      this._dropDialog(d);
      return;
    }
    d.closing = true;      // the backdrop stays until it's gone: the rest of that tap lands on it
    d.open.to(0, MOTION.sheetOut);
    this._finishClosing();
    this._closing = d;
    this._wake();
  }

  _finishClosing() {
    const c = this._closing;
    if (!c) return;
    this._closing = null;
    this._dropDialog(c);
  }

  // Popups live at the top of the page, not inside the card: dashboards wrap cards in
  // boxes that would clip a full-screen layer to the card. This card's styles go with it.
  _layer() {
    if (!this._layerEl || !this._layerEl.isConnected) {
      const host = document.createElement("div");
      host.className = "savvy-layer";
      host.attachShadow({ mode: "open" }).innerHTML = `<style>${STYLE}</style>`;
      watchKeyboard(host);
      document.body.appendChild(host);
      this._layerEl = host;
    }
    this._layerEl.toggleAttribute("dark", this.hasAttribute("dark"));
    return this._layerEl.shadowRoot;
  }

  _dropDialog(d) {
    if (this._el?.holder && d.rec.parentElement !== this._el.holder) this._el.holder.appendChild(d.rec);
    d.dlg.remove();
    d.scrim.remove();
    if (this._layerEl && this._layerEl.shadowRoot.children.length <= 1) { this._layerEl.remove(); this._layerEl = null; }
    const i = this._springs.indexOf(d.open);
    if (i >= 0) this._springs.splice(i, 1);
  }

  _goLive() {
    this._seekFrac = null;
    this._mode = "live";
    this._play = null;
    this._activeReview = null;
    this.toggleAttribute("playing", false);
    for (const t of this._tiles) {
      this._stopVideo(t);
      t.playing = false;
      t.player.hidden = true;
      attr(t.node, "data-playing", null);
      this._hideMsg(t);
    }
    this._el.ctrl.hidden = true;
    this._headOn.to(0, MOTION.ui);
    this._syncLive();
    this._update();
    this._renderReviews();
    this._wake();
  }

  _stopVideo(t) {
    t.playToken = null;
    t.sound = false;
    t.video.muted = true;
    t.sources = null;
    const v = t.video;
    v.pause?.();
    if (v.getAttribute("src")) { v.removeAttribute("src"); v.load?.(); }
  }

  _togglePlay() {
    const lead = this._lead()?.video;
    if (!lead) return;
    const resume = lead.paused || lead.ended;
    for (const t of this._playingTiles()) {
      const v = t.video;
      if (v.error || !v.getAttribute("src")) continue;
      if (resume) { if (v.ended) v.currentTime = 0; v.play?.().catch(() => {}); }
      else v.pause();
    }
    this._syncPlayer();
  }

  _syncPlayer(forceFrac) {
    if (this._mode !== "play" || !this._el || !this._play) return;
    const lead = this._lead();
    if (!lead) return;
    const v = lead.video;
    const dur = Number.isFinite(v.duration) ? v.duration : (this._play.end - this._play.start);
    const cur = v.currentTime || 0;
    const f = forceFrac ?? this._seekFrac ?? clamp(dur ? cur / dur : 0);
    put(this._el.fill, "transform", `scaleX(${f.toFixed(4)})`);
    put(this._el.knob, "left", `${(f * 100).toFixed(2)}%`);
    text(this._el.ctime, `${mmss(f * dur)} / ${mmss(dur)}`);
    attr(this._el.bar, "aria-valuenow", String(Math.round(f * dur)));
    attr(this._el.bar, "aria-valuemax", String(Math.round(dur)));
    const paused = v.paused || v.ended;
    attr(this._el.ppIcon, "icon", v.ended ? "mdi:replay" : paused ? "mdi:play" : "mdi:pause");
    attr(this._el.pp, "aria-label", v.ended ? "Replay" : paused ? "Play" : "Pause");
    const at = this._play.start + f * dur;
    this._head.to(clamp(at - dayStart(this._day), 0, DAY), MOTION.drag);
    for (const t of this._playingTiles()) {
      text(t.badgeText, `${hhmm(at)}${this._play.label ? ` · ${this._play.label}` : ""}`);
    }
    this._wake();
  }

  _showMsg(t, msg, { detail = "", icon = "mdi:filmstrip-off", loading = false } = {}) {
    text(t.msgText, msg);
    text(t.msgDetail, detail);
    t.msgDetail.hidden = !detail;
    attr(t.msgIcon, "icon", icon);
    attr(t.msg, "data-loading", loading ? "" : null);
    t.msg.hidden = false;
  }
  _hideMsg(t) {
    t.msg.hidden = true;
    attr(t.msg, "data-loading", null);
  }

  // A <video> error only says "couldn't play". Ask the same signed URL directly for
  // its first bytes to tell apart what actually goes wrong: no footage (404), link
  // refused (401/403), Frigate failed to cut the clip (5xx), or a codec/tag this
  // browser won't decode (H.265 from a camera's main stream is the usual one).
  async _diagnose(t, url, mediaErr) {
    const play = this._play;
    if (!play) return;
    const at = hhmm(play.start + (play.review ? PAD_S : 0));
    const info = { camera: this._fcam(t.cam), path: url.split("?")[0], mediaError: mediaErr?.code ?? null, mediaMessage: mediaErr?.message || "" };
    try {
      const r = await fetch(url, { headers: { Range: "bytes=0-262143" }, cache: "no-store" });
      info.status = r.status;
      info.type = r.headers.get("content-type");
      info.ranges = r.status === 206 ? "ranges" : "no ranges";
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        let ascii = "";
        for (let i = 0; i < bytes.length; i++) ascii += bytes[i] > 31 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : ".";
        info.codec = /hvc1|hev1/.test(ascii) ? "h265" : /avc1|avc3/.test(ascii) ? "h264"
          : /av01/.test(ascii) ? "av1" : /vp09/.test(ascii) ? "vp9" : null;
        // Apple only decodes H.265 in MP4 when the sample entry is tagged hvc1
        info.tag = /hvc1/.test(ascii) ? "hvc1" : /hev1/.test(ascii) ? "hev1" : null;
      } else {
        info.body = (await r.text()).replace(/\s+/g, " ").slice(0, 200);
      }
    } catch (err) {
      info.status = "network";
      info.body = err?.message || String(err);
    }
    if (this._play !== play) return;
    info.tried = (t.tried || []).map((x) => `${x.kind}:${x.code}`).join(" ");
    console.warn("[camera-card] recording playback failed", info);

    const v = t.video;
    const canHevc = !!(v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') || v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"'));
    const detail = `${info.status}${info.type ? ` · ${info.type}` : ""}${info.codec ? ` · ${info.codec}` : ""}`
      + `${info.tag ? `/${info.tag}` : ""}${info.status === 200 || info.status === 206 ? ` · ${info.ranges}` : ""}`
      + `${info.tried ? ` · tried ${info.tried}` : ""}${info.body ? ` · ${info.body}` : ""}`;
    let msg;
    if (info.status === 404) {
      msg = /no recordings/i.test(info.body || "")
        ? `Frigate has no recording of ${this._camName(t.cam)} at ${at}.`
        : `Frigate didn't find “${info.camera}” recordings at ${at}. If the Frigate camera has a different name, set frigate_camera.`;
    } else if (info.status === 401 || info.status === 403) {
      msg = "Home Assistant refused the recording link. Reload the dashboard and try again.";
    } else if (typeof info.status === "number" && info.status >= 500) {
      msg = `Frigate couldn't prepare the recording from ${at}.`;
    } else if (info.status === "network") {
      msg = "Couldn't reach Home Assistant for the recording.";
    } else if (info.codec === "h265" && !canHevc) {
      msg = "This camera records in H.265, which this browser can't play. Try Safari / the iOS app, or record an H.264 stream in Frigate.";
    } else if (info.codec === "h265" && info.tag === "hev1") {
      msg = "This camera's H.265 recordings are tagged “hev1”, which Apple devices won't play. In Frigate, set ffmpeg: apple_compatibility: true for this camera (applies to new recordings).";
    } else if (info.codec === "h265") {
      msg = "This camera records in H.265; this browser says it supports it but failed to decode it.";
    } else {
      msg = `This browser couldn't play the recording from ${at}.`;
    }
    this._showMsg(t, msg, { detail });
  }

  _fullscreen(t) {
    const target = this._grid ? t.node : this._el.stage;
    const v = t.video;
    if (this._mode === "play" && v.webkitEnterFullscreen && !target.requestFullscreen) return v.webkitEnterFullscreen();
    if (target.requestFullscreen) {
      if (document.fullscreenElement) return document.exitFullscreen?.();
      return target.requestFullscreen().catch(() => this._moreInfo(t.cam.entity));
    }
    this._moreInfo(t.cam.entity);
  }

  // ---------- timeline ----------
  _wireTimeline() {
    const tl = this._el.tl;
    let down = null;
    const secAt = (e) => {
      const r = tl.getBoundingClientRect();
      return clamp((e.clientX - r.left) / (r.width || 1)) * DAY;
    };
    const show = (sec) => {
      const limit = this._day === 0 ? nowS() - dayStart(0) : DAY;
      sec = Math.min(sec, limit);
      this._cursor = sec;
      this._head.to(sec, MOTION.scrub);
      this._headOn.to(1, MOTION.ui);
      this._scrub.to(1, MOTION.scrub);
      const day0 = dayStart(this._day);
      text(this._el.bubble, hhmm(day0 + sec));
      attr(tl, "aria-valuenow", String(Math.round(sec)));
      attr(tl, "aria-valuetext", hhmm(day0 + sec));
      this._wake();
      return sec;
    };
    tl.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      down = e.pointerId;
      try { tl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this._lastDetent = null;
      show(secAt(e));
    });
    tl.addEventListener("pointermove", (e) => {
      if (e.pointerId !== down) return;
      const sec = show(secAt(e));
      const detent = Math.floor(sec / 3600);
      if (this._lastDetent !== null && detent !== this._lastDetent) this._haptic("selection");
      this._lastDetent = detent;
    });
    const up = (e) => {
      if (e.pointerId !== down) return;
      down = null;
      this._scrub.to(0, MOTION.ui);
      if (e.type === "pointerup") this._playAt(this._cursor);
      else if (this._mode !== "play") this._headOn.to(0, MOTION.ui);
      this._wake();
    };
    tl.addEventListener("pointerup", up);
    tl.addEventListener("pointercancel", up);
    tl.addEventListener("keydown", (e) => {
      const base = this._cursor ?? (this._day === 0 ? nowS() - dayStart(0) : DAY / 2);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        show(clamp(base + (e.key === "ArrowRight" ? 300 : -300), 0, DAY));
        clearTimeout(this._kbTimer);
        this._kbTimer = setTimeout(() => { this._scrub.to(0, MOTION.ui); this._wake(); }, 900);
      }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._playAt(base); }
    });
  }

  // A moment on the timeline plays from there, on every camera on screen. Landing on
  // a review plays that review (so it's marked seen and labelled); within a minute
  // of now just means live.
  _playAt(sec) {
    if (sec == null) return;
    if (this._dialog) this._closeDialog();
    const at = dayStart(this._day) + sec;
    this._haptic("light");
    if (nowS() - at < 60) return this._goLive();
    const hit = this._visibleReviews().find((r) => at >= r.start - 5 && at <= (r.end || nowS()) + 5);
    if (hit) return this._playReview(hit);
    this._activeReview = null;
    this._playSpan(at, at + 600, { label: "" });
    this._renderReviews();
  }

  _stepDay(dir) {
    const next = clamp(this._day + dir, 0, this._config.days - 1);
    if (next === this._day) return;
    this._day = next;
    this._cursor = null;
    if (this._mode === "play") this._goLive();
    this._actIn.snap(0);
    this._el.actPath.__d = null;
    this._loadAll();
    this._update();
  }

  // ---------- frigate data ----------
  async _sign(path) {
    const c = this._signed.get(path);
    if (c && c.until > Date.now()) return c.url;
    const res = await this._hass.callWS({ type: "auth/sign_path", path, expires: SIGN_TTL });
    const url = res?.path || path;
    this._signed.set(path, { url, until: Date.now() + (SIGN_TTL - 120) * 1000 });
    return url;
  }

  _refresh() {
    if (!this._onscreen || !this._hass || this._day !== 0) return;
    this._loadAll();
  }

  _loadAll() {
    if (!this._config?.frigate || !this._hass) return;
    this._loadReviews();
    for (const cam of this._scope()) { this._loadSummary(cam); this._loadMotion(cam); }
  }

  _reviewKey() { return `${this._scope().join(",")}|${this._day}|${ymd(dayStart(this._day))}`; }

  async _loadReviews() {
    const fr = this._config.frigate, cams = this._scope(), day = this._day;
    const key = this._reviewKey();
    const have = this._reviews.get(key);
    if (have?.loading) return;
    if (have && (day > 0 || Date.now() - have.at < REFRESH_MS - 1000)) { this._renderRec(); return; }
    this._reviews.set(key, { ...(have || {}), loading: true });
    const after = dayStart(day), before = day === 0 ? nowS() : dayStart(day - 1);
    let items = null, source = null, error = null;
    try {
      const list = parseWS(await this._hass.callWS({
        type: "frigate/reviews/get", instance_id: fr.instance, cameras: cams, after, before, limit: 500,
      }));
      source = "review";
      items = list.map((r) => {
        const cam = r.camera || cams[0];
        const thumb = r.thumb_path && r.thumb_path.includes("/clips/")
          ? `/api/frigate/${fr.instance}/clips/${r.thumb_path.split("/clips/")[1]}`
          : `/api/frigate/${fr.instance}/clips/review/thumb-${cam}-${r.id}.webp`;
        return {
          id: r.id, source, camera: cam, start: r.start_time, end: r.end_time,
          severity: r.severity === "alert" ? "alert" : "detection",
          labels: [...new Set([...(r.data?.objects || []), ...(r.data?.audio || [])].map((l) => String(l).replace(/-verified$/, "")))],
          reviewed: !!r.has_been_reviewed, thumb,
        };
      });
    } catch (err) {
      try {
        const list = parseWS(await this._hass.callWS({
          type: "frigate/events/get", instance_id: fr.instance, cameras: cams,
          after: Math.floor(after), before: Math.ceil(before), limit: 500,
        }));
        source = "event";
        items = list.map((e) => ({
          id: e.id, source, camera: e.camera || cams[0], start: e.start_time, end: e.end_time, severity: "detection",
          labels: e.label ? [e.label] : [], reviewed: true,
          thumb: `/api/frigate/${fr.instance}/notifications/${e.id}/thumbnail.jpg`,
        }));
      } catch (err2) {
        error = err2?.message || String(err2);
      }
    }
    if (!error) console.info(`[savvy-camera-card] ${items.length} ${source === "review" ? "reviews" : "events"} for ${cams.join(", ")} on ${ymd(after)}`);
    this._reviews.set(key, { at: Date.now(), items: (items || []).sort((a, b) => b.start - a.start), source, error });
    if (key === this._reviewKey()) this._renderRec();
  }

  async _loadSummary(cam) {
    const fr = this._config.frigate;
    const have = this._summary.get(cam);
    if (have && (have.loading || Date.now() - have.at < SUMMARY_MS)) return;
    this._summary.set(cam, { ...(have || {}), loading: true });
    let days = null;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      days = parseWS(await this._hass.callWS({ type: "frigate/recordings/summary", instance_id: fr.instance, camera: cam, timezone: tz }));
    } catch (err) { days = null; }
    this._summary.set(cam, { at: Date.now(), days });
    if (this._scope().includes(cam)) this._renderRec();
  }

  // Every ~10s recording segment carries Frigate's motion score; that's the same
  // signal Frigate's own activity graph is drawn from. Today refreshes incrementally.
  async _loadMotion(cam) {
    const fr = this._config.frigate, day = this._day;
    const key = `${cam}|${ymd(dayStart(day))}`;
    const have = this._motion.get(key);
    if (have?.loading) return;
    if (have && !have.error && (day > 0 || Date.now() - have.at < REFRESH_MS - 1000)) return;
    const after = have?.last && day === 0 ? have.last : dayStart(day);
    const before = day === 0 ? nowS() : dayStart(day - 1);
    this._motion.set(key, { ...(have || { rows: [] }), loading: true });
    let rows = null, error = null;
    try {
      const list = parseWS(await this._hass.callWS({
        type: "frigate/recordings/get", instance_id: fr.instance, camera: cam,
        after: Math.floor(after), before: Math.ceil(before),
      }));
      rows = list.map((r) => [r.start_time, r.end_time, Number(r.motion) || 0]).filter((r) => Number.isFinite(r[0]));
    } catch (err) { error = err?.message || String(err); }
    const merged = rows ? [...(have?.rows || []).filter((r) => r[0] < after), ...rows] : (have?.rows || []);
    const last = merged.length ? merged[merged.length - 1][0] : null;
    this._motion.set(key, { at: Date.now(), rows: merged, last, error: rows ? null : error });
    if (this._scope().includes(cam)) this._renderRec();
  }

  _dayReviews() { return this._reviews.get(this._reviewKey())?.items || []; }

  _visibleReviews() {
    const f = this._filter;
    return this._dayReviews().filter((r) => f === "all" || (f === "alert" ? r.severity === "alert" : r.labels.includes(f)));
  }

  // hours of this day with no recording in any on-screen camera; null = unknown
  _missingHours() {
    const want = ymd(dayStart(this._day));
    let known = false;
    const have = new Set();
    for (const cam of this._scope()) {
      const days = this._summary.get(cam)?.days;
      if (!Array.isArray(days)) continue;
      known = true;
      const d = days.find((x) => x.day === want);
      for (const h of d?.hours || []) if ((h.duration ?? 1) > 0) have.add(parseInt(h.hour, 10));
    }
    if (!known) return null;
    const upto = this._day === 0 ? new Date().getHours() : 23;
    const miss = new Set();
    for (let h = 0; h <= upto; h++) if (!have.has(h)) miss.add(h);
    return miss;
  }

  // motion per 5-minute bucket across the on-screen cameras, plus total seconds
  _activity() {
    const day0 = dayStart(this._day), want = ymd(day0);
    const buckets = new Float64Array(BUCKETS);
    let any = false, seconds = 0, loaded = false;
    for (const cam of this._scope()) {
      const m = this._motion.get(`${cam}|${want}`);
      if (m && !m.loading && !m.error) loaded = true;
      for (const [s, e, v] of m?.rows || []) {
        if (v <= 0) continue;
        const b = Math.floor(((s - day0) / DAY) * BUCKETS);
        if (b < 0 || b >= BUCKETS) continue;
        buckets[b] += v;
        seconds += Math.max(0, (e || s + 10) - s);
        any = true;
      }
      // no segment data: fall back to the hourly motion counts in the summary
      if (!m?.rows?.length) {
        const d = Array.isArray(this._summary.get(cam)?.days) ? this._summary.get(cam).days.find((x) => x.day === want) : null;
        for (const h of d?.hours || []) {
          const v = Number(h.motion) || 0;
          if (v <= 0) continue;
          const hr = parseInt(h.hour, 10), per = BUCKETS / 24;
          for (let k = 0; k < per; k++) buckets[hr * per + k] += v / per;
          any = true;
          loaded = true;
        }
      }
    }
    return { buckets, any, seconds, loaded };
  }

  // ---------- update ----------
  _update() {
    const h = this._hass;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const cams = this._config.cameras, el = this._el, active = new Set(this._active());

    for (const t of this._tiles) {
      const c = t.cam, st = h.states[c.entity];
      const off = !st || st.state === "unavailable";
      attr(t.node, "aria-hidden", active.has(t.i) ? "false" : "true");
      attr(t.node, "aria-label", `${this._camName(c)}, ${this._mode === "play" && t.playing ? "recording" : off ? "offline" : "live"}`);
      t.ph.hidden = !off;
      if (off) text(t.phText, st ? `${this._camName(c)} is offline` : `${c.entity} not found`);
      const pic = st?.attributes.entity_picture;
      t.still.hidden = off || !pic;
      if (pic && t.still.__pic !== pic) { t.still.__pic = pic; t.still.src = pic; }
      text(t.name, this._camName(c));
      text(t.status, this._roomStatus(c));
      if (this._mode === "live" || !t.playing) {
        attr(t.badge, "data-mode", "live");
        text(t.badgeText, off ? "Offline" : "Live");
      } else attr(t.badge, "data-mode", "play");
      const det = this._detections(c);
      t.det.hidden = !det.length || this._mode !== "live";
      if (det.length) {
        attr(t.detIcon, "icon", LABEL_ICONS[det[0]] || "mdi:motion-sensor");
        text(t.detText, det.map(title).join(" · "));
      }
    }

    cams.forEach((c, i) => {
      const btn = el.pillBtns[i];
      if (btn) {
        attr(btn.querySelector("ha-icon"), "icon", c.icon || h.areas?.[c.area]?.icon || "mdi:cctv");
        text(btn.querySelector("span"), this._camName(c));
        attr(btn, "aria-selected", String(i === this._index));
        attr(btn, "tabindex", i === this._index ? "0" : "-1");
      }
      const dot = el.dots.children[i];
      if (dot) attr(dot, "data-on", i === this._index ? "" : null);
    });

    const pill = el.pillBtns[this._index];
    if (this._pillReady && pill?.offsetWidth) {
      this._indX.to(pill.offsetLeft, MOTION.pill);
      this._indW.to(pill.offsetWidth, MOTION.pill);
    }

    if (this._mode === "live") this._syncLive();
    this._renderRec();
    this._wake();
  }

  // Frigate's own per-camera occupancy sensors, found by registry platform so a room
  // presence sensor that also happens to end in "_occupancy" never counts.
  _detections(cam) {
    const h = this._hass, prefix = `binary_sensor.${this._fcam(cam)}_`, out = [];
    for (const id in h.states) {
      if (!id.startsWith(prefix) || !id.endsWith("_occupancy") || h.states[id].state !== "on") continue;
      const plat = h.entities?.[id]?.platform;
      if (plat && plat !== "frigate") continue;
      if (!plat && !h.entities) continue;
      const label = id.slice(prefix.length, -"_occupancy".length);
      if (label === "all" || !label) continue;
      out.push(label);
    }
    return out;
  }

  _roomStatus(cam) {
    const h = this._hass;
    if (!cam.area || !h.entities) return "";
    if (this._regFor !== h.entities) { this._regFor = h.entities; this._areaCache = new Map(); }
    let ids = this._areaCache.get(cam.area);
    if (!ids) {
      ids = { presence: [], door: [] };
      for (const id in h.entities) {
        const ent = h.entities[id];
        if (ent.hidden || ent.disabled_by || ent.entity_category || !id.startsWith("binary_sensor.")) continue;
        if (ent.platform === "frigate") continue;
        const a = ent.area_id || h.devices?.[ent.device_id]?.area_id;
        if (a !== cam.area) continue;
        const dc = h.states[id]?.attributes.device_class;
        if (["presence", "occupancy", "motion"].includes(dc)) ids.presence.push(id);
        if (["door", "garage_door", "opening"].includes(dc)) ids.door.push(id);
      }
      this._areaCache.set(cam.area, ids);
    }
    const parts = [];
    const pres = ids.presence.map((id) => h.states[id]).filter(Boolean);
    if (pres.length) parts.push(pres.some((s) => s.state === "on") ? "Occupied" : "Clear");
    const doors = ids.door.map((id) => h.states[id]).filter(Boolean);
    if (doors.length) {
      const open = doors.filter((s) => s.state === "on").length;
      parts.push(open ? (doors.length > 1 ? `${open} doors open` : "Door open") : (doors.length > 1 ? "Doors closed" : "Door closed"));
    }
    return parts.join(" · ");
  }

  // ---------- recordings UI ----------
  _renderActivity() {
    if (!this._config.frigate || !this._el) return;
    const { buckets, any } = this._activity();
    let max = 0;
    for (const v of buckets) max = Math.max(max, v);
    const path = this._el.actPath;
    if (!any || !max) {
      if (path.__d) { path.__d = ""; path.setAttribute("d", ""); }
      this._el.legend.hidden = !this._dayReviews().length;
      return;
    }
    // sqrt lifts the quiet stretches so one busy minute doesn't flatten the whole day
    let d = "M0 100";
    for (let i = 0; i < BUCKETS; i++) {
      const y = (100 - (buckets[i] > 0 ? 6 + Math.sqrt(buckets[i] / max) * 60 : 0)).toFixed(1);
      d += `L${i} ${y}L${i + 1} ${y}`;
    }
    d += `L${BUCKETS} 100Z`;
    if (path.__d !== d) {
      const first = !path.__d;
      path.__d = d;
      path.setAttribute("d", d);
      if (first) { this._actIn.snap(0); this._actIn.to(1, MOTION.graph); this._wake(); }
    }
    this._el.legend.hidden = false;
  }

  _renderRec() {
    if (!this._config.frigate || !this._el) return;
    const el = this._el, day0 = dayStart(this._day), grid = this._grid;
    const names = ["Today", "Yesterday"];
    text(el.dayname, names[this._day] || new Date(day0 * 1000).toLocaleDateString(this._hass?.locale?.language || undefined,
      { weekday: "short", day: "numeric", month: "short" }));
    attr(el.prev, "disabled", this._day >= this._config.days - 1 ? "" : null);
    attr(el.next, "disabled", this._day === 0 ? "" : null);

    const entry = this._reviews.get(this._reviewKey());
    const all = entry?.items || [];
    const alerts = all.filter((r) => r.severity === "alert").length;
    const act = this._activity();
    let sum;
    if (!entry || (entry.loading && !entry.items)) sum = "Loading…";
    else if (entry.error) sum = "";
    else if (all.length) sum = `${alerts ? `${alerts} alert${alerts > 1 ? "s" : ""} · ` : ""}${all.length - alerts} detection${all.length - alerts === 1 ? "" : "s"}`;
    else if (act.any) sum = `No detections · ${span(act.seconds)} of motion`;
    else sum = act.loaded ? "No activity" : "No detections";
    text(el.daysum, sum);
    if (el.recSum) text(el.recSum, sum);

    const miss = this._missingHours();
    [...el.hours.children].forEach((i, hIdx) => attr(i, "data-norec", miss?.has(hIdx) ? "" : null));
    const nowFrac = this._day === 0 ? clamp((nowS() - day0) / DAY) : 1;
    el.future.hidden = this._day !== 0;
    put(el.future, "left", `${(nowFrac * 100).toFixed(3)}%`);
    el.now.hidden = this._day !== 0;
    put(el.now, "left", `${(nowFrac * 100).toFixed(3)}%`);

    const vis = new Set(this._visibleReviews().map((r) => r.id));
    const marks = all.map((r) => {
      const a = clamp((r.start - day0) / DAY), b = clamp(((r.end || nowS()) - day0) / DAY);
      return `<i class="mk" data-sev="${r.severity}" ${vis.has(r.id) ? "" : "data-dim"} style="left:${(a * 100).toFixed(3)}%;width:${Math.max(0, (b - a) * 100).toFixed(3)}%"></i>`;
    }).join("");
    if (el.marks.__html !== marks) { el.marks.__html = marks; el.marks.innerHTML = marks; }

    const counts = new Map();
    for (const r of all) for (const l of r.labels) counts.set(l, (counts.get(l) || 0) + 1);
    const filters = [["all", "All", "mdi:filmstrip", all.length]];
    if (alerts) filters.push(["alert", "Alerts", "mdi:alert-circle-outline", alerts]);
    for (const [l, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) filters.push([l, title(l), LABEL_ICONS[l] || "mdi:motion-sensor", n]);
    if (!filters.some((f) => f[0] === this._filter)) this._filter = "all";
    const fkey = filters.map((f) => f.join(":")).join("|");
    if (el.filters.__key !== fkey) {
      el.filters.__key = fkey;
      this._dropPress(el.filters);
      el.filters.innerHTML = "";
      for (const [key, name, icon, n] of filters) {
        const b = document.createElement("button");
        b.className = "chip";
        b.dataset.key = key;
        b.innerHTML = `<ha-icon icon="${icon}"></ha-icon><span>${name}</span><span class="n">${n}</span>`;
        b.setAttribute("aria-label", `${name}, ${n}`);
        this._press(b, () => { this._filter = key; this._haptic("selection"); this._renderRec(); }, { haptic: null });
        el.filters.appendChild(b);
      }
    }
    for (const b of el.filters.children) attr(b, "aria-pressed", String(b.dataset.key === this._filter));
    el.filters.hidden = !all.length;

    this._renderReviews();
    this._renderActivity();

    let note = "";
    if (entry?.error) note = "Recordings unavailable: the Frigate integration didn't answer. Check the instance id and that Frigate is running.";
    el.note.hidden = !note;
    text(el.note, note);
    attr(el.tl, "aria-label", `Recording timeline${grid ? ", all cameras" : `, ${this._camName(this._cam)}`}`);
    this._fitRows();
  }

  _dropPress(container) {
    this._pressNodes = this._pressNodes.filter((n) => {
      if (!container.contains(n)) return true;
      const i = this._springs.indexOf(n.__spring);
      if (i >= 0) this._springs.splice(i, 1);
      return false;
    });
  }

  _renderReviews() {
    const el = this._el, list = this._visibleReviews(), grid = this._grid;
    const key = `${this._reviewKey()}|${this._filter}|${grid}|${list.map((r) => `${r.id}:${r.reviewed}:${r.end}`).join(",")}`;
    if (el.reviews.__key !== key) {
      el.reviews.__key = key;
      this._dropPress(el.reviews);
      el.reviews.innerHTML = "";
      for (const r of list) {
        const b = document.createElement("button");
        b.className = "rv";
        b.dataset.id = r.id;
        b.dataset.sev = r.severity;
        b.setAttribute("role", "listitem");
        const label = r.labels[0];
        const dur = r.end ? r.end - r.start : nowS() - r.start;
        const cam = this._camByFrigate(r.camera);
        // in the grid the reviews come from every camera, so say which one
        const where = grid && cam ? this._camName(cam) : (r.end ? mmss(dur) : "ongoing");
        b.innerHTML = `
          <span class="th"><ha-icon icon="${LABEL_ICONS[label] || "mdi:cctv"}"></ha-icon><img alt="" hidden>
            ${label ? `<span class="lbl"><ha-icon icon="${LABEL_ICONS[label] || "mdi:motion-sensor"}"></ha-icon>${title(label)}${r.labels.length > 1 ? ` +${r.labels.length - 1}` : ""}</span>` : ""}
            ${r.reviewed ? "" : `<span class="new" aria-hidden="true"></span>`}
          </span>
          <span class="meta"><span>${hhmm(r.start)}</span><span class="d">${where}</span></span>`;
        b.setAttribute("aria-label", `${r.severity === "alert" ? "Alert" : "Detection"}: ${r.labels.map(title).join(", ") || "motion"}`
          + `${cam && grid ? ` on ${this._camName(cam)}` : ""} at ${hhmm(r.start)}${r.reviewed ? "" : ", not reviewed"}`);
        this._press(b, () => this._playReview(r), { haptic: "light" });
        el.reviews.appendChild(b);
        this._thumb(b.querySelector("img"), r.thumb);
      }
    }
    for (const b of el.reviews.children) attr(b, "data-active", b.dataset.id === this._activeReview ? "" : null);
    el.reviews.hidden = !list.length;
  }

  async _thumb(img, path) {
    if (!path) return;
    try {
      const url = await this._sign(path);
      img.onload = () => { img.hidden = false; };
      img.onerror = () => { img.hidden = true; };
      img.src = url;
    } catch (err) { /* the label icon stays as the placeholder */ }
  }

  _fitRows() {
    for (const row of [this._el?.filters, this._el?.reviews]) {
      if (!row || row.hidden) continue;
      row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
    }
  }

  // ---------- actions ----------
  _moreInfo(entityId) {
    if (!entityId || !this._hass?.states[entityId]) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
  _haptic(type) { window.dispatchEvent(new CustomEvent("haptic", { detail: type })); }

  // ---------- frame ----------
  _wake() { if (this._root && this.isConnected) Clock.add(this._job); }

  _frame(now, dt) {
    const dirty = new Set();
    for (const s of this._springs) {
      if (s.idle) continue;
      if (this._reduced) s.snap();
      else s.step(dt);
      dirty.add(s.group);
    }
    if (!this._pillReady && !this._grid && this._config.cameras.length > 1) dirty.add("pill");
    if (!dirty.size) return false;
    if (this._onscreen) this._paint(dirty);
    return true;
  }

  _paint(dirty) {
    if (!this._el) return;
    const all = !dirty, red = this._reduced, el = this._el;

    const dl = this._dialog || this._closing;
    if (dl && (all || dirty.has("dlg"))) {
      const v = dl.open.x, sheet = dl.dlg.hasAttribute("data-sheet");
      put(dl.scrim, "opacity", clamp(v).toFixed(3));
      put(dl.dlg, "opacity", clamp(v * 1.6).toFixed(3));
      put(dl.dlg, "transform", sheet ? `translateY(${((1 - v) * 60).toFixed(2)}px)`
        : `translate(-50%, calc(-50% + ${((1 - v) * 18).toFixed(2)}px)) scale(${(0.97 + 0.03 * v).toFixed(4)})`);
      if (dl.closing && v < 0.02 && dl.open.idle) this._finishClosing();
    }

    for (const node of this._pressNodes) {
      const s = node.__spring;
      if (!s || (!all && !dirty.has(s.group))) continue;
      const p = s.x;
      if (red) put(node, "opacity", Math.abs(p) < 1e-4 ? "" : (1 - 0.25 * p).toFixed(3));
      else put(node, "transform", Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.04 * p).toFixed(4)})`);
    }

    if (all || dirty.has("pager")) {
      const W = this._grid ? 0 : (el.stage.clientWidth || 0);
      put(el.track, "transform", this._grid ? "" : `translate3d(${(-this._pager.x * W).toFixed(2)}px,0,0)`);
    }

    if ((all || dirty.has("pill")) && !this._grid && this._config.cameras.length > 1) {
      const btn = el.pillBtns[this._index];
      if (btn && btn.offsetWidth) {
        if (!this._pillReady) {
          this._pillReady = true;
          this._indX.snap(btn.offsetLeft);
          this._indW.snap(btn.offsetWidth);
        }
        this._indX.to(btn.offsetLeft, MOTION.pill);
        this._indW.to(btn.offsetWidth, MOTION.pill);
        put(el.ind, "transform", `translateX(${this._indX.x.toFixed(2)}px)`);
        put(el.ind, "width", `${this._indW.x.toFixed(2)}px`);
      }
    }

    if (this._config.frigate && (all || dirty.has("head") || dirty.has("scrub"))) {
      const f = clamp(this._head.x / DAY);
      put(el.playhead, "left", `${(f * 100).toFixed(3)}%`);
      put(el.playhead, "opacity", clamp(this._headOn.x).toFixed(3));
      put(el.bubble, "left", `${(f * 100).toFixed(3)}%`);
      put(el.bubble, "opacity", clamp(this._scrub.x).toFixed(3));
    }

    // the activity graph grows up out of the baseline the first time it has data
    if (this._config.frigate && (all || dirty.has("act"))) {
      const a = clamp(this._actIn.x);
      put(el.act, "transform-origin", "50% 100%");
      put(el.act, "transform", a > 0.999 ? "" : `scaleY(${a.toFixed(3)})`);
    }
  }
}

// ---------- editor ----------
const EDITOR = defineEditor("savvy-camera-card", (hass, c) => [
  S.grid(S.titleLine(), S.titleLink("title")),
  { name: "area", label: "Area", helper: "Its cameras. Pick several areas for one card across rooms.", selector: { area: { multiple: true } } },
  { name: "cameras", label: "Cameras", type: "list", helper: "Instead of the area's: these, in this order.", add: { selector: { entity: { domain: "camera" } }, label: "Add a camera" },
    item: [
      { name: "entity", label: "Camera", selector: { entity: { domain: "camera" } } },
      { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "area", label: "Area", selector: { area: {} } }] },
      { name: "frigate_camera", label: "Frigate name", helper: "When it isn't the entity's own name.", selector: { text: {} } },
    ] },
  S.grid(S.select("recordings", "Recordings", [{ value: "popup", label: "In a popup" }, { value: "inline", label: "In the card" }]),
    { name: "columns", label: "Columns", selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "By width" }, "1", "2", "3", "4"] } } }),
  S.grid(S.number("days", "Recording days", 1, 30), S.text("aspect_ratio", "Aspect ratio")),
  S.bool("audio_button", "Sound button", "A speaker button on cameras that have sound. It always starts muted; one tap turns the sound on.", true),
  { type: "expandable", name: "frigate", title: "Frigate", schema: [
    { name: "instance", label: "Instance", helper: "Frigate's MQTT client id; 'frigate' unless you changed it. Found by itself when the cameras come from Frigate.", selector: { text: {} } },
  ] },
]);

registerCard("savvy-camera-card", SavvyCameraCard, "Camera",
  "Live cameras side by side, with Frigate's alerts, motion activity and synced recording playback when the cameras come from Frigate.");
