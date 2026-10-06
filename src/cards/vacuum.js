// savvy-vacuum-card: any robot vacuum, deepest for Roborock. Everything is discovered from
// the vacuum's device by translation_key: live job, map, rooms (cleaned in the order you
// pick), app routines, modes, dock and consumables. `layout: compact` is one row: battery
// ring, status and a start/pause button (hold it to send the vacuum home).
//
//   type: custom:savvy-vacuum-card
//   entity: vacuum.robot            (the only required key)


const PREDICT_MS = 5000;
const TICK_MS = 30000;

const MOTION = {
  press:    { response: 0.12, damping: 1 },
  release:  { response: 0.3,  damping: 0.82 },
  hold:     { response: 0.5,  damping: 1 },
  pop:      { response: 0.34, damping: 0.58 },
  ui:       { response: 0.4,  damping: 1 },
  text:     { response: 0.5,  damping: 1 },
  ring:     { response: 0.7,  damping: 1 },
  sheetIn:  { response: 0.38, damping: 0.82 },
  sheetOut: { response: 0.24, damping: 1 },
};

const COLORS = { accent: "#5BA3D9", warn: TONE.warn, alert: TONE.bad, good: TONE.good };

// ---------- what the device's entities mean (translation_key, or the id suffix) ----------
const ONE = {
  status: ["sensor", "status"], battery: ["sensor", "battery"], charging: ["binary_sensor", "charging"],
  progress: ["sensor", "clean_percent"], cleanTime: ["sensor", "cleaning_time"], cleanArea: ["sensor", "cleaning_area"],
  vacError: ["sensor", "vacuum_error"], dockError: ["sensor", "dock_error"],
  lastStart: ["sensor", "last_clean_start"], lastEnd: ["sensor", "last_clean_end"],
  totalTime: ["sensor", "total_cleaning_time"], totalArea: ["sensor", "total_cleaning_area"], totalCount: ["sensor", "total_cleaning_count"],
  mopDryLeft: ["sensor", "mop_drying_remaining_time"], selectedMap: ["select", "selected_map"],
};
// binary "problem" sensors: on = needs attention
const ALERTS = {
  water_shortage: ["Water shortage", "mdi:water-off"],
  clean_box_empty: ["Clean water tank empty", "mdi:water-remove-outline"],
  dirty_box_full: ["Dirty water tank full", "mdi:water-alert"],
  clean_fluid_empty: ["Cleaning fluid empty", "mdi:bottle-tonic-outline"],
  detergent_empty: ["Detergent empty", "mdi:bottle-tonic-outline"],
  softener_empty: ["Softener empty", "mdi:bottle-tonic-outline"],
};
// readouts about the dock and what's attached
const DOCK_INFO = {
  mop_attached: ["Mop", "mdi:water", "Attached", "Detached"],
  water_box_attached: ["Water tank", "mdi:cup-water", "Attached", "Detached"],
  mop_drying_status: ["Mop drying", "mdi:fan", "Drying", "Idle"],
};
// dock switches that *do* something (empty, wash, dry); settings switches go under Care
const DOCK_ACTIONS = {
  dust_emptying: ["Empty bin", "mdi:delete-empty"],
  mop_washing: ["Wash mop", "mdi:water-sync"],
  mop_drying: ["Dry mop", "mdi:fan"],
};
const SETTINGS = {
  dnd_switch: ["Do not disturb", "mdi:minus-circle-outline"],
  child_lock: ["Child lock", "mdi:lock-outline"],
  status_indicator: ["Status light", "mdi:led-on"],
};
// rated life in hours: Roborock's published defaults, overridable per part in config
const CONSUMABLES = {
  main_brush_time_left: ["Main brush", 300, "mdi:brush"],
  side_brush_time_left: ["Side brush", 200, "mdi:broom"],
  filter_time_left: ["Filter", 150, "mdi:air-filter"],
  sensor_time_left: ["Sensors", 30, "mdi:eye-outline"],
  strainer_time_left: ["Dock strainer", 150, "mdi:filter-outline"],
  cleaning_brush_time_left: ["Dock brush", 300, "mdi:brush"],
};
const MODE_ICONS = {
  fan_speed: "mdi:fan", mop_mode: "mdi:water-sync", mop_intensity: "mdi:water", water_box_mode: "mdi:water",
  water_flow: "mdi:water", dust_collection_mode: "mdi:delete-empty", cleaning_route: "mdi:routes", cleaning_mode: "mdi:broom",
};
const MODE_NAMES = {
  fan_speed: "Suction", mop_mode: "Mop route", mop_intensity: "Water", water_box_mode: "Water", water_flow: "Water",
  dust_collection_mode: "Auto-empty", cleaning_route: "Route", cleaning_mode: "Mode",
};
const FEAT = { PAUSE: 4, STOP: 8, RETURN_HOME: 16, FAN_SPEED: 32, LOCATE: 512, CLEAN_SPOT: 1024, START: 8192, CLEAN_AREA: 16384 };
const NO_ERROR = new Set(["none", "ok", "no_error", "normal", "0", "unknown", "unavailable", ""]);

const num = (st) => (st && !isOff(st) ? parseFloat(st.state) : NaN);

// a duration sensor's value in hours, whatever unit HA shows it in
const toHours = (st) => {
  const v = num(st);
  if (!Number.isFinite(v)) return NaN;
  const u = String(st.attributes.unit_of_measurement || "h").toLowerCase();
  if (u === "s") return v / 3600;
  if (u === "min") return v / 60;
  if (u === "d") return v * 24;
  return v;
};
const toSeconds = (st) => toHours(st) * 3600;
const hm = (sec) => {
  if (!Number.isFinite(sec)) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
const hoursLeft = (h) => {
  if (!Number.isFinite(h)) return "—";
  if (h <= 0) return "Replace";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min left`;
  if (h < 48) return `${Math.round(h)} h left`;
  return `${Math.round(h / 24)} d left`;
};
const dayTime = (t, lang) => {
  const d = new Date(t), now = new Date();
  const hm2 = d.toLocaleTimeString(lang || undefined, { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today ${hm2}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${hm2}`;
  return `${d.toLocaleDateString(lang || undefined, { weekday: "short", day: "numeric", month: "short" })} ${hm2}`;
};
// a routine's icon from its name: mop, vacuum, both, deep, quick
const routineIcon = (name) => {
  const n = String(name).toLowerCase();
  const vac = /vac|sweep|suck/.test(n), mop = /mop|wash|wet/.test(n);
  if (vac && mop) return "mdi:robot-vacuum-variant";
  if (/deep|intens/.test(n) && mop) return "mdi:water-plus";
  if (mop) return "mdi:water";
  if (/quick|fast|express/.test(n)) return "mdi:lightning-bolt";
  if (vac) return "mdi:robot-vacuum";
  return "mdi:play-circle-outline";
};

const STYLE = `
/* tokens live on :host, not ha-card: the popup renders outside ha-card and must
   inherit the same palette */
:host {
  display: block; -webkit-tap-highlight-color: transparent;
  --radius: var(--ha-card-border-radius, 18px);
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --acc: var(--savvy-vacuum-accent, ${COLORS.accent});
  --warn-c: ${COLORS.warn};
  --alert-c: ${COLORS.alert};
  --accent: 91 163 217;
}
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
${GLOW_CSS}

ha-card {
  --radius: var(--ha-card-border-radius, 18px);
  --pad: 14px;
  --well: color-mix(in oklab, var(--primary-text-color) 6%, transparent);
  --line: color-mix(in oklab, var(--primary-text-color) 9%, transparent);
  --acc: var(--savvy-vacuum-accent, ${COLORS.accent});
  --warn-c: ${COLORS.warn};
  --alert-c: ${COLORS.alert};
  --accent: 91 163 217;
  ${DESIGN_TOKENS}
  position: relative; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 12px;
  padding: var(--pad);
  border-radius: var(--radius);
  border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--line));
  background: var(--ha-card-background, var(--card-background-color));
  box-shadow: var(--ha-card-box-shadow, none);
  color: var(--primary-text-color);
  font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  isolation: isolate;
  container-type: inline-size;
  transition: background-color 240ms ease, border-color 240ms ease;
}
:host([compact]) ha-card { --pad: 12px; gap: 8px; }
@supports (corner-shape: squircle) {
  ha-card { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); }
}
:host([dark]) ha-card::after {
  content: ""; position: absolute; inset: 0; z-index: 9; border-radius: inherit; corner-shape: inherit;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05); pointer-events: none;
}
ha-icon, savvy-state-icon { display: flex; align-items: center; justify-content: center; line-height: 0; }

.cap { font-size: 11px; line-height: 13px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; color: var(--secondary-text-color); }
.sec { display: flex; flex-direction: column; gap: 8px; }
.sec-head { display: flex; align-items: center; gap: 8px; min-height: 16px; }
.sec-head .cap { flex: 1; }
.sec-head .aside { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); }

/* ---------- alert banner ---------- */
.banner {
  --c: var(--alert-c);
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 13px;
  background: color-mix(in oklab, var(--c) 15%, transparent); color: var(--c);
  --mdc-icon-size: 20px; cursor: pointer; transform-origin: 50% 50%;
}
.banner[data-level="warn"] { --c: var(--warn-c); }
.banner .bt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.banner .b1 { font-size: 14px; line-height: 17px; font-weight: 650; letter-spacing: -0.012em; }
.banner .b2 { font-size: 12px; line-height: 16px; font-weight: 500; opacity: 0.85; }

/* ---------- hero ---------- */
.hero { display: flex; align-items: center; gap: 14px; min-width: 0; }
:host([compact]) .hero { gap: 11px; }
.ring { position: relative; flex: none; width: 64px; height: 64px; cursor: pointer; }
:host([compact]) .ring { width: 46px; height: 46px; }
.ring > svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.ring .track { fill: none; stroke: var(--well); stroke-width: 3.2; }
.ring .fill { fill: none; stroke: var(--ring-c, var(--acc)); stroke-width: 3.2; stroke-linecap: round; }
.ring .bot {
  position: absolute; inset: 7px; border-radius: 50%; display: grid; place-items: center;
  --mdc-icon-size: 28px; color: color-mix(in oklab, var(--acc) calc(var(--act, 0) * 100%), var(--primary-text-color));
  background: color-mix(in oklab, var(--acc) calc(var(--act, 0) * 14%), var(--well));
}
:host([compact]) .ring .bot { inset: 5px; --mdc-icon-size: 20px; }
.ring .bolt {
  position: absolute; right: -2px; bottom: -2px; width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center; --mdc-icon-size: 13px; color: var(--acc);
  background: var(--card-background-color, #fff); box-shadow: 0 0 0 1.5px var(--card-background-color, #fff), inset 0 0 0 20px var(--well);
}
:host([compact]) .ring .bolt { width: 17px; height: 17px; --mdc-icon-size: 11px; }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; cursor: pointer; }
.name { font-size: 18px; line-height: 23px; font-weight: 650; letter-spacing: -0.022em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:host([compact]) .name { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; }
.status { display: flex; gap: 5px; min-width: 0; font-size: 13px; line-height: 17px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; }
:host([compact]) .status { font-size: 12.5px; line-height: 16px; }
.status .s1 { font-weight: 600; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; }
.status .s2 { overflow: hidden; text-overflow: ellipsis; }
.status .s2:empty { display: none; }
.status .s2::before { content: "· "; }
.status[data-level="alert"] .s1 { color: var(--alert-c); }
.status[data-level="warn"] .s1 { color: var(--warn-c); }
.meta { display: flex; gap: 5px; min-width: 0; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; }
.meta .batt { font-weight: 650; flex: none; }
.meta .batt[data-level="warn"] { color: var(--warn-c); }
.meta .batt[data-level="alert"] { color: var(--alert-c); }
.meta .stats { overflow: hidden; text-overflow: ellipsis; }
.meta .stats:empty { display: none; }
.meta .batt:not(:empty) + .stats:not(:empty)::before { content: "· "; }

.prog { height: 4px; border-radius: 2px; background: var(--well); overflow: hidden; }
.prog i { display: block; height: 100%; width: 100%; background: var(--acc); border-radius: inherit; transform-origin: 0 50%; }
:host([compact]) .prog { height: 3px; margin-top: -2px; }

/* ---------- buttons ---------- */
.primary {
  --hold: 0;
  position: relative; overflow: hidden; flex: none; height: 38px; padding: 0 16px 0 12px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  background: var(--acc); color: #fff; --mdc-icon-size: 19px;
  font-size: 13.5px; line-height: 16px; font-weight: 650; letter-spacing: -0.008em; white-space: nowrap;
  transform-origin: 50% 50%;
}
.primary::before { content: ""; position: absolute; inset: 0; background: rgb(255 255 255 / 0.22); transform-origin: 0 50%; transform: scaleX(var(--hold)); pointer-events: none; }
.primary > * { position: relative; }
.primary[data-kind="quiet"] { background: var(--well); color: var(--primary-text-color); }
.primary[data-kind="quiet"]::before { background: color-mix(in oklab, var(--primary-text-color) 10%, transparent); }
.primary[disabled] { opacity: 0.45; cursor: default; }
:host([compact]) .primary { height: 34px; padding: 0 13px 0 10px; font-size: 13px; }

.controls { display: flex; gap: 6px; }
.controls .primary { flex: 1 1 auto; }
.ctl {
  --hold: 0;
  position: relative; overflow: hidden; flex: none; width: 44px; height: 38px; border-radius: 12px;
  display: grid; place-items: center; background: var(--well); --mdc-icon-size: 20px; transform-origin: 50% 50%;
}
.ctl::before { content: ""; position: absolute; inset: 0; background: color-mix(in oklab, var(--alert-c) 30%, transparent); transform-origin: 0 50%; transform: scaleX(var(--hold)); pointer-events: none; }
.ctl > * { position: relative; }
.ctl[disabled] { opacity: 0.35; cursor: default; }

/* ---------- map ---------- */
.map { position: relative; border-radius: 14px; overflow: hidden; background: var(--well); cursor: zoom-in; transform-origin: 50% 50%; }
.map img { display: block; width: 100%; height: auto; max-height: var(--map-max, 420px); object-fit: contain; }
.map .none { padding: 30px 12px; text-align: center; font-size: 12px; color: var(--secondary-text-color); }

/* ---------- chips (rooms, maps, dock actions, settings) ---------- */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  --on: 0; --c: var(--acc);
  position: relative; display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px 0 9px; border-radius: 11px;
  background: color-mix(in oklab, var(--c) calc(var(--on) * 16%), var(--well));
  font-size: 12.5px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; white-space: nowrap;
  color: color-mix(in oklab, var(--primary-text-color) calc(62% + var(--on) * 38%), transparent);
  --mdc-icon-size: 17px; transform-origin: 50% 50%;
}
.chip ha-icon { color: color-mix(in oklab, var(--c) calc(var(--on) * 100%), var(--secondary-text-color)); }
.chip .ord {
  min-width: 18px; height: 18px; border-radius: 9px; display: grid; place-items: center; margin-inline-start: -2px;
  font-size: 11px; font-weight: 700; color: #fff; background: var(--c);
}
.chip[data-off] { opacity: 0.45; }
.rooms-go { display: flex; gap: 6px; align-items: center; }
.rooms-go .primary { flex: 1; }
.rooms-go .clear { height: 38px; padding: 0 12px; border-radius: 12px; background: var(--well); font-size: 13px; font-weight: 600; transform-origin: 50% 50%; }
.hint { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); }

/* ---------- routines: one row, masked when it overflows ---------- */
.routines {
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(max-content, 1fr); gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  padding: 3px; margin: -3px;
}
.routines::-webkit-scrollbar { display: none; }
.routines[data-overflow] { mask-image: linear-gradient(to left, transparent 0, #000 26px); -webkit-mask-image: linear-gradient(to left, transparent 0, #000 26px); }
.rt {
  --on: 0;
  display: flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 13px 0 10px; border-radius: 12px;
  background: color-mix(in oklab, var(--acc) calc(var(--on) * 18%), var(--well)); white-space: nowrap; transform-origin: 50% 50%;
  font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: -0.006em; --mdc-icon-size: 18px;
}
.rt ha-icon { color: var(--acc); }
.rt[data-off] { opacity: 0.45; }

/* ---------- summary tiles: each opens its popup ---------- */
.hub { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
@container (min-width: 640px) { .hub { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
#inlineMap:empty { display: none; }
.tile {
  display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 13px; background: var(--well); text-align: start;
  min-width: 0; --mdc-icon-size: 18px; transform-origin: 50% 50%;
}
.tile > ha-icon { flex: none; width: var(--b-s); height: var(--b-s); border-radius: 50%; background: var(--well); color: var(--secondary-text-color); }
.tile .tt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tile .tc { font-size: 11px; line-height: 13px; font-weight: 550; color: var(--secondary-text-color); }
.tile .tv { font-size: 13px; line-height: 17px; font-weight: 650; letter-spacing: -0.008em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile[data-level="warn"] > ha-icon { background: color-mix(in oklab, var(--warn-c) 18%, transparent); color: var(--warn-c); }
.tile[data-level="warn"] .tv { color: var(--warn-c); }
.tile[data-level="alert"] > ha-icon { background: color-mix(in oklab, var(--alert-c) 18%, transparent); color: var(--alert-c); }
.tile[data-level="alert"] .tv { color: var(--alert-c); }
.tile[data-level="accent"] > ha-icon { background: color-mix(in oklab, var(--acc) 18%, transparent); color: var(--acc); }

/* ---------- modes (in their popup): tap-once option chips ---------- */
.mgroups { display: flex; flex-direction: column; gap: 12px; }
.mgroup { display: flex; flex-direction: column; gap: 7px; }

/* ---------- dock readouts ---------- */
.dock { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }
.dk { --c: var(--primary-text-color); display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; background: var(--well); min-width: 0; --mdc-icon-size: 17px; cursor: pointer; transform-origin: 50% 50%; }
.dk ha-icon { color: var(--secondary-text-color); flex: none; }
.dk .dt { display: flex; flex-direction: column; min-width: 0; }
.dk .dv { font-size: 13px; line-height: 16px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dk .dc { font-size: 11px; line-height: 13px; font-weight: 550; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dk[data-level="warn"] { background: color-mix(in oklab, var(--warn-c) 14%, transparent); }
.dk[data-level="warn"] ha-icon, .dk[data-level="warn"] .dv { color: var(--warn-c); }

/* ---------- maintenance ---------- */
.parts { display: flex; flex-direction: column; gap: 4px; }
.part { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 10px; row-gap: 5px; padding: 8px 10px; border-radius: 12px; background: var(--well); cursor: pointer; transform-origin: 50% 50%; }
.part ha-icon { --mdc-icon-size: 17px; color: var(--secondary-text-color); grid-row: span 2; }
.part .pn { font-size: 13px; line-height: 16px; font-weight: 600; }
.part .pl { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); text-align: end; }
.part .pb { grid-column: 2 / 4; height: 4px; border-radius: 2px; background: color-mix(in oklab, var(--primary-text-color) 8%, transparent); overflow: hidden; }
.part .pb i { display: block; height: 100%; border-radius: inherit; background: color-mix(in oklab, var(--primary-text-color) 45%, transparent); transform-origin: 0 50%; }
.part[data-level="warn"] .pl { color: var(--warn-c); }
.part[data-level="warn"] .pb i { background: var(--warn-c); }
.part[data-level="alert"] .pl { color: var(--alert-c); }
.part[data-level="alert"] .pb i { background: var(--alert-c); }
.totals { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 2px 2px 0; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--secondary-text-color); }
.totals b { font-weight: 650; color: var(--primary-text-color); }

/* ---------- popup (CARD-DESIGN.md 8): outside ha-card, position: fixed ---------- */
.dscrim { position: fixed; inset: 0; z-index: 998; background: rgb(0 0 0 / 0.45); opacity: 0; }
.dlg {
  position: fixed; z-index: 999; box-sizing: border-box; display: flex; flex-direction: column;
  left: 50%; top: 50%; width: min(460px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 48px));
  border-radius: 22px; overflow: hidden; opacity: 0;
  background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.35), 0 0 0 0.5px var(--line);
  font-family: var(--savvy-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif);
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
.db { overflow: auto; overscroll-behavior: contain; padding: 4px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
.db .map img { max-height: 70vh; }

:host(:not([kbd])) :focus { outline: none; }
:host([kbd]) :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; }
@media (prefers-contrast: more) {
  ha-card { border-width: 1.5px; }
  .status, .meta, .cap, .hint, .totals, .tile .tc, .dk .dc { color: var(--primary-text-color); opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) { ha-card { transition: none; } }

@container (max-width: 340px) {
  .ring { width: 54px; height: 54px; }
  .name { font-size: 16px; line-height: 21px; }
  .ctl { width: 38px; }
  .primary .pl { display: none; }
  .controls .primary .pl { display: inline; }
}
@container (max-width: 280px) {
  :host([compact]) .primary .pl { display: none; }
  :host([compact]) .primary { padding: 0 10px; }
}
`;

class VacuumCard extends HTMLElement {
  static getConfigElement() { return document.createElement(EDITOR); }

  static getStubConfig(hass) {
    const v = Object.keys(hass?.states || {}).find((id) => id.startsWith("vacuum."));
    return { entity: v || "vacuum.example" };
  }

  constructor() {
    super();
    watchKeyboard(this);
    this._job = (now, dt) => this._frame(now, dt);
    this._onscreen = true;
    this._expect = null;          // { state, until, label } optimistic vacuum activity
    this._expectSw = new Map();   // switch/select id -> { state, until }
    this._running = new Map();    // routine id -> until (optimistic "Starting…")
    this._picked = [];            // selected room ids, in cleaning order
    this._rooms = null;           // { mode: "area"|"segment"|"none", list: [{id, name, icon}] }
  }

  setConfig(config) {
    if (!config?.entity || !String(config.entity).startsWith("vacuum.")) {
      throw new Error("savvy-vacuum-card: \"entity\" must be a vacuum entity");
    }
    // layout: compact is the one-row version (the pre-Savvy compact: true still works)
    this._compact = config.layout === "compact" || config.compact === true;
    // an editor dropdown can't say false: "off" means the same
    config = { ...config };
    for (const k of ["map", "rooms", "routines", "modes", "dock", "maintenance", "stats"]) if (config[k] === "off") config[k] = false;
    this._config = { battery_warn: 20, battery_critical: 10, map: true, rooms: "auto", routines: "auto",
      modes: "auto", dock: "auto", maintenance: "auto", stats: "auto", ...config };
    this._disc = null;
    if (this._root) {
      this._build();
      if (this._hass) this._update();
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!this._root) this._build();
    this._update();
    if (first && !this._compact) this._loadRooms();
  }

  connectedCallback() {
    this._observe();
    this._ticker = this._ticker || setInterval(() => { if (this._onscreen && this._hass) this._update(); }, TICK_MS);
    this._wake();
  }
  disconnectedCallback() {
    Clock.remove(this._job);
    this._io?.disconnect();
    this._ro?.disconnect();
    clearInterval(this._ticker);
    this._ticker = 0;
    this._closeDialog(true);
    this._finishClosing();
  }

  getCardSize() { return this._compact ? 1 : 5; }
  getGridOptions() {
    return this._compact ? { columns: 12, min_columns: 6, rows: "auto" } : { columns: 12, min_columns: 6, rows: "auto" };
  }

  // ---------- discovery ----------
  // Every entity on the vacuum's device, grouped by what it means. Cached against the
  // registry objects' identity, which only change on config edits.
  _discover() {
    const h = this._hass, c = this._config;
    if (this._disc && this._discReg === h.entities && this._discDev === h.devices) return this._disc;
    this._discReg = h.entities;
    this._discDev = h.devices;
    const vac = c.entity, dev = h.entities?.[vac]?.device_id;
    const exclude = new Set([].concat(c.exclude || []));
    const out = { one: {}, alerts: [], dockInfo: [], dockActions: [], settings: [], consumables: [], routines: [], selects: [], images: [], problems: [] };
    const ids = [];
    if (dev) for (const id in h.entities) {
      const e = h.entities[id];
      if (e.device_id !== dev || id === vac || e.hidden || e.disabled_by || exclude.has(id)) continue;
      ids.push(id);
    }
    const keyOf = (id) => {
      const e = h.entities[id], tk = e?.translation_key;
      if (tk) return tk;
      // older cores: fall back to the id suffix
      const all = [...Object.values(ONE).map((x) => x[1]), ...Object.keys(ALERTS), ...Object.keys(DOCK_INFO),
        ...Object.keys(DOCK_ACTIONS), ...Object.keys(SETTINGS), ...Object.keys(CONSUMABLES), ...Object.keys(MODE_NAMES)];
      return all.find((k) => id.endsWith(`_${k}`)) || null;
    };
    for (const id of ids) {
      const [domain] = id.split("."), e = h.entities[id], key = keyOf(id);
      const hit = Object.entries(ONE).find(([, [d, k]]) => d === domain && k === key);
      if (hit && !out.one[hit[0]]) { out.one[hit[0]] = id; continue; }
      if (domain === "sensor" && !out.one.battery && h.states[id]?.attributes.device_class === "battery") { out.one.battery = id; continue; }
      if (domain === "binary_sensor" && ALERTS[key]) { out.alerts.push({ id, key }); continue; }
      if (domain === "binary_sensor" && DOCK_INFO[key]) { out.dockInfo.push({ id, key }); continue; }
      if (domain === "binary_sensor" && h.states[id]?.attributes.device_class === "problem") { out.alerts.push({ id, key: key || id }); continue; }
      if (domain === "switch" && DOCK_ACTIONS[key]) { out.dockActions.push({ id, key }); continue; }
      if (domain === "switch" && (SETTINGS[key] || e.entity_category === "config")) { out.settings.push({ id, key }); continue; }
      if (domain === "sensor" && (CONSUMABLES[key] || /_time_left$|_remaining$|consumable/.test(key || ""))
        && key !== "mop_drying_remaining_time") { out.consumables.push({ id, key }); continue; }
      if (domain === "select") { out.selects.push({ id, key }); continue; }
      if (domain === "image") { out.images.push(id); continue; }
      // a Roborock routine: a button with no translation_key and no category
      if (domain === "button" && !e.translation_key && !e.entity_category && !/reset|consumable/.test(id)) {
        out.routines.push(id);
        continue;
      }
    }
    if (!out.one.battery && h.states[vac]?.attributes.battery_level != null) out.one.batteryAttr = true;
    this._disc = out;
    return out;
  }

  _feat(bit) { return !!((this._hass.states[this._config.entity]?.attributes.supported_features || 0) & bit); }

  // Rooms: HA areas mapped to the vacuum's segments when configured, otherwise the
  // robot's own segments. Read once (and on registry changes), never per frame.
  async _loadRooms() {
    const h = this._hass, c = this._config;
    if (c.rooms === false || this._roomsLoading) return;
    this._roomsLoading = true;
    let list = null, mode = "none";
    try {
      const entry = await h.callWS({ type: "config/entity_registry/get", entity_id: c.entity });
      const mapping = entry?.options?.vacuum?.area_mapping;
      if (mapping && Object.keys(mapping).length && this._feat(FEAT.CLEAN_AREA)) {
        mode = "area";
        list = Object.keys(mapping).filter((a) => mapping[a]?.length).map((a) => ({
          id: a, name: h.areas?.[a]?.name || title(a), icon: h.areas?.[a]?.icon || "mdi:texture-box",
        }));
      }
    } catch (err) { /* older core or no permission: try segments */ }
    if (!list) {
      try {
        const res = await h.callWS({ type: "vacuum/get_segments", entity_id: c.entity });
        const segs = res?.segments || [];
        if (segs.length) {
          mode = "segment";
          list = segs.map((s) => ({ id: String(s.id), name: s.name || `Room ${s.id}`, icon: "mdi:texture-box", group: s.group }));
        }
      } catch (err) { /* not supported */ }
    }
    if (list && Array.isArray(c.rooms)) {
      const want = c.rooms.map((r) => (typeof r === "object" ? r : { id: r }));
      list = want.map((w) => {
        const found = list.find((r) => r.id === w.id || r.id === w.area || r.name.toLowerCase() === String(w.id).toLowerCase());
        return found ? { ...found, ...(w.name ? { name: w.name } : {}), ...(w.icon ? { icon: w.icon } : {}) } : null;
      }).filter(Boolean);
    } else if (list && mode === "area") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    this._rooms = { mode, list: list || [] };
    this._roomsLoading = false;
    this._update();
  }

  // ---------- build ----------
  _build() {
    this._root = this._shadow || (this._shadow = this.attachShadow({ mode: "open" }));
    this._closeDialog(true);
    this._finishClosing();
    this._springs = [];
    this._pressNodes = [];
    this.toggleAttribute("compact", this._compact);
    this._root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="banner" id="banner" role="button" tabindex="0" hidden>
          <ha-icon id="bIcon"></ha-icon><span class="bt"><span class="b1" id="b1"></span><span class="b2" id="b2"></span></span>
        </div>
        <div class="hero">
          <div class="ring" id="ring" role="button" tabindex="0">
            <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="18"></circle>
              <circle class="fill" id="rfill" cx="20" cy="20" r="18" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"></circle></svg>
            <span class="bot"><ha-icon icon="mdi:robot-vacuum"></ha-icon></span>
            <span class="bolt" id="bolt" hidden><ha-icon icon="mdi:lightning-bolt"></ha-icon></span>
          </div>
          <div class="who" id="who" role="button" tabindex="0">
            <span class="name" id="name"></span>
            <span class="status" id="status"><span class="s1" id="s1"></span><span class="s2" id="s2"></span></span>
            <span class="meta" id="meta"><span class="batt" id="batt"></span><span class="stats" id="stats"></span></span>
          </div>
          <button class="primary" id="mainBtn" ${this._compact ? "" : "hidden"}><ha-icon id="mainIcon"></ha-icon><span class="pl" id="mainLabel"></span></button>
        </div>
        <div class="prog" id="prog" hidden><i id="progFill"></i></div>
        ${this._compact ? "" : `
        <div class="controls" id="controls">
          <button class="primary" id="ctlMain"><ha-icon id="ctlMainIcon"></ha-icon><span class="pl" id="ctlMainLabel"></span></button>
          <button class="ctl" id="ctlDock" aria-label="Return to dock"><ha-icon icon="mdi:home-import-outline"></ha-icon></button>
          <button class="ctl" id="ctlStop" aria-label="Stop (hold)"><ha-icon icon="mdi:stop"></ha-icon></button>
          <button class="ctl" id="ctlLocate" aria-label="Locate"><ha-icon icon="mdi:map-marker-question-outline"></ha-icon></button>
          <button class="ctl" id="ctlMap" aria-label="Map" hidden><ha-icon icon="mdi:map-outline"></ha-icon></button>
        </div>
        <div id="inlineMap"></div>
        <div class="routines" id="routines" role="group" aria-label="Routines"></div>
        <div class="hub" id="hub"></div>
        <div id="holder" hidden>
          <div class="sec" id="mapSec" hidden>
            <div class="chips" id="maps" hidden></div>
            <div class="map" id="map" role="button" tabindex="0" aria-label="Map, open in Home Assistant"><img id="mapImg" alt=""></div>
          </div>
          <div class="sec" id="roomSec" hidden>
            <span class="hint" id="roomAside"></span>
            <div class="chips" id="rooms"></div>
            <div class="rooms-go" id="roomsGo" hidden>
              <button class="primary" id="roomsBtn"><ha-icon icon="mdi:play"></ha-icon><span class="pl" id="roomsLabel"></span></button>
              <button class="clear" id="roomsClear">Clear</button>
            </div>
            <span class="hint" id="roomHint" hidden></span>
            <div class="chips" id="roomExtras" hidden></div>
          </div>
          <div class="sec" id="modeSec" hidden><div class="mgroups" id="modes"></div></div>
          <div class="sec" id="dockSec" hidden>
            <div class="dock" id="dock"></div>
            <div class="chips" id="dockActs" hidden></div>
          </div>
          <div class="sec" id="careSec" hidden>
            <div class="parts" id="parts"></div>
            <div class="chips" id="settings" hidden></div>
            <div class="totals" id="totals" hidden></div>
          </div>
        </div>`}
      </ha-card>`;
    const $ = (id) => this._root.getElementById(id);
    this._el = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (o[k] = $(k))) });
    this._el.card = this._root.querySelector("ha-card");

    this._ringS = new Spring(0, MOTION.ring, "ring");
    this._actS = new Spring(0, MOTION.ui, "ring");
    this._progS = new Spring(0, MOTION.ring, "prog");
    this._springs.push(this._ringS, this._actS, this._progS);
    this._first = true;
    this._nodes = new Map();

    const openInfo = () => this._moreInfo(this._config.entity);
    linkTitle(this._root, this._el.name, titlePathOf(this._config), (el, onTap) => this._press(el, onTap, { haptic: null }));
    this._press(this._el.ring, openInfo, { haptic: null });
    this._press(this._el.who, () => (this._config.navigation_path ? this._navigate(this._config.navigation_path) : openInfo()), { haptic: null });
    this._press(this._el.banner, () => this._moreInfo(this._bannerEntity || this._config.entity), { haptic: null });
    if (this._compact) {
      this._hold(this._el.mainBtn, { onTap: () => this._primary(), onHold: () => this._secondary() });
    } else {
      this._hold(this._el.ctlMain, { onTap: () => this._primary() });
      this._press(this._el.ctlDock, () => this._call("return_to_base", "returning", "Returning"));
      this._hold(this._el.ctlStop, { onHold: () => this._call("stop", "idle", "Stopping"), onTap: () => this._flash("Hold to stop") });
      this._press(this._el.ctlLocate, () => this._call("locate"));
      this._press(this._el.ctlMap, () => this._openDialog("map", this._el.ctlMap), { haptic: null });
      this._press(this._el.map, () => this._moreInfo(this._mapEntity));
      this._hold(this._el.roomsBtn, { onHold: () => this._cleanRooms(), onTap: () => this._flash("Hold to start", true) });
      this._press(this._el.roomsClear, () => { this._picked = []; this._haptic("selection"); this._update(); }, { haptic: null });
    }

    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._fitRow());
    this._ro.observe(this._el.card);
    this._observe();
  }

  _observe() {
    if (!this._root || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => {
      this._onscreen = e.isIntersecting;
      if (this._onscreen) { this._paint(null); this._wake(); }
    });
    this._io.disconnect();
    this._io.observe(this);
  }

  // ---------- gestures ----------
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

  // Hold for anything that starts or ends a whole job from a list (CARD-DESIGN.md
  // 3.1): the button fills for the whole 500ms so the wait is legible, commits with
  // a medium haptic and a pop. A plain tap runs onTap (or nothing).
  _hold(el, { onHold, onTap }) {
    const sink = new Spring(0, MOTION.hold, `h${this._springs.length}`);
    const press = new Spring(0, MOTION.press, `h${this._springs.length}`);
    this._springs.push(sink, press);
    el.__hold = sink;
    el.__spring = press;
    this._pressNodes.push(el);
    let origin = null, timer = 0, fired = false, swallow = false;
    const reset = (motion = MOTION.release) => {
      clearTimeout(timer);
      origin = null;
      press.to(0, motion);
      sink.to(0, MOTION.ui);
      this._wake();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || el.disabled) return;
      origin = [e.clientX, e.clientY];
      fired = false; swallow = false;
      press.to(1, MOTION.press);
      if (onHold) {
        sink.to(1, { response: HOLD_MS / 1000 * 1.1, damping: 1 });
        timer = setTimeout(() => {
          fired = true;
          this._haptic("medium");
          press.to(0, MOTION.pop);
          press.v = -6;
          sink.snap(0);
          origin = null;
          onHold();
          this._wake();
        }, HOLD_MS);
      }
      this._wake();
    });
    el.addEventListener("pointermove", (e) => {
      if (!origin || Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) < SLOP) return;
      swallow = true;
      reset();
    });
    el.addEventListener("pointerup", () => { if (origin) reset(); });
    for (const t of ["pointercancel", "pointerleave"]) el.addEventListener(t, () => { if (origin) { swallow = true; reset(); } });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (el.disabled) return;
      // keyboard / screen reader: Enter commits the hold action directly
      if (e.detail === 0) { (onHold || onTap)?.(); return; }
      if (fired || swallow) { fired = false; swallow = false; return; }
      if (onTap) { this._haptic("light"); onTap(); }
    });
  }

  _flash(msg, inRooms = false) {
    if (inRooms && this._dialog?.kind === "rooms") {
      text(this._el.roomAside, msg);
      clearTimeout(this._asideT);
      this._asideT = setTimeout(() => this._update(), 1600);
      this._asideUntil = Date.now() + 1600;
      return;
    }
    this._flashMsg = msg;
    this._flashUntil = Date.now() + 1600;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => this._update(), 1650);
    this._update();
  }

  // ---------- actions ----------
  _activity() {
    const st = this._hass.states[this._config.entity];
    const real = st?.state;
    if (this._expect) {
      if (Date.now() > this._expect.until || real === this._expect.state) this._expect = null;
      else return this._expect.state;
    }
    return real;
  }

  _call(service, expect, label, data = {}) {
    const h = this._hass, st = h.states[this._config.entity];
    this._flashUntil = 0;
    if (!st || st.state === "unavailable") return;
    h.callService("vacuum", service, data, { entity_id: this._config.entity });
    if (expect) this._expect = { state: expect, label, until: Date.now() + PREDICT_MS };
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }

  // Start runs the configured start (e.g. an app routine button) or
  // vacuum.start; a paused job always *resumes* with vacuum.start, never a new routine.
  _start() {
    const h = this._hass, s = this._config.start;
    this._flashUntil = 0;
    if (s && typeof s === "string" && !s.startsWith("vacuum.")) {
      const [d] = s.split(".");
      if (!h.states[s]) return this._call("start", "cleaning", "Starting");
      h.callService(d, d === "script" || d === "scene" ? "turn_on" : "press", {}, { entity_id: s });
      this._expect = { state: "cleaning", label: "Starting", until: Date.now() + PREDICT_MS * 2 };
      setTimeout(() => this._update(), PREDICT_MS * 2 + 50);
      return this._update();
    }
    this._call("start", "cleaning", "Starting");
  }

  _primaryKind() {
    const a = this._activity();
    if (a === "cleaning") return this._feat(FEAT.PAUSE) ? "pause" : "stop";
    if (a === "paused") return "resume";
    if (a === "returning") return this._feat(FEAT.PAUSE) ? "pause" : "stop";
    return "start";
  }

  _primary() {
    const k = this._primaryKind();
    if (k === "pause") return this._call("pause", "paused", "Pausing");
    if (k === "stop") return this._call("stop", "idle", "Stopping");
    if (k === "resume") return this._call("start", "cleaning", "Resuming");
    this._start();
  }

  // mini: hold the main button to send it home (or stop when it's already there)
  _secondary() {
    const a = this._activity();
    if (a === "docked") return this._flash("Already docked");
    this._call("return_to_base", "returning", "Returning");
  }

  _cleanRooms() {
    const h = this._hass, ids = [...this._picked], r = this._rooms;
    if (!ids.length || !r) return;
    this._flashUntil = 0;
    if (r.mode === "area") {
      h.callService("vacuum", "clean_area", { cleaning_area_id: ids }, { entity_id: this._config.entity });
    } else {
      // Roborock's own segment command; the robot cleans in the order given
      h.callService("vacuum", "send_command", {
        command: "app_segment_clean",
        params: [{ segments: ids.map((x) => (Number.isFinite(+x) ? +x : x)), repeat: 1 }],
      }, { entity_id: this._config.entity });
    }
    this._expect = { state: "cleaning", label: `Cleaning ${ids.length} room${ids.length > 1 ? "s" : ""}`, until: Date.now() + PREDICT_MS * 2 };
    this._picked = [];
    // back to the card, where the status now says what's happening
    this._closeDialog();
    setTimeout(() => this._update(), PREDICT_MS * 2 + 50);
    this._update();
  }

  _runRoutine(id) {
    const st = this._hass.states[id];
    if (!st || st.state === "unavailable") return;
    this._flashUntil = 0;
    this._hass.callService("button", "press", {}, { entity_id: id });
    this._running.set(id, Date.now() + PREDICT_MS * 2);
    this._expect = { state: "cleaning", label: "Starting", until: Date.now() + PREDICT_MS * 2 };
    setTimeout(() => this._update(), PREDICT_MS * 2 + 50);
    this._update();
  }

  _toggleSwitch(id) {
    const h = this._hass, st = h.states[id];
    if (!st || isOff(st)) return;
    const on = this._swOn(id);
    h.callService("switch", "toggle", {}, { entity_id: id });
    this._expectSw.set(id, { state: on ? "off" : "on", until: Date.now() + PREDICT_MS });
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }
  _swOn(id) {
    const st = this._hass.states[id], exp = this._expectSw.get(id);
    if (exp) {
      if (Date.now() > exp.until || st?.state === exp.state) this._expectSw.delete(id);
      else return exp.state === "on";
    }
    return st?.state === "on";
  }

  // ---------- update ----------
  _update() {
    const h = this._hass;
    if (!h || !this._root) return;
    this._reduced = MQ.reduced.matches;
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    const d = this._discover();
    this._renderHero(d);
    if (!this._compact) {
      this._renderBanner(d);
      this._renderControls();
      this._renderMap(d);
      this._renderRooms();
      this._renderRoutines(d);
      this._renderModes(d);
      this._renderDock(d);
      this._renderCare(d);
      this._renderHub(d);
    }
    if (this._first) { this._first = false; requestAnimationFrame(() => this._paint(null)); }
    this._wake();
  }

  _battery(d) {
    const h = this._hass, c = this._config;
    if (d.one.battery) return num(h.states[d.one.battery]);
    return parseFloat(h.states[c.entity]?.attributes.battery_level);
  }

  _problems(d) {
    const h = this._hass, out = [];
    for (const k of ["vacError", "dockError"]) {
      const id = d.one[k], st = h.states[id];
      if (st && !NO_ERROR.has(String(st.state).toLowerCase())) {
        let w; try { w = h.formatEntityState(st); } catch (err) { w = title(st.state); }
        out.push({ level: "alert", icon: "mdi:alert-circle", text: w, sub: k === "dockError" ? "Dock error" : "Vacuum error", id });
      }
    }
    const vs = h.states[this._config.entity];
    if (vs?.state === "error" && !out.length) out.push({ level: "alert", icon: "mdi:alert-circle", text: "Needs attention", sub: "Vacuum error", id: this._config.entity });
    for (const a of d.alerts) {
      const st = h.states[a.id];
      if (st?.state === "on") {
        const [name, icon] = ALERTS[a.key] || [st.attributes.friendly_name || title(a.key), "mdi:alert"];
        out.push({ level: "warn", icon, text: name, sub: "Dock", id: a.id });
      }
    }
    return out;
  }

  _renderHero(d) {
    const h = this._hass, c = this._config, el = this._el, st = h.states[c.entity];
    const act = this._activity();
    const off = !st || st.state === "unavailable";
    text(el.name, c.name || c.title || st?.attributes.friendly_name || "Vacuum");

    // the rich status sensor says what's really happening ("Washing the mop")
    let s1;
    const flashing = this._flashUntil && Date.now() < this._flashUntil;
    if (flashing) s1 = this._flashMsg;
    else if (off) s1 = st ? "Unavailable" : "Not found";
    else if (this._expect) s1 = `${this._expect.label}…`;
    else {
      const rich = h.states[d.one.status];
      try { s1 = rich && !isOff(rich) ? h.formatEntityState(rich) : h.formatEntityState(st); }
      catch (err) { s1 = title(rich?.state || st.state); }
    }
    const cleaning = act === "cleaning";
    const pct = num(h.states[d.one.progress]);
    let s2 = "";
    if (!off && !this._expect && !flashing) {
      if (cleaning && Number.isFinite(pct)) s2 = `${Math.round(pct)}%`;
      else if (st) {
        const t = Date.parse(st.last_changed);
        s2 = act === "docked" ? "" : since(t, true);
      }
    }
    const problems = off ? [] : this._problems(d);
    const worst = problems.find((p) => p.level === "alert") || problems[0];
    attr(el.status, "data-level", worst && !this._expect ? worst.level : null);
    if (worst && this._compact && !this._expect && !flashing) { s1 = worst.text; s2 = ""; }
    text(el.s1, s1);
    text(el.s2, s2);

    const batt = this._battery(d);
    const charging = d.one.charging ? h.states[d.one.charging]?.state === "on" : act === "docked" && batt < 100;
    const lvl = !Number.isFinite(batt) ? null : batt <= c.battery_critical ? "alert" : batt <= c.battery_warn ? "warn" : null;
    text(el.batt, Number.isFinite(batt) ? `${Math.round(batt)}%${charging ? " charging" : ""}` : "");
    attr(el.batt, "data-level", lvl);
    el.meta.hidden = this._compact;
    put(el.ring, "--ring-c", lvl === "alert" ? "var(--alert-c)" : lvl === "warn" ? "var(--warn-c)" : "var(--acc)");
    el.bolt.hidden = !charging;
    this._ringS.to(Number.isFinite(batt) ? clamp(batt / 100) : 0, MOTION.ring);
    this._actS.to(cleaning || act === "returning" ? 1 : 0, MOTION.ui);
    // the glow: red for a problem, amber for a warning, the accent while it works; nothing when it rests
    const glowLevel = worst && !this._expect ? worst.level : null;
    stateGlow(c, el.card, glowLevel === "alert" ? [224, 102, 102] : glowLevel === "warn" ? [232, 163, 61] : cleaning || act === "returning" ? toRgb(getComputedStyle(el.card).getPropertyValue("--acc").trim() || COLORS.accent) : null, glowLevel ? 0.9 : 0.7);
    attr(el.ring, "aria-label", `${el.name.textContent}, battery ${Number.isFinite(batt) ? Math.round(batt) + "%" : "unknown"}`);
    attr(el.who, "aria-label", `${el.name.textContent}, ${s1}${s2 ? `, ${s2}` : ""}`);

    el.prog.hidden = !(cleaning && Number.isFinite(pct));
    this._progS.to(Number.isFinite(pct) ? clamp(pct / 100) : 0, MOTION.ring);

    if (this._compact) {
      const kind = this._primaryKind();
      const [icon, label, quiet] = {
        start: ["mdi:play", "Start", false], pause: ["mdi:pause", "Pause", true],
        resume: ["mdi:play", "Resume", false], stop: ["mdi:stop", "Stop", true],
      }[kind];
      attr(el.mainIcon, "icon", icon);
      text(el.mainLabel, label);
      attr(el.mainBtn, "data-kind", quiet ? "quiet" : null);
      attr(el.mainBtn, "aria-label", `${label}${kind !== "start" ? "; hold to send it home" : "; hold to send it home"}`);
      el.mainBtn.disabled = off;
    } else {
      // one quiet line: the running job's time and area, or when the last one finished
      let stats = "";
      if (c.stats !== false) {
        const time = toSeconds(h.states[d.one.cleanTime]), area = num(h.states[d.one.cleanArea]);
        const areaU = h.states[d.one.cleanArea]?.attributes.unit_of_measurement || "m²";
        const job = [Number.isFinite(time) ? hm(time) : null, Number.isFinite(area) ? `${Math.round(area)} ${areaU}` : null].filter(Boolean).join(" · ");
        if (cleaning || act === "paused" || act === "returning") stats = job;
        else {
          const t1 = Date.parse(h.states[d.one.lastEnd]?.state), t0 = Date.parse(h.states[d.one.lastStart]?.state);
          const t = Number.isFinite(t1) ? t1 : t0;
          if (Number.isFinite(t)) stats = `Last clean ${dayTime(t, h.locale?.language).replace(/^(Today|Yesterday)/, (m) => m.toLowerCase())}${job ? ` · ${job}` : ""}`;
        }
      }
      text(el.stats, stats);
      attr(el.stats, "title", stats || null);
    }
  }

  _renderBanner(d) {
    const el = this._el, st = this._hass.states[this._config.entity];
    const problems = !st || st.state === "unavailable" ? [] : this._problems(d);
    const p = problems.find((x) => x.level === "alert") || problems[0];
    el.banner.hidden = !p;
    if (!p) { this._bannerEntity = null; return; }
    this._bannerEntity = p.id;
    attr(el.banner, "data-level", p.level);
    attr(el.bIcon, "icon", p.icon);
    text(el.b1, p.text);
    text(el.b2, `${p.sub}${problems.length > 1 ? ` · +${problems.length - 1} more` : ""} · tap for details`);
    attr(el.banner, "aria-label", `${p.text}. ${p.sub}.`);
  }

  _renderControls() {
    const el = this._el, st = this._hass.states[this._config.entity];
    const off = !st || st.state === "unavailable";
    const kind = this._primaryKind(), a = this._activity();
    const [icon, label, quiet] = {
      start: ["mdi:play", this._config.start_name || "Start", false], pause: ["mdi:pause", "Pause", true],
      resume: ["mdi:play", "Resume", false], stop: ["mdi:stop", "Stop", true],
    }[kind];
    attr(el.ctlMainIcon, "icon", icon);
    text(el.ctlMainLabel, label);
    attr(el.ctlMain, "data-kind", quiet ? "quiet" : null);
    el.ctlMain.disabled = off;
    el.ctlDock.hidden = !this._feat(FEAT.RETURN_HOME);
    el.ctlDock.disabled = off || a === "docked" || a === "returning";
    el.ctlStop.hidden = !this._feat(FEAT.STOP) || kind === "stop";
    el.ctlStop.disabled = off || !["cleaning", "paused", "returning"].includes(a);
    el.ctlLocate.hidden = !this._feat(FEAT.LOCATE);
    el.ctlLocate.disabled = off;
  }

  _renderMap(d) {
    const h = this._hass, c = this._config, el = this._el;
    let id = null;
    if (c.map === false) id = null;
    else if (typeof c.map === "string" && c.map.includes(".")) id = c.map;   // an image/camera entity
    else {
      // the image for the selected map when there are several
      const sel = h.states[d.one.selectedMap]?.state;
      id = d.images.find((i) => sel && (h.states[i]?.attributes.friendly_name || "").toLowerCase().endsWith(String(sel).toLowerCase()))
        || d.images[0] || null;
    }
    const st = id ? h.states[id] : null;
    this._mapEntity = id;
    el.mapSec.hidden = !st;
    // map: true/"popup" -> a Map button opens it; "inline" -> in the card; false -> nothing
    const inline = c.map === "inline";
    el.ctlMap.hidden = !st || inline;
    if (inline && st && el.mapSec.parentElement !== el.inlineMap) el.inlineMap.appendChild(el.mapSec);
    if (!st) return;
    const pic = st.attributes.entity_picture;
    if (pic && el.mapImg.__src !== pic) { el.mapImg.__src = pic; el.mapImg.src = pic; }
    if (c.map_max_height) put(el.map, "--map-max", `${c.map_max_height}px`);
    // map picker, only when the vacuum knows several maps
    const selId = d.one.selectedMap, sel = h.states[selId];
    const opts = sel?.attributes.options || [];
    el.maps.hidden = opts.length < 2;
    if (opts.length > 1) {
      this._chipList(el.maps, opts.map((o) => ({
        key: `map:${o}`, icon: "mdi:map-outline", label: this._fmtOption(sel, o), on: sel.state === o,
        tap: () => this._selectOption(selId, o),
      })));
    }
  }

  _renderRooms() {
    const el = this._el, r = this._rooms, c = this._config;
    el.roomSec.hidden = c.rooms === false || !r || (!r.list.length && r.mode === "none" && !this._feat(FEAT.CLEAN_AREA));
    if (el.roomSec.hidden) return;
    if (!r.list.length) {
      el.roomHint.hidden = false;
      text(el.roomHint, "No rooms yet. Map the vacuum's rooms to your areas in its entity settings (Areas), then they'll appear here.");
      el.rooms.hidden = true;
      el.roomAside.hidden = true;
      el.roomsGo.hidden = true;
      return;
    }
    el.roomHint.hidden = true;
    el.rooms.hidden = false;
    el.roomAside.hidden = false;
    this._picked = this._picked.filter((id) => r.list.some((x) => x.id === id));
    const off = this._hass.states[c.entity]?.state === "unavailable";
    this._chipList(el.rooms, r.list.map((room) => {
      const n = this._picked.indexOf(room.id);
      return {
        key: `room:${room.id}`, icon: room.icon, label: room.name, on: n >= 0, order: n >= 0 ? n + 1 : null, off,
        pressed: n >= 0,
        tap: () => {
          const i = this._picked.indexOf(room.id);
          if (i >= 0) this._picked.splice(i, 1); else this._picked.push(room.id);
          this._haptic("selection");
          this._update();
        },
      };
    }), { haptic: null });
    const n = this._picked.length;
    el.roomsGo.hidden = !n;
    text(el.roomsLabel, `Clean ${n} room${n === 1 ? "" : "s"} · hold`);
    attr(el.roomsBtn, "aria-label", `Clean ${n} room${n === 1 ? "" : "s"} in the order picked. Hold to start.`);
    el.roomsBtn.disabled = off;
    if (!this._asideUntil || Date.now() > this._asideUntil) text(el.roomAside, n ? "Cleaned in the order you picked" : "Tap rooms in the order to clean them");
    const spot = this._feat(FEAT.CLEAN_SPOT);
    el.roomExtras.hidden = !spot;
    if (spot) this._chipList(el.roomExtras, [{ key: "spot", icon: "mdi:target", label: "Spot clean here", off, tap: () => { this._call("clean_spot", "cleaning", "Spot cleaning"); this._closeDialog(); } }]);
  }

  _renderRoutines(d) {
    const h = this._hass, c = this._config, el = this._el;
    let list = [];
    if (c.routines === false) list = [];
    else if (Array.isArray(c.routines)) list = c.routines.map((r) => (typeof r === "string" ? { entity: r } : r)).filter((r) => r.entity);
    else list = d.routines.map((id) => ({ entity: id }));
    el.routines.hidden = !list.length;
    if (!list.length) return;
    const box = el.routines, seen = new Set();
    const names = this._routineNames(list);
    for (const r of list) {
      const key = `rt:${r.entity}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("button");
        node.className = "rt";
        node.innerHTML = `<ha-icon></ha-icon><span class="rn"></span>`;
        this._press(node, () => this._runRoutine(node.__id));
        node.__on = new Spring(0, MOTION.ui, key);
        this._springs.push(node.__on);
        this._nodes.set(key, node);
      }
      node.__id = r.entity;
      box.appendChild(node);
      const st = h.states[r.entity];
      const name = r.name || names.get(r.entity);
      // "Starting…" lives in the hero's status; the routine just lights up meanwhile
      const running = (this._running.get(r.entity) || 0) > Date.now();
      attr(node.querySelector("ha-icon"), "icon", r.icon || routineIcon(name));
      text(node.querySelector(".rn"), name);
      attr(node, "data-off", !st || st.state === "unavailable" ? "" : null);
      attr(node, "aria-label", `Start routine: ${name}`);
      node.__on.to(running ? 1 : 0, MOTION.ui);
    }
    this._prune(box, seen, "rt:");
    this._fitRow();
  }

  _fitRow() {
    const row = this._el?.routines;
    if (!row || row.hidden) return;
    row.toggleAttribute("data-overflow", row.scrollWidth > row.clientWidth + 1);
  }

  // Routine buttons are named "<device> <routine>" ("S8 MaxV Ultra Vacuum & Mop").
  // Drop the device's own name, then any leading words every routine shares, so
  // the tiles say "Vacuum", "Mop", "Vacuum & Mop".
  _routineNames(list) {
    const h = this._hass, out = new Map();
    const dev = h.devices?.[h.entities?.[this._config.entity]?.device_id];
    const prefixes = [dev?.name_by_user, dev?.name, h.states[this._config.entity]?.attributes.friendly_name].filter(Boolean);
    const raw = list.map((r) => {
      let n = h.states[r.entity]?.attributes.friendly_name || title(r.entity.split(".")[1]);
      for (const p of prefixes) if (n.toLowerCase().startsWith(`${p.toLowerCase()} `)) { n = n.slice(p.length + 1); break; }
      return [r.entity, n.split(/\s+/)];
    });
    if (raw.length > 1) {
      let k = 0;
      const minLen = Math.min(...raw.map(([, w]) => w.length));
      while (k < minLen - 1 && raw.every(([, w]) => w[k].toLowerCase() === raw[0][1][k].toLowerCase())) k++;
      // one shared word ("Morning clean" / "Morning mop") is meaning, not a device name
      if (k < 2) k = 0;
      for (const [id, w] of raw) out.set(id, w.slice(k).join(" "));
    } else for (const [id, w] of raw) out.set(id, w.join(" "));
    return out;
  }

  _fmtOption(st, o) {
    try { return this._hass.formatEntityState(st, o); } catch (err) { return title(o); }
  }

  _modes(d) {
    const h = this._hass, c = this._config, vs = h.states[c.entity], out = [];
    if (c.modes === false) return out;
    if (this._feat(FEAT.FAN_SPEED) && vs?.attributes.fan_speed_list?.length) {
      const fmt = (v) => {
        try { return h.formatEntityAttributeValue ? h.formatEntityAttributeValue(vs, "fan_speed", v) : title(v); }
        catch (err) { return title(v); }
      };
      const exp = this._expectSw.get("fan_speed");
      let value = vs.attributes.fan_speed;
      if (exp) { if (Date.now() > exp.until || value === exp.state) this._expectSw.delete("fan_speed"); else value = exp.state; }
      out.push({
        key: "fan_speed", name: MODE_NAMES.fan_speed, value, label: fmt(value), options: vs.attributes.fan_speed_list.map((v) => [v, fmt(v)]),
        pick: (v) => {
          h.callService("vacuum", "set_fan_speed", { fan_speed: v }, { entity_id: c.entity });
          this._expectSw.set("fan_speed", { state: v, until: Date.now() + PREDICT_MS });
          setTimeout(() => this._update(), PREDICT_MS + 50);
          this._update();
        },
        off: vs.state === "unavailable",
      });
    }
    const skip = new Set(["selected_map", ...[].concat(c.hide_modes || [])]);
    const vname = (vs?.attributes.friendly_name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const s of d.selects) {
      if (skip.has(s.key) || skip.has(s.id)) continue;
      const st = h.states[s.id];
      if (!st) continue;
      const exp = this._expectSw.get(s.id);
      let value = st.state;
      if (exp) { if (Date.now() > exp.until || st.state === exp.state) this._expectSw.delete(s.id); else value = exp.state; }
      out.push({
        key: s.id, name: MODE_NAMES[s.key] || (st.attributes.friendly_name || "").replace(new RegExp(`^${vname}\\s+`, "i"), "") || title(s.key),
        value, label: this._fmtOption(st, value), options: (st.attributes.options || []).map((o) => [o, this._fmtOption(st, o)]),
        pick: (v) => this._selectOption(s.id, v), off: isOff(st),
      });
    }
    return out;
  }

  _renderModes(d) {
    const el = this._el, modes = this._modes(d);
    this._modeList = modes;
    el.modeSec.hidden = !modes.length;
    const box = el.modes, seen = new Set();
    for (const m of modes) {
      const key = `mg:${m.key}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "mgroup";
        const chipsId = `mgc-${m.key.replace(/[^a-z0-9]+/gi, "_")}`;
        node.innerHTML = `<span class="cap"></span><div class="chips" id="${chipsId}" role="radiogroup"></div>`;
        this._nodes.set(key, node);
      }
      box.appendChild(node);
      text(node.querySelector(".cap"), m.name);
      const chips = node.querySelector(".chips");
      attr(chips, "aria-label", m.name);
      this._chipList(chips, m.options.map(([v, label]) => ({
        key: v, icon: v === m.value ? "mdi:check" : null, label, on: v === m.value, pressed: v === m.value, off: m.off,
        tap: () => { if (v !== m.value) m.pick(v); },
      })), { haptic: "selection" });
    }
    this._prune(box, seen, "mg:");
  }

  _selectOption(id, option) {
    const st = this._hass.states[id];
    if (!st || isOff(st)) return;
    this._flashUntil = 0;
    this._hass.callService("select", "select_option", { option }, { entity_id: id });
    this._expectSw.set(id, { state: option, until: Date.now() + PREDICT_MS });
    setTimeout(() => this._update(), PREDICT_MS + 50);
    this._update();
  }

  _renderDock(d) {
    const h = this._hass, c = this._config, el = this._el;
    if (c.dock === false) { el.dockSec.hidden = true; return; }
    const items = [];
    for (const a of d.alerts) {
      const st = h.states[a.id];
      if (!st) continue;
      const [name, icon] = ALERTS[a.key] || [st.attributes.friendly_name || title(a.key), "mdi:alert-outline"];
      const short = { water_shortage: "Water", clean_box_empty: "Clean water", dirty_box_full: "Dirty water",
        clean_fluid_empty: "Cleaning fluid", detergent_empty: "Detergent", softener_empty: "Softener" }[a.key] || name;
      const bad = st.state === "on";
      const word = isOff(st) ? "—" : bad ? ({ dirty_box_full: "Full", water_shortage: "Low" }[a.key] || "Empty") : "OK";
      items.push({ key: a.id, icon, value: word, caption: short, level: bad ? "warn" : null });
    }
    for (const x of d.dockInfo) {
      const st = h.states[x.id];
      if (!st) continue;
      const [name, icon, onW, offW] = DOCK_INFO[x.key];
      let value = isOff(st) ? "—" : st.state === "on" ? onW : offW;
      if (x.key === "mop_drying_status" && st.state === "on" && d.one.mopDryLeft) {
        const left = toSeconds(h.states[d.one.mopDryLeft]);
        if (Number.isFinite(left) && left > 0) value = `${hm(left)} left`;
      }
      items.push({ key: x.id, icon, value, caption: name });
    }
    const acts = d.dockActions.map((a) => ({
      key: `act:${a.id}`, icon: DOCK_ACTIONS[a.key][1], label: DOCK_ACTIONS[a.key][0], on: this._swOn(a.id),
      pressed: this._swOn(a.id), off: isOff(h.states[a.id]), tap: () => this._toggleSwitch(a.id),
    }));
    el.dockSec.hidden = !items.length && !acts.length;
    const low = items.find((it) => it.level === "warn");
    const drying = items.find((it) => it.caption === "Mop drying" && /left|Drying/.test(it.value));
    const busy = acts.find((a) => a.on);
    this._dockSummary = low ? { value: `${low.caption} ${low.value.toLowerCase()}`, level: "warn" }
      : busy ? { value: `${busy.label}…`, level: "accent" }
      : drying ? { value: `Drying · ${drying.value.replace(/ left$/, "")}`, level: null }
      : { value: "All OK", level: null };
    const box = el.dock, seen = new Set();
    for (const it of items) {
      const key = `dk:${it.key}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "dk";
        node.innerHTML = `<ha-icon></ha-icon><span class="dt"><span class="dv"></span><span class="dc"></span></span>`;
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        this._press(node, () => this._moreInfo(node.__id), { haptic: null });
        this._nodes.set(key, node);
      }
      node.__id = it.key;
      box.appendChild(node);
      attr(node.querySelector("ha-icon"), "icon", it.icon);
      text(node.querySelector(".dv"), it.value);
      text(node.querySelector(".dc"), it.caption);
      attr(node, "data-level", it.level);
      attr(node, "aria-label", `${it.caption}: ${it.value}`);
    }
    this._prune(box, seen, "dk:");
    el.dockActs.hidden = !acts.length;
    this._chipList(el.dockActs, acts);
  }

  _renderCare(d) {
    const h = this._hass, c = this._config, el = this._el;
    const parts = [];
    if (c.maintenance !== false) {
      const over = typeof c.maintenance === "object" ? c.maintenance : {};
      for (const p of d.consumables) {
        const st = h.states[p.id];
        if (!st) continue;
        const [name, life, icon] = CONSUMABLES[p.key] || [(st.attributes.friendly_name || title(p.key)).replace(/ time left$/i, ""), null, "mdi:cog-outline"];
        const o = over[p.key] || {};
        const left = toHours(st);
        const rated = o.life_hours ?? life;
        const frac = Number.isFinite(left) && rated ? clamp(left / rated) : null;
        const level = Number.isFinite(left) && left <= 0 ? "alert" : frac != null && frac < 0.1 ? "warn" : null;
        parts.push({ id: p.id, name: o.name || name, icon: o.icon || icon, left, frac, level });
      }
    }
    const settings = d.settings.map((s) => {
      const [name, icon] = SETTINGS[s.key] || [(h.states[s.id]?.attributes.friendly_name || title(s.key)), "mdi:toggle-switch-outline"];
      return { key: `set:${s.id}`, icon, label: name, on: this._swOn(s.id), pressed: this._swOn(s.id), off: isOff(h.states[s.id]), tap: () => this._toggleSwitch(s.id) };
    });
    const tc = num(h.states[d.one.totalCount]), tt = toHours(h.states[d.one.totalTime]), ta = num(h.states[d.one.totalArea]);
    const hasTotals = c.stats !== false && (Number.isFinite(tc) || Number.isFinite(tt) || Number.isFinite(ta));
    el.careSec.hidden = !parts.length && !settings.length && !hasTotals;
    if (el.careSec.hidden) return;

    // the tile names the most urgent part; otherwise the one wearing out soonest
    const needs = parts.filter((p) => p.level);
    const worst = needs.find((p) => p.level === "alert") || needs[0];
    const soonest = [...parts].filter((p) => p.frac != null).sort((a, b) => a.frac - b.frac)[0];
    this._careSummary = worst ? { value: `${worst.name} · ${hoursLeft(worst.left)}`, level: worst.level }
      : parts.length ? { value: soonest ? `All OK · ${soonest.name} ${Math.round(soonest.frac * 100)}%` : "All OK", level: null }
      : { value: settings.length ? `${settings.length} settings` : "Totals", level: null };

    const box = el.parts, seen = new Set();
    for (const p of parts) {
      const key = `part:${p.id}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "part";
        node.innerHTML = `<ha-icon></ha-icon><span class="pn"></span><span class="pl"></span><span class="pb"><i></i></span>`;
        attr(node, "role", "button");
        attr(node, "tabindex", "0");
        this._press(node, () => this._moreInfo(node.__id), { haptic: null });
        node.__bar = new Spring(0, MOTION.ring, key);
        this._springs.push(node.__bar);
        this._nodes.set(key, node);
      }
      node.__id = p.id;
      box.appendChild(node);
      attr(node.querySelector("ha-icon"), "icon", p.icon);
      text(node.querySelector(".pn"), p.name);
      text(node.querySelector(".pl"), hoursLeft(p.left));
      attr(node, "data-level", p.level);
      node.querySelector(".pb").hidden = p.frac == null;
      node.__bar.to(p.frac ?? 0, MOTION.ring);
      attr(node, "aria-label", `${p.name}: ${hoursLeft(p.left)}${p.frac != null ? `, ${Math.round(p.frac * 100)}% of its life` : ""}`);
    }
    this._prune(box, seen, "part:");
    el.settings.hidden = !settings.length;
    this._chipList(el.settings, settings);
    el.totals.hidden = !hasTotals;
    if (hasTotals) {
      const areaU = h.states[d.one.totalArea]?.attributes.unit_of_measurement || "m²";
      const bits = [];
      if (Number.isFinite(tc)) bits.push(`<span><b>${Math.round(tc).toLocaleString()}</b> cleans</span>`);
      if (Number.isFinite(tt)) bits.push(`<span><b>${Math.round(tt).toLocaleString()}</b> h</span>`);
      if (Number.isFinite(ta)) bits.push(`<span><b>${Math.round(ta).toLocaleString()}</b> ${esc(areaU)}</span>`);
      const html = bits.join("");
      if (el.totals.__html !== html) { el.totals.__html = html; el.totals.innerHTML = html; }
    }
  }

  // a keyed row of chips; each chip keeps its node and springs across updates
  _chipList(box, items, { haptic = "light" } = {}) {
    const seen = new Set(), prefix = `${box.id}|`;
    for (const it of items) {
      const key = prefix + it.key;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("button");
        node.className = "chip";
        node.innerHTML = `<ha-icon></ha-icon><span class="cl"></span>`;
        this._press(node, () => node.__tap?.(), { haptic });
        node.__on = new Spring(0, MOTION.ui, key);
        this._springs.push(node.__on);
        this._nodes.set(key, node);
      }
      node.__tap = it.tap;
      box.appendChild(node);
      const ic = node.querySelector("ha-icon");
      ic.hidden = !it.icon;
      if (it.icon) attr(ic, "icon", it.icon);
      text(node.querySelector(".cl"), it.label);
      let ord = node.querySelector(".ord");
      if (it.order) {
        if (!ord) { ord = document.createElement("span"); ord.className = "ord"; node.prepend(ord); }
        text(ord, String(it.order));
      } else if (ord) ord.remove();
      attr(node, "data-off", it.off ? "" : null);
      node.disabled = !!it.off;
      attr(node, "aria-pressed", it.pressed != null ? String(!!it.pressed) : null);
      attr(node, "aria-label", `${it.label}${it.order ? `, number ${it.order}` : ""}`);
      node.__on.to(it.on ? 1 : 0, MOTION.ui);
    }
    this._prune(box, seen, prefix);
  }

  _prune(box, seen, prefix) {
    for (const [key, node] of this._nodes) {
      if (!key.startsWith(prefix) || seen.has(key)) continue;
      for (const s of [node.__on, node.__bar, node.__spring]) {
        const i = this._springs.indexOf(s);
        if (i >= 0) this._springs.splice(i, 1);
      }
      const p = this._pressNodes.indexOf(node);
      if (p >= 0) this._pressNodes.splice(p, 1);
      node.remove();
      this._nodes.delete(key);
    }
  }

  // ---------- summary tiles ----------
  _renderHub() {
    const el = this._el, tiles = [];
    const r = this._rooms, n = this._picked.length;
    if (!el.roomSec.hidden) {
      tiles.push({ kind: "rooms", icon: "mdi:floor-plan", cap: "Rooms",
        value: !r?.list.length ? "Set up" : n ? `${n} picked` : `${r.list.length} rooms`, level: n ? "accent" : null });
    }
    if (!el.modeSec.hidden) {
      const ml = this._modeList || [];
      tiles.push({ kind: "modes", icon: "mdi:tune-variant", cap: "Modes", value: ml.slice(0, 2).map((m) => m.label).join(" · ") || "—" });
    }
    if (!el.dockSec.hidden) tiles.push({ kind: "dock", icon: "mdi:home-variant-outline", cap: "Dock", ...(this._dockSummary || { value: "—" }) });
    if (!el.careSec.hidden) tiles.push({ kind: "care", icon: "mdi:wrench-outline", cap: "Care", ...(this._careSummary || { value: "—" }) });
    el.hub.hidden = !tiles.length;
    const seen = new Set();
    for (const t of tiles) {
      const key = `hub:${t.kind}`;
      seen.add(key);
      let node = this._nodes.get(key);
      if (!node) {
        node = document.createElement("button");
        node.className = "tile";
        node.innerHTML = `<ha-icon></ha-icon><span class="tt"><span class="tc"></span><span class="tv"></span></span>`;
        attr(node, "aria-haspopup", "dialog");
        this._press(node, () => this._openDialog(t.kind, node), { haptic: null });
        this._nodes.set(key, node);
      }
      el.hub.appendChild(node);
      attr(node.querySelector("ha-icon"), "icon", t.icon);
      text(node.querySelector(".tc"), t.cap);
      text(node.querySelector(".tv"), t.value);
      attr(node, "data-level", t.level || null);
      attr(node, "aria-label", `${t.cap}: ${t.value}. Open`);
    }
    this._prune(el.hub, seen, "hub:");
  }

  // ---------- popup (CARD-DESIGN.md 8) ----------
  // The section itself moves into the popup and back, so it keeps updating live from
  // hass while open, with no second copy of any render code.
  _openDialog(kind, anchor) {
    const secs = { rooms: "roomSec", modes: "modeSec", dock: "dockSec", care: "careSec", map: "mapSec" };
    const titles = { rooms: "Rooms", modes: "Modes", dock: "Dock", care: "Care", map: "Map" };
    const sec = this._el[secs[kind]];
    if (!sec) return;
    this._closeDialog(true);
    this._finishClosing();
    this._haptic("selection");
    const scrim = document.createElement("div");
    scrim.className = "dscrim";
    const dlg = document.createElement("div");
    dlg.className = "dlg";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-label", titles[kind]);
    dlg.innerHTML = `<span class="grab" aria-hidden="true"></span>
      <div class="dh"><span class="dt">${titles[kind]}</span><button class="dx" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="db"></div>`;
    const body = dlg.querySelector(".db");
    body.appendChild(sec);
    // outside ha-card: its container-type would clip a fixed popup taller than the card
    this._root.append(scrim, dlg);
    const place = () => dlg.toggleAttribute("data-sheet", window.innerWidth < 600);
    place();
    const open = new Spring(0, MOTION.sheetIn, "dlg");
    open.to(1, MOTION.sheetIn);
    this._springs.push(open);
    const close = () => this._closeDialog();
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    dlg.querySelector(".dx").addEventListener("click", (e) => { e.stopPropagation(); close(); });
    // deferred a frame so the opening tap doesn't close it straight away
    requestAnimationFrame(() => scrim.addEventListener("pointerdown", close));
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    this._dialog = { kind, sec, scrim, dlg, open, anchor, off: () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    } };
    this._update();
    dlg.querySelector(".dx").focus({ preventScroll: true });
    this._paint(new Set(["dlg"]));
    this._wake();
  }

  _finishClosing() {
    const c = this._closing;
    if (!c) return;
    this._closing = null;
    this._returnSection(c);
    c.dlg.remove();
    c.scrim.remove();
    const i = this._springs.indexOf(c.open);
    if (i >= 0) this._springs.splice(i, 1);
  }

  _returnSection(d) {
    // the map may live inline; everything else goes back to the hidden holder
    const home = d.kind === "map" && this._config.map === "inline" ? this._el.inlineMap : this._el.holder;
    if (d.sec.parentElement !== home) home.appendChild(d.sec);
  }

  _closeDialog(now = false) {
    const d = this._dialog;
    if (!d) return;
    this._dialog = null;
    d.off();
    d.anchor?.focus?.({ preventScroll: true });
    if (now || !this.isConnected) {
      this._returnSection(d);
      d.dlg.remove();
      d.scrim.remove();
      const i = this._springs.indexOf(d.open);
      if (i >= 0) this._springs.splice(i, 1);
      return;
    }
    d.closing = true;
    d.scrim.style.pointerEvents = "none";
    d.open.to(0, MOTION.sheetOut);
    this._finishClosing();
    this._closing = d;
    this._wake();
  }

  // ---------- helpers ----------
  _navigate(path) {
    navigate(path);
  }
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
      // the popup's open/close is the one motion kept under reduced motion (12)
      if (this._reduced && s.group !== "dlg") s.snap();
      else s.step(dt);
      dirty.add(s.group);
    }
    if (!dirty.size) return false;
    if (this._onscreen || dirty.has("dlg")) this._paint(dirty);
    return true;
  }

  _paint(dirty) {
    if (!this._el) return;
    const all = !dirty, red = this._reduced, el = this._el;
    for (const node of this._pressNodes) {
      const s = node.__spring, hs = node.__hold;
      if (s && (all || dirty.has(s.group))) {
        const p = s.x;
        if (red) put(node, "opacity", Math.abs(p) < 1e-4 ? "" : (1 - 0.25 * clamp(p)).toFixed(3));
        else put(node, "transform", Math.abs(p) < 1e-4 ? "" : `scale(${(1 - 0.04 * p).toFixed(4)})`);
      }
      if (hs && (all || dirty.has(hs.group))) put(node, "--hold", clamp(hs.x).toFixed(3));
    }
    if (all || dirty.has("ring")) {
      put(el.rfill, "stroke-dashoffset", (100 - clamp(this._ringS.x) * 100).toFixed(2));
      put(el.ring, "--act", clamp(this._actS.x).toFixed(3));
    }
    if (all || dirty.has("prog")) put(el.progFill, "transform", `scaleX(${clamp(this._progS.x).toFixed(4)})`);
    for (const [key, node] of this._nodes) {
      if (node.__on && (all || dirty.has(key))) put(node, "--on", clamp(node.__on.x).toFixed(3));
      if (node.__bar && (all || dirty.has(key))) put(node.querySelector(".pb i"), "transform", `scaleX(${clamp(node.__bar.x).toFixed(4)})`);
    }
    const dl = this._dialog || this._closing;
    if (dl && (all || dirty.has("dlg"))) {
      const v = dl.open.x, sheet = dl.dlg.hasAttribute("data-sheet");
      put(dl.scrim, "opacity", clamp(v).toFixed(3));
      put(dl.dlg, "opacity", clamp(v * 1.6).toFixed(3));
      put(dl.dlg, "transform", sheet ? `translateY(${((1 - v) * 60).toFixed(2)}px)`
        : `translate(-50%, calc(-50% + ${((1 - v) * 18).toFixed(2)}px)) scale(${(0.97 + 0.03 * v).toFixed(4)})`);
      if (dl.closing && v < 0.02 && dl.open.idle) this._finishClosing();
    }
  }
}

const EDITOR = defineEditor("savvy-vacuum-card", () => {
  const part = (name, label, helper) => ({ name, label, helper, selector: { select: { mode: "dropdown", options: [
    { value: "auto", label: "Automatic" }, { value: "off", label: "Hidden" }] } } });
  return [
    S.entity("entity", "Vacuum", "vacuum"),
    S.titleLink("name"),
    S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }])),
    S.entity("start", "Start action", null, { helper: "A button, script or scene (e.g. an app routine). Empty: the vacuum's own start. Resume after a pause is always a real resume." }),
    S.text("start_name", "Start label"),
    S.nav("navigation_path", "Target page", "Where tapping the name goes."),
    S.section("Parts", [
      { name: "map", label: "Map", helper: "Popup adds a Map button; inline shows it in the card. Or pick an image/camera entity.",
        selector: { select: { mode: "dropdown", custom_value: true, options: [
          { value: "popup", label: "Popup (a Map button)" }, { value: "inline", label: "In the card" }, { value: "off", label: "Hidden" }] } } },
      S.number("map_max_height", "Map height", 120, 1200, 10, "px"),
      part("rooms", "Rooms", "Your areas when mapped, else the robot's own rooms. A custom list is YAML: rooms: [kitchen, …]"),
      part("routines", "Routines", "Your app routines. A custom list is YAML: routines: [{entity, name, icon}]"),
      part("modes", "Modes"), part("dock", "Dock"), part("maintenance", "Maintenance"), part("stats", "Statistics"),
      { name: "hide_modes", label: "Hidden modes", selector: { select: { multiple: true, custom_value: true, options: [] } } },
      { name: "exclude", label: "Exclude", selector: { entity: { multiple: true } } },
    ]),
    S.grid(S.number("battery_warn", "Battery warning", 1, 100, 1, "%"), S.number("battery_critical", "Battery critical", 1, 100, 1, "%")),
  ];
});

registerCard("savvy-vacuum-card", VacuumCard, "Vacuum",
  "Any robot vacuum: live job, map, rooms in order, routines, modes, dock and maintenance, found from the device.");
