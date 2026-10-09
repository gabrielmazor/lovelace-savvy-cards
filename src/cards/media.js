// savvy-media-card: a room's media, organised the way the hardware works: sources feed an
// output.
//   stage    artwork of what's playing, with the title over it (and progress)
//   sources  video boxes as a segmented picker, then the picked one's transport
//   output   the speaker the room actually listens through, with its volume
//   extras   presets, text to speech, the room's alarm clock, your chips
// Bands with nothing in them aren't drawn.
//
// `area` finds the room's players: speakers and receivers are the audio, TVs and the rest
// the video. `video` / `audio` name them instead (and add their own options).
//
//   type: custom:savvy-media-card
//   area: living_room
//   video_output: media_player.soundbar       where the video boxes' sound comes out
//   presets: [{ entity: input_button.radio }]  tts: { action: tts.speak, data: { ... $MSG ... } }
//   layout: compact                            one row: what's playing, its transport, the volume

const VOL_THROTTLE = 400;     // ms between volume writes while dragging
const VOL_PREDICT = 4000;     // how long an unconfirmed level outranks HA's own
const OPTIMISTIC_MS = 4000;   // a console takes its time to wake: hold the guess this long
const MEDIA_MOTION = { art: { response: 0.62, damping: 1 }, grab: { response: 0.4, damping: 1 } };

// media_player supported_features
const F = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREV: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256,
  PLAY_MEDIA: 512, VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096, PLAY: 16384 };
const has = (st, bit) => ((st?.attributes.supported_features || 0) & bit) === bit;
const ACTIVE = new Set(["playing", "buffering"]);
const DEAD = new Set(["off", "unavailable", "unknown", "standby"]);
const PLAYER_ICONS = { tv: "mdi:television", speaker: "mdi:speaker", receiver: "mdi:audio-video", game: "mdi:gamepad-variant", default: "mdi:cast-variant" };
const AUDIO_CLASSES = new Set(["speaker", "receiver"]);
// An LG TV (webOS) says where its sound goes in `sound_output` and takes webostv.select_sound_output.
// The ones that stay in the TV keep the TV's own volume; the rest hand it to the sound output.
const LG_SOUND = [
  { value: "tv_speaker", label: "TV speaker", icon: "mdi:television", own: true },
  { value: "external_arc", label: "HDMI ARC", icon: "mdi:audio-video" },
  { value: "external_optical", label: "Optical", icon: "mdi:surround-sound" },
  { value: "bt_soundbar", label: "Bluetooth", icon: "mdi:bluetooth-audio" },
  { value: "tv_external_speaker", label: "TV + external", icon: "mdi:speaker-multiple", own: true },
  { value: "headphone", label: "Headphones", icon: "mdi:headphones", own: true },
];
const mediaAction = (a, entity) => (a === "press" || a === "turn_on"
  ? { action: "perform-action", perform_action: `${domainOf(entity)}.${a}`, target: { entity_id: entity } } : asAction(a));

const STYLE = `${BASE_CSS}
  ha-card { --accent: 154 120 214; display: flex; flex-direction: column; overflow: hidden; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  /* the stage takes the artwork's own proportions, so a poster shows whole */
  .stage { position: relative; width: 100%; overflow: hidden; aspect-ratio: var(--ar, 16 / 9); min-height: 130px; max-height: var(--art-max, none);
    background: color-mix(in oklab, var(--primary-text-color) 8%, transparent); cursor: pointer; }
  .art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border: 0; object-fit: cover; }
  .veil { position: absolute; left: 0; right: 0; bottom: 0; height: 78px; background: linear-gradient(to top, rgb(0 0 0 / 0.74) 0%, rgb(0 0 0 / 0.42) 38%, rgb(0 0 0 / 0) 100%); }
  .caption { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 13px 11px; color: #fff; }
  .stage .t { display: block; font-size: 14.5px; line-height: 19px; font-weight: 650; letter-spacing: -0.014em; text-shadow: 0 1px 3px rgb(0 0 0 / 0.42); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stage .s { display: block; font-size: 12.5px; line-height: 16px; font-weight: 500; opacity: 0.88; text-shadow: 0 1px 3px rgb(0 0 0 / 0.36); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgb(255 255 255 / 0.2); }
  .progress i { display: block; height: 100%; background: #fff; transform-origin: 0 50%; }
  header { padding: var(--pad) var(--pad) 10px; }
  .name { display: block; font-size: 16px; line-height: 21px; font-weight: 620; letter-spacing: -0.021em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .body { display: flex; flex-direction: column; padding: var(--pad); gap: 10px; }
  .band { display: flex; flex-direction: column; gap: 9px; }
  .band + .band { padding-top: 10px; border-top: 1px solid var(--line); }
  /* the first visible band never gets a divider, even with a hidden one before it */
  .band[data-first] { padding-top: 0; border-top: 0; }
  .cap { font-size: 13px; line-height: 17px; font-weight: 600; letter-spacing: -0.006em; color: var(--secondary-text-color); margin-bottom: -2px; }
  .row .when { flex: none; font-size: 14px; line-height: 19px; font-weight: 650; letter-spacing: -0.016em; }
  .row .when[data-off] { color: var(--secondary-text-color); }
  /* the alarm isn't media: its own colour, so it never reads as a player */
  #alarmBand { --alarm: 232 163 61; }
  #alarmBand .icon[data-live] { color: rgb(var(--alarm)); }
  #alarmBand .tb[data-on] { background: rgb(var(--alarm) / 0.18); color: rgb(var(--alarm)); }
  #alarmBand .meta { text-align: start; }
  .segmented { position: relative; display: flex; gap: 2px; padding: 3px; border-radius: 14px; background: var(--well); }
  .sel { position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 11px; background: var(--ha-card-background, var(--card-background-color));
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.14), 0 0 0 0.5px rgb(0 0 0 / 0.04); }
  :host([dark]) .sel { background: color-mix(in oklab, var(--primary-text-color) 14%, transparent); box-shadow: none; }
  .seg { position: relative; flex: 1; min-width: 0; height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 11px;
    color: var(--secondary-text-color); font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em; }
  .seg ha-icon { --mdc-icon-size: 18px; display: flex; }
  .seg span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seg[data-sel] { color: var(--primary-text-color); }
  .seg[data-live] { color: color-mix(in oklab, rgb(var(--accent)) 70%, var(--secondary-text-color)); }
  @container (max-width: 320px) { .seg span { display: none; } }
  /* a narrow row keeps play and power; the stage still has the full transport */
  @container (max-width: 330px) { .row .tb[data-k="prev"], .row .tb[data-k="next"] { display: none; } .vol[data-steps] .pct { display: none; } }
  .row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .row .icon { flex: none; display: grid; place-items: center; width: var(--b-m); height: var(--b-m); border-radius: 50%; background: transparent; color: var(--secondary-text-color); }
  .row .icon[data-live] { color: rgb(var(--accent)); }
  .row .icon ha-icon { --mdc-icon-size: 22px; display: flex; }
  .row .meta { flex: 1; min-width: 0; }
  .row .n { display: block; font-size: 14px; line-height: 18px; font-weight: 580; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .d { display: block; font-size: 13px; line-height: 17px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .transport { flex: none; display: flex; align-items: center; gap: 4px; }
  .tb { display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; color: var(--secondary-text-color); }
  /* play/pause is the key you reach for: a plain plate, solid while the player is actually playing */
  .tb.solid { width: var(--c-l); height: var(--c-l); border-radius: 13px; background: var(--well); color: var(--primary-text-color); }
  .row:has(.icon[data-live]) .tb.solid { background: var(--primary-text-color); color: var(--ha-card-background, var(--card-background-color, #fff)); }
  .tb[data-on] { color: rgb(var(--accent)); }
  .tb[disabled] { opacity: 0.3; cursor: default; }
  .tb ha-icon { --mdc-icon-size: 20px; display: flex; }
  /* glass: a player's icon, name and buttons are one lit tile; its volume stays outside */
  ha-card .row { padding: 2px 0; }
  ha-card:is([data-glass], [data-matte]) .row { padding: 8px 10px; border-radius: 15px; background: color-mix(in oklab, var(--primary-text-color) 4%, transparent); }
  ha-card[data-glass] .row, ha-card[data-matte] .row { --lx: 28px; }
  .vol { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .via { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12.5px; line-height: 16px; font-weight: 550; color: var(--secondary-text-color); }
  .via ha-icon { --mdc-icon-size: 16px; display: flex; color: rgb(var(--accent)); }
  .via span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* a TV that can switch where its sound goes: the line is a button that lists the outputs */
  button.via { align-self: flex-start; max-width: 100%; margin-inline-start: -8px; padding: 5px 8px; border-radius: 10px; color: var(--primary-text-color); }
  button.via .chev { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  @media (hover: hover) { button.via:hover { background: var(--well); } }
  .via + .vol { margin-top: 4px; }
  .vol .bar { position: absolute; left: 0; right: 0; top: 50%; height: 5px; margin-top: -2.5px; border-radius: 99px; background: color-mix(in oklab, var(--primary-text-color) 10%, transparent); overflow: hidden; transform-origin: 50% 50%; }
  .vol .mute { flex: none; display: grid; place-items: center; width: 34px; height: 32px; border-radius: 10px; color: var(--secondary-text-color); }
  .vol .mute ha-icon { --mdc-icon-size: 19px; display: flex; }
  .vol .mute[data-on] { color: #E8844F; background: rgb(232 132 79 / 0.16); }
  /* − / + as one pair at the end, the climate card's steppers at the transport's size */
  .vol .vsteps { flex: none; display: flex; gap: 4px; }
  .vol .vstep { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: transparent; color: var(--secondary-text-color); transform-origin: 50% 50%; }
  @media (hover: hover) { .vol .vstep:hover, .tb:hover { background: var(--well); } }
  .vol .vstep ha-icon { --mdc-icon-size: 18px; display: flex; }
  .vol .vstep[disabled] { opacity: 0.35; cursor: default; }
  .slider { position: relative; flex: 1; height: 30px; touch-action: pan-y; cursor: grab; }
  .slider:active { cursor: grabbing; }
  .fill { position: absolute; inset: 0; border-radius: 99px; transform-origin: 0 50%; background: linear-gradient(90deg, rgb(var(--accent) / 0.55), rgb(var(--accent))); }
  .pct { flex: none; min-width: 34px; text-align: end; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: -0.004em; color: var(--secondary-text-color); }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { display: inline-flex; align-items: center; gap: 7px; min-width: 0; height: 34px; padding: 0 12px; border-radius: 12px; background: var(--well);
    font-size: 13px; line-height: 16px; font-weight: 550; letter-spacing: -0.004em; color: var(--secondary-text-color); }
  .pill ha-icon, .pill savvy-state-icon { --mdc-icon-size: 18px; flex: none; display: flex; color: var(--cc, inherit); }
  .pill span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill[data-on] { background: color-mix(in oklab, var(--cc) 16%, transparent); color: var(--cc); }
  /* compact: one row, a thumbnail of what's playing, its transport, the room's volume */
  ha-card[data-compact] .body { padding: 12px; gap: 8px; }
  ha-card[data-compact] .band + .band { padding-top: 0; border-top: 0; }
  ha-card[data-compact] .row { gap: 11px; }
  ha-card[data-compact] .row .icon { width: var(--b-l); height: var(--b-l); overflow: hidden; padding: 0; }
  ha-card[data-compact] .row .icon ha-icon { --mdc-icon-size: 22px; }
  ha-card[data-compact] .thumb { width: 100%; height: 100%; object-fit: cover; display: block; border: 0; }
  ha-card[data-compact] .row .n { font-size: 14px; line-height: 18px; }
  ha-card[data-compact] .row .d { font-size: 12.5px; line-height: 17px; }
  ha-card[data-compact] .vol { margin-top: 6px; }
  .tts { display: flex; align-items: center; gap: 8px; }
  .tts input { flex: 1; min-width: 0; height: 34px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 0; background: var(--well);
    color: var(--primary-text-color); font: inherit; font-size: 13px; font-weight: 500; outline: none; user-select: text; -webkit-user-select: text; }
  .tts input::placeholder { color: var(--secondary-text-color); opacity: 0.9; }
  .tts input:focus-visible { box-shadow: 0 0 0 2px rgb(var(--accent)); }
  .send { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; background: rgb(var(--accent) / 0.18); color: rgb(var(--accent)); }
  .send[disabled] { opacity: 0.35; cursor: default; }
  .send ha-icon { --mdc-icon-size: 19px; display: flex; }
  .empty { padding: 4px 0 2px; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  @media (prefers-contrast: more) { .row .d, .pct, .pill { color: var(--primary-text-color); } }
`;

class SavvyMediaCard extends SavvyCard {
  static getStubConfig(hass) {
    const a = allAreas(hass).find((x) => areaEntities(hass, x.id).some((id) => domainOf(id) === "media_player"));
    return a ? { area: a.id } : {};
  }
  static getConfigElement() { return document.createElement(EDITOR); }

  constructor() {
    super();
    this._onscreen = true;
    this._optimistic = new Map();
  }

  setConfig(config) {
    const players = (list) => asItems(list).filter((p) => p.entity);
    if (!config?.area && !players(config?.video).length && !players(config?.audio).length) throw new Error('savvy-media-card: set an "area" (or "video" / "audio" players)');
    const alarm = typeof config.alarm === "string" ? { entity: config.alarm } : config.alarm;
    this._compact = config.layout === "compact" || !!config.compact;
    this._given = { video: players(config.video), audio: players(config.audio) };
    this._config = { artwork: true, labels: {}, ...config, alarm: alarm || null,
      presets: asItems(config.presets), chips: asItems(config.chips ?? config.actions), video: [], audio: [] };
    this._picked = null;
    this._discovered = null;
    if (this._el) { this._build(); if (this._hass) this._update(); }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._discover();
    if (!this._el) this._build();
    this._update();
  }

  // The room's players, unless config lists them: a list that's given is used as it is.
  _discover() {
    const h = this._hass, c = this._config, g = this._given;
    const key = h.entities;
    if (this._discovered === key) return;
    this._discovered = key;
    let video = g.video, audio = g.audio;
    if (c.area && (!video.length || !audio.length)) {
      const skip = new Set([...video, ...audio].map((p) => p.entity).concat(asItems(c.exclude).map((i) => i.entity)));
      const found = pick(h, areaEntities(h, c.area), { domains: "media_player" }).filter((id) => !skip.has(id) && !isGroup(h.states[id]))
        .sort((a, b) => (h.states[a].attributes.friendly_name || a).localeCompare(h.states[b].attributes.friendly_name || b));
      const isAudio = (id) => AUDIO_CLASSES.has(h.states[id].attributes.device_class);
      if (!video.length && !g.audio.length) video = found.filter((id) => !isAudio(id)).map((entity) => ({ entity }));
      else if (!video.length) video = found.filter((id) => !isAudio(id)).map((entity) => ({ entity }));
      if (!audio.length) audio = found.filter(isAudio).map((entity) => ({ entity }));
    }
    c.video = video;
    c.audio = audio;
  }

  connectedCallback() { this._observe(); this._wake(); }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    clearInterval(this._tick);
    for (const t of this._volTimers?.values() || []) clearTimeout(t);
    this._soundPicker?.close();
  }
  getCardSize() { return this._compact ? 2 : this._config?.artwork ? 6 : 4; }
  getGridOptions() { return this._compact ? { columns: 12, min_columns: 6, rows: "auto" } : { columns: 12, min_columns: 6, rows: "auto" }; }

  // ---------- build ----------
  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._resetMotion();
    clearInterval(this._tick);
    this._tick = 0;
    this._first = true;
    this._stageSrc = null;
    this._bars = new Map();
    this._volTimers = new Map();
    const c = this._config;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <header id="header"><span class="name" id="title"></span></header>
        <section class="stage" id="stage" hidden>
          <img class="art" id="art" alt=""><span class="veil"></span>
          <div class="caption"><span class="t" id="stageT"></span><span class="s" id="stageS"></span></div>
          <div class="progress" id="progress" hidden><i id="progressFill"></i></div>
        </section>
        <div class="body">
          <div class="band" id="videoBand" hidden>
            <span class="cap" id="videoCap" hidden></span>
            <div class="segmented" id="sources" hidden><span class="sel"></span></div>
            <div class="row" id="nowRow">
              <span class="icon" id="nowIcon"></span>
              <span class="meta"><span class="n" id="nowName"></span><span class="d" id="nowSub"></span></span>
              <div class="transport" id="nowTransport"></div>
            </div>
            <div class="nowvol" id="nowVol"></div>
          </div>
          <div class="band" id="audioBand" hidden><span class="cap" id="audioCap" hidden></span>
            <div class="segmented" id="speakers" hidden><span class="sel"></span></div></div>
          <div class="band" id="alarmBand" hidden>
            <div class="row">
              <button class="icon" id="alarmIcon"><ha-icon id="alarmGlyph"></ha-icon></button>
              <button class="meta" id="alarmMeta" style="text-align:start"><span class="n" id="alarmName"></span><span class="d" id="alarmSub"></span></button>
              <span class="when" id="alarmWhen"></span>
              <div class="transport"><button class="tb solid" id="alarmToggle"><ha-icon id="alarmToggleIcon"></ha-icon></button></div>
            </div>
          </div>
          <div class="band" id="extras" hidden>
            <div class="pills" id="presets" hidden></div>
            <div class="tts" id="tts" hidden>
              <input id="ttsInput" type="text" enterkeyhint="send" autocomplete="off" spellcheck="false">
              <button class="send" id="ttsSend" aria-label="Speak"><ha-icon icon="mdi:send"></ha-icon></button>
            </div>
            <div class="pills" id="actions" hidden></div>
          </div>
        </div>
      </ha-card>`;
    if (this._compact) {
      root.getElementById("nowIcon").innerHTML = `<img class="thumb" id="thumb" alt="" hidden><ha-icon id="nowGlyph"></ha-icon>`;
      root.querySelector("ha-card").setAttribute("data-compact", "");
      for (const id of ["stage", "sources", "audioBand", "alarmBand", "extras", "videoCap"]) root.getElementById(id).hidden = true;
    }
    const $ = (id) => root.getElementById(id);
    this._el = { card: root.querySelector("ha-card"), header: $("header"), title: $("title"), stage: $("stage"), art: $("art"), thumb: $("thumb"), nowGlyph: $("nowGlyph"),
      stageT: $("stageT"), stageS: $("stageS"), progress: $("progress"), progressFill: $("progressFill"), videoBand: $("videoBand"), sources: $("sources"),
      nowRow: $("nowRow"), nowIcon: $("nowIcon"), nowName: $("nowName"), nowSub: $("nowSub"), nowTransport: $("nowTransport"), nowVol: $("nowVol"),
      audioBand: $("audioBand"), speakers: $("speakers"), videoCap: $("videoCap"), audioCap: $("audioCap"), alarmBand: $("alarmBand"), alarmIcon: $("alarmIcon"), alarmGlyph: $("alarmGlyph"),
      alarmMeta: $("alarmMeta"), alarmName: $("alarmName"), alarmSub: $("alarmSub"), alarmWhen: $("alarmWhen"), alarmToggle: $("alarmToggle"),
      alarmToggleIcon: $("alarmToggleIcon"), extras: $("extras"), presets: $("presets"), tts: $("tts"), ttsInput: $("ttsInput"), ttsSend: $("ttsSend"), actions: $("actions") };
    this._sp = {
      pill: this._spring(0, MOTION.pill, "sources", 0.02),
      pillW: this._spring(0, MOTION.pill, "sources", 0.02),
      spk: this._spring(0, MOTION.pill, "speakers", 0.02),
      spkW: this._spring(0, MOTION.pill, "speakers", 0.02),
      art: this._spring(0, MEDIA_MOTION.art, "stage", 0.002),
      swap: this._spring(1, SWAP_IN, "now"),
      progress: this._spring(0, MOTION.value, "stage", 0.0005),
    };
    linkTitle(root, this._el.title, titlePathOf(c), (el, onTap) => this._pressable(el, { onTap }, 0.04));
    const P = (el, onTap, onHold) => this._pressable(el, { onTap, onHold, haptic: null }, 0.08);
    P(this._el.stage, () => this._stageOwner && moreInfo(this, this._stageOwner.entity));
    const alarmTime = () => moreInfo(this, this._config.alarm?.time || this._config.alarm?.entity);
    P(this._el.alarmMeta, alarmTime);
    P(this._el.alarmIcon, alarmTime);
    P(this._el.alarmToggle, () => this._toggleAlarm(), () => moreInfo(this, this._config.alarm?.entity));
    this._el.ttsInput.placeholder = c.tts?.placeholder || "Say something";
    this._el.ttsInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") this._speak(); });
    this._el.ttsInput.addEventListener("input", () => this._syncSend());
    P(this._el.ttsSend, () => this._speak());
    this._observe();
  }

  _observe() {
    if (!this._el || !this.isConnected) return;
    this._io = this._io || new IntersectionObserver(([e]) => { this._onscreen = e.isIntersecting; if (this._onscreen) { this._measure(); this._wake(); } });
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => { this._measure(); this._wake(); });
    this._io.disconnect();
    this._io.observe(this);
    this._ro.observe(this._el.card);
  }

  _measure() {
    const slide = (box, idx, x, w) => {
      const sel = box?.querySelectorAll(".seg:not([hidden])")[idx || 0];
      if (!sel) return;
      const first = this._first || w.x === 0;
      x[first ? "snap" : "to"](sel.offsetLeft);
      w[first ? "snap" : "to"](sel.offsetWidth);
    };
    slide(this._el?.sources, this._pickedIdx, this._sp.pill, this._sp.pillW);
    slide(this._el?.speakers, this._spkIdx, this._sp.spk, this._sp.spkW);
  }

  // A volume bar. Nothing moves until a drag is clearly sideways, so a press, or a finger
  // on its way to scrolling the page, never changes the volume (CARD-DESIGN.md 3.1); then
  // the level follows the finger 1:1 from where it was, instead of jumping to it.
  _bar(key, el) {
    const group = `vol:${key}`;
    const value = this._spring(0, MOTION.value, group, 0.002);
    const grab = this._spring(0, MEDIA_MOTION.grab, group);
    const bar = { el, value, grab, cfg: null, dragging: false, pending: null, last: 0 };
    // an optimistic level, shown until HA reports it or it expires
    bar.guess = (v) => {
      bar.pending = v;
      bar.pendingAt = Date.now();
      clearTimeout(bar.expiry);
      bar.expiry = setTimeout(() => { bar.pending = null; if (this._hass) this._update(); }, VOL_PREDICT + 50);
    };
    bar.write = (v) => this._volumeIO(bar.cfg)?.write(v);
    this._bars.set(key, bar);
    const slider = el.querySelector(".slider");
    let id = null, x0 = 0, y0 = 0, xs = 0, from = 0, live = false;
    const at = (clientX) => clamp(from + (clientX - xs) / Math.max(1, slider.getBoundingClientRect().width));
    slider.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; live = false;
      try { slider.setPointerCapture(e.pointerId); } catch (err) { /* already lifted */ }
    });
    slider.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      if (!e.buttons && e.pointerType === "mouse") { id = null; return; }
      if (!live) {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) { id = null; return; }   // vertical: the page scrolls
        live = true;
        bar.dragging = true;
        grab.to(1);
        xs = e.clientX;
        from = clamp(bar.pending ?? value.x);
        bar.last = Math.round(from * 10);
      }
      const v = at(e.clientX);
      value.snap(v);
      bar.guess(v);
      const notch = Math.round(v * 10);     // a tick of feedback every 10%
      if (notch !== bar.last) { bar.last = notch; haptic("selection"); }
      this._send(bar, v, true);
      this._wake();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!live) return;
      live = false;
      bar.dragging = false;
      grab.to(0);
      this._send(bar, value.x);
      this._wake();
    };
    slider.addEventListener("pointerup", end);
    slider.addEventListener("pointercancel", end);
    // one volume_step (default 5%), from the − / + buttons or the arrow keys
    bar.step = (d) => {
      const size = (Number(this._config.volume_step) || 5) / 100;
      const v = clamp((bar.pending ?? value.target) + d * size);
      if (Math.abs(v - (bar.pending ?? value.target)) < 1e-6) return;
      bar.guess(v);
      value.to(v);
      haptic("selection");
      this._send(bar, v);
      this._wake();
    };
    slider.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      bar.step(d);
    });
    return bar;
  }

  // writes are throttled while dragging; the release always lands
  _send(bar, v, throttle = false) {
    bar.queued = v;
    if (throttle) {
      if (this._volTimers.get(bar)) return;
      this._volTimers.set(bar, setTimeout(() => { this._volTimers.delete(bar); this._flush(bar); }, VOL_THROTTLE));
      return;
    }
    clearTimeout(this._volTimers.get(bar));
    this._volTimers.delete(bar);
    this._flush(bar);
  }
  _flush(bar) { if (bar.queued == null) return; bar.write(bar.queued); bar.queued = null; }

  // ---------- actions ----------
  _call(domain, service, data, entity) { this._hass.callService(domain, service, data || {}, { entity_id: entity }); }

  _playerIcon(cfg, st) {
    if (cfg.icon) return cfg.icon;
    const dc = st?.attributes.device_class;
    if (PLAYER_ICONS[dc]) return PLAYER_ICONS[dc];
    if (/ps\d|playstation|xbox|switch_console/i.test(cfg.entity)) return PLAYER_ICONS.game;
    return PLAYER_ICONS.default;
  }

  // a player may be powered by its own service or by a separate switch
  _isOn(cfg) {
    const guess = this._optimistic.get(cfg.entity);
    if (guess && Date.now() - guess.at < OPTIMISTIC_MS) return guess.on;
    if (cfg.power) { const p = this._hass.states[cfg.power]; if (p) return p.state === "on"; }
    const st = this._hass.states[cfg.entity];
    return !!st && !DEAD.has(st.state);
  }

  _togglePower(cfg) {
    const on = this._isOn(cfg);
    this._optimistic.set(cfg.entity, { on: !on, at: Date.now() });
    haptic("light");
    setTimeout(() => this._hass && this._update(), OPTIMISTIC_MS + 50);
    if (cfg.power) return this._call(domainOf(cfg.power), "toggle", {}, cfg.power);
    this._call("media_player", on ? "turn_off" : "turn_on", {}, cfg.entity);
  }

  _transport(cfg, action) { haptic("light"); this._call("media_player", action, {}, cfg.entity); }

  _mute(cfg, target) {
    const st = this._hass.states[target || cfg.entity];
    haptic("light");
    this._call("media_player", "volume_mute", { is_volume_muted: !st?.attributes.is_volume_muted }, target || cfg.entity);
  }

  // A room's real volume is sometimes a helper rather than the player's own level.
  _volumeIO(cfg) {
    const id = cfg.volume || cfg.entity;
    const st = this._hass.states[id];
    if (!st) return null;
    if (id.startsWith("input_number.") || id.startsWith("number.")) {
      const min = Number(st.attributes.min ?? 0), max = Number(st.attributes.max ?? 100);
      const span = Math.max(1e-6, max - min);
      return { id, level: clamp((parseFloat(st.state) - min) / span), write: (v) => this._call(domainOf(id), "set_value", { value: Math.round((min + v * span) * 100) / 100 }, id) };
    }
    if (!has(st, F.VOLUME_SET)) return null;
    return { id, level: clamp(Number(st.attributes.volume_level) || 0), muted: !!st.attributes.is_volume_muted,
      write: (v) => this._call("media_player", "volume_set", { volume_level: Math.round(v * 100) / 100 }, id) };
  }

  _runChip(cfg, kind) {
    const a = kind === "hold" ? (cfg.hold_action !== undefined ? mediaAction(cfg.hold_action, cfg.entity) : { action: "more-info" })
      : cfg.tap_action !== undefined ? mediaAction(cfg.tap_action, cfg.entity)
      : cfg.navigation_path ? { action: "navigate", navigation_path: cfg.navigation_path }
      : cfg.entity ? defaultTapAction(cfg.entity) : null;
    if (!a || a.action === "none") return;
    haptic("light");
    runAction(this, this._hass, a, { entity: cfg.entity });
  }

  _speak() {
    const cfg = this._config.tts, input = this._el.ttsInput;
    const msg = input.value.trim();
    if (!cfg || !msg) return;
    const [domain, service] = String(cfg.action || "tts.speak").split(".");
    // any value written as $MSG in the config is where the text goes
    const fill = (v) => (typeof v === "string" ? v.replace(/\$MSG/g, msg) : Array.isArray(v) ? v.map(fill)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
    const data = cfg.data ? fill({ ...cfg.data }) : { message: msg };
    if (cfg.data && JSON.stringify(cfg.data) === JSON.stringify(data)) data.message = msg;
    const target = data.entity_id;
    delete data.entity_id;
    this._hass.callService(domain, service, data, target ? { entity_id: target } : undefined);
    haptic("light");
    input.value = "";
    this._syncSend();
  }
  _syncSend() { attr(this._el.ttsSend, "disabled", !this._el.ttsInput.value.trim()); }

  // ---------- what's playing ----------
  _mediaOf(cfg) {
    const st = this._hass.states[cfg.entity];
    if (!st) return { title: cfg.name || title(cfg.entity.split(".")[1]), sub: "Not found", missing: true };
    const a = st.attributes;
    const name = cfg.name || shortName(this._hass, cfg.entity, this._config.area);
    if (!this._isOn(cfg)) return { name, st, title: name, sub: "Off", off: true };
    let line = a.media_title || "", sub = "";
    if (a.media_series_title) {
      // a show reads as its name, then where you are in it
      line = a.media_series_title;
      const ep = [a.media_season != null ? `S${a.media_season}` : "", a.media_episode != null ? `E${a.media_episode}` : ""].join("");
      sub = [ep, a.media_title].filter(Boolean).join(" · ");
    } else if (a.media_artist) sub = [a.media_artist, a.media_album_name].filter(Boolean).join(" · ");
    if (!sub) sub = a.app_name || a.source || "";
    if (!line) line = a.app_name || a.source || (st.state === "playing" ? "Playing" : chipState(this._hass, st));
    return { name, st, title: line, sub: sub || name, playing: ACTIVE.has(st.state) };
  }

  // the stage only appears with real artwork, where the room says it may show it
  _artOf(cfg) {
    if (!this._config.artwork || !cfg || cfg.artwork === false) return null;
    const st = this._hass.states[cfg.entity];
    if (!st || !ACTIVE.has(st.state)) return null;
    if (typeof cfg.artwork === "string") { const gate = this._hass.states[cfg.artwork]; if (!gate || gate.state !== "on") return null; }
    return st.attributes.entity_picture || null;
  }

  _position(st) {
    const a = st?.attributes || {};
    const dur = Number(a.media_duration);
    if (!Number.isFinite(dur) || dur <= 0) return null;
    let pos = Number(a.media_position) || 0;
    if (st.state === "playing" && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    return clamp(pos / dur);
  }

  // ---------- update ----------
  _rowOf(parent, key, tag, cls, html) {
    const cache = parent.__rows || (parent.__rows = new Map());
    let el = cache.get(key);
    if (!el) {
      el = document.createElement(tag);
      el.className = cls;
      el.innerHTML = html;
      cache.set(key, el);
      parent.appendChild(el);
    }
    return el;
  }

  _update() {
    const h = this._hass, c = this._config, el = this._el;
    if (!h || !el) return;
    const cap = c.artwork_max_height;
    put(el.stage, "--art-max", cap ? (typeof cap === "number" ? `${cap}px` : String(cap)) : "none");
    this.toggleAttribute("dark", !!h.themes?.darkMode);
    if (c.accent) put(el.card, "--accent", this._rgb(c.accent));
    // the glow: the accent while anything is playing, quieter while a player is only on
    const mine = [...c.video, ...c.audio];
    const playing = mine.some((m) => ACTIVE.has(h.states[m.entity]?.state)), awake = mine.some((m) => this._isOn(m));
    stateGlow(c, el.card, playing || awake ? getComputedStyle(el.card).getPropertyValue("--accent").trim().split(/\s+/).map(Number) : null, playing ? 1 : 0.45);
    text(el.title, c.name || c.title || (c.area ? areaInfo(h, c.area).name : "Media"));
    this._sources();
    if (!this._compact) this._stage();      // decides what the stage owns, so rows can defer
    this._nowPlaying();
    if (!this._compact) { this._outputs(); this._alarm(); this._chips(); }
    // glass: each player row throws the accent while it is the one playing
    const accent = getComputedStyle(el.card).getPropertyValue("--accent").trim().split(/\s+/).map(Number);
    for (const r of this.shadowRoot.querySelectorAll(".row")) {
      const live = r.querySelector(".icon[data-live]") || r.querySelector("[data-on]");
      lit(r, live ? accent : null, playing ? 1 : 0.55);
    }
    // with both kinds on the card, each band says what it is for
    const both = !this._compact && !el.videoBand.hidden && !el.audioBand.hidden;
    const labels = c.labels === false ? {} : { ...(both ? { video: "Watch", audio: "Listen" } : {}), ...(c.labels || {}) };
    for (const [key, node] of [["video", el.videoCap], ["audio", el.audioCap]]) {
      node.hidden = this._compact || !labels[key];
      if (labels[key]) text(node, labels[key]);
    }
    let firstSeen = false;
    for (const band of [el.videoBand, el.audioBand, el.alarmBand, el.extras]) {
      attr(band, "data-first", !band.hidden && !firstSeen);
      if (!band.hidden) firstSeen = true;
    }
    if (this._first) { this._first = false; requestAnimationFrame(() => { this._measure(); this._paintAll(null); }); }
    this._syncTick();
    this._wake();
  }

  _rgb(css) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(css).trim());
    if (!m) return css;
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  }

  // Which video source the row and stage are about: the pick while it's still sensible,
  // else whatever is actually playing. A pick is released only when something new starts.
  _sources() {
    const c = this._config, el = this._el;
    if (this._compact) return this._primary();
    el.videoBand.hidden = !c.video.length;
    if (!c.video.length) { this._active = null; return; }
    const live = c.video.filter((v) => ACTIVE.has(this._hass.states[v.entity]?.state));
    const sig = live.map((v) => v.entity).join("|");
    if (this._liveSig === undefined) this._liveSig = sig;
    if (sig !== this._liveSig) { this._liveSig = sig; if (sig) this._picked = null; }
    const on = c.video.filter((v) => this._isOn(v));
    if (this._picked && !c.video.some((v) => v.entity === this._picked)) this._picked = null;
    const auto = live[0] || on[0] || c.video[0];
    const active = this._picked ? c.video.find((v) => v.entity === this._picked) : auto;
    const changed = this._active && this._active.entity !== active.entity;
    this._active = active;
    this._pickedIdx = c.video.indexOf(active);
    el.sources.hidden = c.video.length < 2;
    if (!el.sources.hidden) {
      c.video.forEach((v) => {
        const st = this._hass.states[v.entity];
        const seg = this._rowOf(el.sources, v.entity, "button", "seg", `<ha-icon></ha-icon><span></span>`);
        if (!seg.__wired) {
          seg.__wired = true;
          this._pressable(seg, { onTap: () => this._pick(v), onHold: () => moreInfo(this, v.entity), haptic: null }, 0.08);
        }
        attr(seg.querySelector("ha-icon"), "icon", this._playerIcon(v, st));
        text(seg.querySelector("span"), v.name || shortName(this._hass, v.entity, c.area));
        attr(seg, "data-sel", v === active);
        attr(seg, "data-live", this._isOn(v));
        attr(seg, "aria-pressed", v === active ? "true" : "false");
      });
      this._measure();
    }
    if (changed && !MQ.reduced.matches) this._sp.swap.snap(0).to(1, SWAP_IN);
  }

  // compact: one row for the room, showing whatever is actually playing
  _primary() {
    const c = this._config, all = [...c.video, ...c.audio];
    this._el.videoBand.hidden = !all.length;
    if (!all.length) { this._active = null; return; }
    const next = all.find((p) => ACTIVE.has(this._hass.states[p.entity]?.state)) || all.find((p) => this._isOn(p)) || all[0];
    if (this._active && this._active.entity !== next.entity && !MQ.reduced.matches) this._sp.swap.snap(0).to(1, SWAP_IN);
    this._active = next;
  }

  _pick(v) {
    if (this._active?.entity === v.entity) return moreInfo(this, v.entity);
    this._picked = v.entity;
    haptic("selection");
    this._update();
  }

  _nowPlaying() {
    const el = this._el, v = this._active;
    if (!v) return;
    const info = this._mediaOf(v), st = info.st;
    if (this._compact) {
      // a piece of the artwork stands in for the whole stage
      const url = this._config.artwork !== false ? this._artOf(v) : null;
      el.thumb.hidden = !url;
      el.nowGlyph.hidden = !!url;
      if (url && el.thumb.getAttribute("src") !== url) el.thumb.src = url;
      attr(el.nowGlyph, "icon", this._playerIcon(v, st));
      attr(el.nowIcon, "data-live", !url && this._isOn(v));
    } else {
      attr(el.nowIcon, "data-live", this._isOn(v));
      attr(this._rowOf(el.nowIcon, "i", "ha-icon", "", ""), "icon", this._playerIcon(v, st));
    }
    if (!el.nowIcon.__wired) {
      el.nowIcon.__wired = true;
      this._pressable(el.nowIcon, { onTap: () => moreInfo(this, el.nowIcon.__entity), haptic: null }, 0.08);
    }
    el.nowIcon.__entity = v.entity;
    if (this._compact) {
      // no stage here: the row leads with what's playing rather than which box
      const dead = info.off || info.missing;
      const primary = dead ? (info.name || info.title) : info.title;
      const second = !dead && (!info.sub || info.sub === primary) ? info.name : info.sub;
      text(el.nowName, primary);
      text(el.nowSub, second === primary ? "" : second);
    } else {
      text(el.nowName, info.name || info.title);
      text(el.nowSub, this._rowSub(v, info));
    }
    this._buildTransport(el.nowTransport, v, { power: true });
    const owner = this._volumeOwner(v);
    el.nowVol.hidden = !owner;
    if (owner) {
      // a source that plays through another box says which, so the volume reads as that box's
      const screen = this._screenOf(v) || v, choice = this._soundChoice(screen);
      let via = el.nowVol.querySelector(".via");
      if (!via || (via.tagName === "BUTTON") !== !!choice) {
        via?.remove();
        via = document.createElement(choice ? "button" : "span");
        via.className = "via";
        via.innerHTML = `<ha-icon></ha-icon><span></span>${choice ? `<ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>` : ""}`;
        if (choice) { attr(via, "aria-haspopup", "listbox"); this._pressable(via, { onTap: () => this._soundMenu(via), haptic: null }, 0.05); }
        el.nowVol.prepend(via);
      }
      const through = owner.entity !== v.entity;
      via.hidden = this._compact || (!through && !choice);
      if (!via.hidden) {
        // the sound goes out to a soundbar: that box; the TV plays through itself and can say how: its output
        // (TV speaker, headphones); otherwise the box whose volume this is
        const out = owner.entity !== screen.entity, named = !out && choice?.current;
        const name = named ? choice.current.label : owner.name || shortName(this._hass, owner.entity, this._config.area);
        const icon = named ? choice.current.icon || "mdi:speaker" : this._playerIcon(owner, this._hass.states[owner.entity]);
        attr(via.querySelector("ha-icon"), "icon", icon);
        text(via.querySelector("span"), `Sound from ${name}`);
        if (choice) attr(via, "aria-label", `Sound output: ${choice.current?.label || "unknown"}. Change`);
      }
      this._mountVolume(el.nowVol, owner, "source");
    }
  }

  // when the stage already shows this player's media, the row says where it comes from
  _rowSub(cfg, info) {
    if (info.off) return "Off";
    if (info.missing) return info.sub;
    const staged = this._stageOwner?.entity === cfg.entity && !this._el.stage.hidden;
    const a = info.st?.attributes || {};
    if (staged) return a.app_name || a.source || chipState(this._hass, info.st);
    if (info.title === info.name) return info.sub;
    const extra = info.sub !== info.name && info.sub !== info.title ? info.sub : "";
    return [info.title, extra].filter(Boolean).join(" · ");
  }

  // transport buttons follow what the player says it supports
  _buildTransport(parent, cfg, { power = false, solid = true } = {}) {
    const st = this._hass.states[cfg.entity];
    const on = this._isOn(cfg), playing = ACTIVE.has(st?.state);
    const want = [];
    if (has(st, F.PREV)) want.push({ key: "prev", icon: "mdi:skip-previous", act: () => this._transport(cfg, "media_previous_track") });
    if (has(st, F.PAUSE) || has(st, F.PLAY)) want.push({ key: "play", solid, icon: playing ? "mdi:pause" : "mdi:play", act: () => this._transport(cfg, "media_play_pause") });
    if (has(st, F.NEXT)) want.push({ key: "next", icon: "mdi:skip-next", act: () => this._transport(cfg, "media_next_track") });
    if (power && (cfg.power || has(st, F.TURN_ON) || has(st, F.TURN_OFF))) want.push({ key: "power", icon: "mdi:power", on, act: () => this._togglePower(cfg) });
    for (const b of want) {
      const btn = this._rowOf(parent, b.key, "button", `tb${b.solid ? " solid" : ""}`, `<ha-icon></ha-icon>`);
      if (!btn.__wired) { btn.__wired = true; this._pressable(btn, { onTap: () => btn.__act(), haptic: null }, 0.08); }
      btn.__act = b.act;
      attr(btn, "aria-label", b.key);
      attr(btn, "data-k", b.key);
      attr(btn, "data-on", !!b.on);
      attr(btn, "disabled", !(on || b.key === "power"));
      attr(btn.querySelector("ha-icon"), "icon", b.icon);
    }
    // the DOM order is fixed, whichever button was built first: power is always the last
    let at = 0;
    for (const key of ["prev", "play", "next", "power"]) { const node = parent.__rows?.get(key); if (node) place(parent, node, at++); }
    const keys = new Set(want.map((b) => b.key));
    for (const [key, node] of parent.__rows || []) Motion.show(node, keys.has(key));
    parent.hidden = !want.length;
  }

  _outputs() {
    const el = this._el, c = this._config;
    const busy = this._busyOutputs(), free = c.audio.filter((a) => !busy.has(a.entity));
    this._listen = free;
    el.audioBand.hidden = !free.length;
    const shown = this._speakerPicker();
    for (const cfg of c.audio) {
      const key = slug(cfg.entity);
      const row = this._rowOf(el.audioBand, key, "div", "player", `<div class="row">
          <span class="icon"><ha-icon></ha-icon></span>
          <span class="meta"><span class="n"></span><span class="d"></span></span>
          <div class="transport"></div></div>`);
      const st = this._hass.states[cfg.entity];
      const info = this._mediaOf(cfg);
      const icon = row.querySelector(".icon");
      attr(icon, "data-live", this._isOn(cfg));
      attr(icon.querySelector("ha-icon"), "icon", this._playerIcon(cfg, st));
      text(row.querySelector(".n"), info.name || info.title);
      text(row.querySelector(".d"), this._rowSub(cfg, info));
      this._buildTransport(row.querySelector(".transport"), cfg, { power: true });
      if (!icon.__wired) { icon.__wired = true; this._pressable(icon, { onTap: () => moreInfo(this, cfg.entity), haptic: null }, 0.08); }
      this._mountVolume(row, cfg, key);
    }
    for (const [key, node] of el.audioBand.__rows || []) Motion.show(node, key === slug(shown?.entity || ""));
  }

  // Several speakers share one row, picked the way the video sources are: the pick while it's
  // sensible, else whatever is playing. One speaker needs no picker.
  _speakerPicker() {
    const el = this._el, list = this._listen || this._config.audio;
    if (!list.length) { this._spkActive = null; return null; }
    const live = list.filter((a) => ACTIVE.has(this._hass.states[a.entity]?.state));
    const sig = live.map((a) => a.entity).join("|");
    if (this._spkSig === undefined) this._spkSig = sig;
    if (sig !== this._spkSig) { this._spkSig = sig; if (sig) this._spkPicked = null; }
    if (this._spkPicked && !list.some((a) => a.entity === this._spkPicked)) this._spkPicked = null;
    const active = (this._spkPicked && list.find((a) => a.entity === this._spkPicked)) || live[0] || list.find((a) => this._isOn(a)) || list[0];
    this._spkActive = active;
    this._spkIdx = list.indexOf(active);
    el.speakers.hidden = list.length < 2;
    if (!el.speakers.hidden) {
      list.forEach((a) => {
        const st = this._hass.states[a.entity];
        const seg = this._rowOf(el.speakers, a.entity, "button", "seg", `<ha-icon></ha-icon><span></span>`);
        if (!seg.__wired) {
          seg.__wired = true;
          this._pressable(seg, { onTap: () => this._pickSpeaker(a), onHold: () => moreInfo(this, a.entity), haptic: null }, 0.08);
        }
        attr(seg.querySelector("ha-icon"), "icon", this._playerIcon(a, st));
        text(seg.querySelector("span"), a.name || shortName(this._hass, a.entity, this._config.area));
        attr(seg, "data-sel", a === active);
        attr(seg, "data-live", this._isOn(a));
        attr(seg, "aria-pressed", a === active ? "true" : "false");
      });
      // a speaker busy being a screen's sound is out of the picker until the screen lets it go
      const keep = new Set(list.map((a) => a.entity));
      for (const [id, seg] of el.speakers.__rows || []) seg.hidden = !keep.has(id);
      this._measure();
    }
    return active;
  }

  _pickSpeaker(a) {
    if (this._spkActive?.entity === a.entity) return moreInfo(this, a.entity);
    this._spkPicked = a.entity;
    haptic("selection");
    this._update();
  }

  // the alarm clock that rings on this room's speaker: when it's set, and whether it's on
  _alarm() {
    const cfg = this._config.alarm, el = this._el, h = this._hass;
    const st = cfg && h.states[cfg.entity];
    el.alarmBand.hidden = !st;
    if (!st) return;
    const armed = st.state === "on";
    const time = cfg.time && h.states[cfg.time];
    attr(el.alarmIcon, "data-live", armed);
    attr(el.alarmGlyph, "icon", cfg.icon || (armed ? "mdi:alarm" : "mdi:alarm-off"));
    text(el.alarmName, cfg.name || st.attributes.friendly_name || "Alarm");
    text(el.alarmSub, armed ? (time ? this._nextAlarm(time) : "Armed") : "Off");
    text(el.alarmWhen, time ? this._clock(time.state) : "");
    attr(el.alarmWhen, "data-off", !armed);
    el.alarmWhen.hidden = !time;
    attr(el.alarmToggle, "data-on", armed);
    attr(el.alarmToggleIcon, "icon", armed ? "mdi:bell" : "mdi:bell-outline");
    attr(el.alarmToggle, "aria-pressed", armed ? "true" : "false");
    attr(el.alarmToggle, "aria-label", `Alarm ${armed ? "on" : "off"}`);
    attr(el.alarmMeta, "aria-label", `Alarm time ${time ? this._clock(time.state) : "not set"}`);
  }

  _toggleAlarm() {
    const id = this._config.alarm?.entity;
    if (!id) return;
    haptic("light");
    this._call(domainOf(id), "toggle", {}, id);
  }

  // input_datetime says "07:15:00": shown the way this dashboard's locale writes time
  _clock(value) {
    const [hh, mm] = String(value || "").split(":");
    if (hh == null || mm == null) return "";
    const d = new Date();
    d.setHours(Number(hh), Number(mm), 0, 0);
    const fmt = this._hass.locale?.time_format, opts = { hour: "2-digit", minute: "2-digit" };
    if (fmt === "12") opts.hour12 = true;
    if (fmt === "24") opts.hour12 = false;
    try { return new Intl.DateTimeFormat(langOf(this._hass), opts).format(d); } catch (err) { return `${hh}:${mm}`; }
  }

  // how long until it goes off, so the number means something at a glance
  _nextAlarm(time) {
    const [hh, mm] = String(time.state || "").split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "Armed";
    const now = new Date(), at = new Date();
    at.setHours(hh, mm, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    const mins = Math.round((at - now) / 60000), h = Math.floor(mins / 60), m = mins % 60;
    return h ? `in ${h}h ${m}m` : `in ${m}m`;
  }

  // a volume block, under a speaker, or under a TV that has no sound output of its own
  _mountVolume(host, cfg, key) {
    let vol = host.querySelector(".vol");
    if (!vol) {
      vol = document.createElement("div");
      vol.className = "vol";
      vol.innerHTML = `<button class="mute" aria-label="Mute"><ha-icon></ha-icon></button>
        <div class="slider" role="slider" tabindex="0" aria-label="Volume"><div class="bar"><span class="fill"></span></div></div>
        <span class="pct"></span>
        <span class="vsteps"><button class="vstep" data-d="-1" aria-label="Volume down"><ha-icon icon="mdi:minus"></ha-icon></button>
          <button class="vstep" data-d="1" aria-label="Volume up"><ha-icon icon="mdi:plus"></ha-icon></button></span>`;
      host.appendChild(vol);
    }
    const io = this._volumeIO(cfg);
    vol.hidden = !io;
    if (!io) return;
    let bar = this._bars.get(key);
    if (!bar) bar = this._bar(key, vol);
    const swapped = bar.cfg && bar.cfg.entity !== cfg.entity;
    if (swapped) { bar.pending = null; bar.value.snap(io.level); }
    bar.cfg = cfg;
    if (bar.pending != null && (Math.abs(bar.pending - io.level) < 0.02 || Date.now() - bar.pendingAt > VOL_PREDICT)) bar.pending = null;
    if (!bar.dragging && bar.pending == null) { if (this._first) bar.value.snap(io.level); else bar.value.to(io.level); }
    const mute = vol.querySelector(".mute");
    const muteable = has(this._hass.states[io.id], F.VOLUME_MUTE);
    mute.hidden = !muteable;
    if (muteable) {
      attr(mute, "data-on", !!io.muted);
      attr(mute.querySelector("ha-icon"), "icon", io.muted ? "mdi:volume-off" : "mdi:volume-high");
      mute.__act = () => this._mute(bar.cfg, this._volumeIO(bar.cfg)?.id);
      if (!mute.__wired) { mute.__wired = true; this._pressable(mute, { onTap: () => mute.__act(), haptic: null }, 0.08); }
    }
    const steps = this._config.volume_buttons !== false;
    attr(vol, "data-steps", steps);
    vol.querySelector(".vsteps").hidden = !steps;
    for (const btn of vol.querySelectorAll(".vstep")) {
      btn.__bar = bar;
      if (steps && !btn.__wired) { btn.__wired = true; this._pressable(btn, { onTap: () => btn.__bar.step(Number(btn.dataset.d)), haptic: null }, 0.08); }
    }
    const slider = vol.querySelector(".slider");
    attr(slider, "aria-valuenow", Math.round(io.level * 100));
    attr(slider, "aria-valuemin", "0");
    attr(slider, "aria-valuemax", "100");
    // a snap moves nothing the frame loop watches: the bar that now belongs to another box is painted at once
    if (swapped) requestAnimationFrame(() => this._paintAll(null));
  }

  // Where a TV can send its sound, and where it sends it now: an LG TV's own list, or a select
  // entity named in `sound_select` (any brand whose integration offers one). null when it can't switch.
  _soundChoice(cfg) {
    const h = this._hass, st = h.states[cfg.entity];
    if (cfg.sound_select) {
      const sel = h.states[cfg.sound_select];
      if (!sel) return null;
      const options = (sel.attributes.options || []).map((v) => ({ value: v, label: v, icon: "mdi:speaker" }));
      const current = options.find((o) => o.value === sel.state) || (sel.state ? { value: sel.state, label: sel.state } : null);
      return { options, current, set: (v) => h.callService(domainOf(cfg.sound_select), "select_option", { option: v }, { entity_id: cfg.sound_select }) };
    }
    const now = st?.attributes.sound_output;
    if (now == null || cfg.sound_outputs === false) return null;
    const given = cfg.sound_outputs ? asItems(cfg.sound_outputs).map((o) => (typeof o === "string" ? { value: o } : o))
      .map((o) => ({ ...(LG_SOUND.find((x) => x.value === o.value) || { icon: "mdi:speaker", label: title(String(o.value)) }), ...o, ...(o.name ? { label: o.name } : {}) })) : LG_SOUND;
    const current = given.find((o) => o.value === now) || LG_SOUND.find((o) => o.value === now) || { value: now, label: title(String(now)), icon: "mdi:speaker" };
    return { options: given, current, set: (v) => h.callService("webostv", "select_sound_output", { sound_output: v }, { entity_id: cfg.entity }) };
  }

  _soundMenu(anchor) {
    const v = this._active && (this._screenOf(this._active) || this._active), choice = v && this._soundChoice(v);
    if (!choice) return;
    this._soundPicker = this._soundPicker || new ModePicker(this, { onPick: (id, value) => {
      const scr = this._active && (this._screenOf(this._active) || this._active), c = scr && this._soundChoice(scr);
      if (c && value !== c.current?.value) c.set(value);
    } });
    // the popup sits outside the card, so it gets the accent as a colour, not as the card's variable
    const accent = `rgb(${getComputedStyle(this._el.card).getPropertyValue("--accent").trim().split(/\s+/).join(" ")})`;
    const options = choice.options.map((o) => ({ value: o.value, label: o.label, icon: o.icon, color: accent }));
    this._soundPicker.open(anchor, this._el.card, { entity: v.entity, value: choice.current?.value, options, columns: 3 }, "Sound output");
  }

  // Where a source's sound comes out; nothing declared means the box plays its own.
  _soundOutput(cfg) { return (cfg.output !== undefined ? cfg.output : this._config.video_output) || null; }

  // The screen a source plays on: its own `screen`, the card's `screen`, else the one TV among the
  // sources. The screen owns the volume of everything watched on it (an Apple TV or a console has none).
  _screenOf(cfg) {
    const c = this._config, isTv = (v) => this._hass.states[v.entity]?.attributes.device_class === "tv";
    if (cfg.screen) return c.video.find((v) => v.entity === cfg.screen) || { entity: cfg.screen };
    // a TV is its own screen; anything else plays on the card's screen, else on the first TV
    if (cfg.entity === c.screen || isTv(cfg)) return cfg;
    if (c.screen) return c.video.find((v) => v.entity === c.screen) || { entity: c.screen };
    return c.video.find(isTv) || null;
  }

  // A screen's sound goes out to its configured output (a soundbar over eARC) when the TV says so (an
  // LG names its sound output), or, for a TV that doesn't say, while that output is on. Never guessed:
  // without an `output` / `video_output` in the config the TV plays through itself.
  _externalOut(screen) {
    // the card's video_output is its main screen's; a second TV sends its sound only where its own `output` says
    const main = this._screenOf({ entity: "" });
    const out = screen.output !== undefined ? screen.output || null : !main || main.entity === screen.entity ? this._soundOutput(screen) : null;
    if (!out || out === screen.entity) return null;
    // the soundbar playing something of its own (Spotify, Bluetooth) is not the TV's sound, whatever the TV says
    if (!this._fromTv(screen, out)) return null;
    const choice = this._soundChoice(screen);
    if (choice?.current) return choice.current.own ? null : out;
    return this._isOn({ entity: out, ...(this._config.audio.find((a) => a.entity === out) || {}) }) ? out : null;
  }

  // Whose volume belongs under the picked source: its screen's, or the soundbar's when the screen's
  // sound goes there. One bar for one box: that soundbar leaves Listen meanwhile (_busyOutputs).
  _volumeOwner(cfg) {
    if (cfg.volume === false) return null;
    const screen = this._screenOf(cfg) || cfg;
    const out = this._externalOut(screen);
    if (!out) return screen;
    const listed = this._config.audio.find((a) => a.entity === out);
    if (listed) return listed;
    const named = this._config.video.find((v) => v.entity === out);
    return named ? { ...named } : { entity: out };
  }

  // Is the soundbar on the TV's input? Its `source` says (the screen's `output_source` names it exactly;
  // otherwise TV, eARC / ARC, HDMI or optical). A soundbar that names no source counts as the TV's.
  _fromTv(screen, out) {
    const src = this._hass.states[out]?.attributes.source;
    if (src == null || src === "") return true;
    const want = screen.output_source ?? this._config.output_source;
    if (want) return [].concat(want).some((w) => norm(w) === norm(src));
    return /\b(tv|e?arc|hdmi|optical|opt|toslink|spdif)\b/i.test(String(src));
  }

  // The speakers busy being a screen's sound right now: their bar is under that screen, not in Listen.
  _busyOutputs() {
    const busy = new Set();
    const screens = new Set(this._config.video.map((v) => this._screenOf(v) || v));
    for (const screen of screens) {
      if (!this._isOn(screen)) continue;
      const out = this._externalOut(screen);
      if (out) busy.add(out);
    }
    return busy;
  }

  _chips() {
    const el = this._el, c = this._config, h = this._hass;
    const fill = (parent, list) => {
      const keys = new Set();
      for (const cfg of list) {
        const st = cfg.entity && h.states[cfg.entity];
        if (cfg.entity && !st && !cfg.navigation_path) continue;
        const key = cfg.entity || cfg.navigation_path || cfg.name;
        keys.add(key);
        const chip = this._rowOf(parent, key, "button", "pill", `${cfg.icon ? "<ha-icon></ha-icon>" : "<savvy-state-icon></savvy-state-icon>"}<span></span>`);
        if (!chip.__wired) {
          chip.__wired = true;
          this._pressable(chip, { onTap: () => this._runChip(chip.__cfg, "tap"), onHold: () => this._runChip(chip.__cfg, "hold"), haptic: null }, 0.08);
        }
        chip.__cfg = cfg;
        put(chip, "--cc", colorOf(cfg.color) || "rgb(var(--accent))");
        attr(chip, "data-on", !!st && ["on", "playing", "home", "open"].includes(st.state));
        text(chip.querySelector("span"), cfg.name || st?.attributes.friendly_name || title(String(key).split(".").pop()));
        const sIcon = chip.querySelector("savvy-state-icon");
        if (sIcon && sIcon.stateObj !== st) { sIcon.hass = h; sIcon.stateObj = st; }
        const iIcon = chip.querySelector("ha-icon");
        if (iIcon) attr(iIcon, "icon", cfg.icon);
      }
      for (const [key, node] of parent.__rows || []) Motion.show(node, keys.has(key));
      parent.hidden = !keys.size;
    };
    fill(el.presets, c.presets);
    fill(el.actions, c.chips);
    el.tts.hidden = !c.tts;
    if (c.tts) this._syncSend();
    el.extras.hidden = el.presets.hidden && el.actions.hidden && el.tts.hidden;
  }

  _stage() {
    const el = this._el, c = this._config;
    // the stage follows the picked source first, then anything else that's playing
    let src = null, owner = null;
    for (const cfg of [this._active, ...c.video, ...c.audio].filter(Boolean)) {
      const url = this._artOf(cfg);
      if (url) { src = url; owner = cfg; break; }
    }
    el.stage.hidden = !src;
    if (!src) { this._sp.art.snap(0); this._stageOwner = null; return; }
    if (this._stageSrc !== src) {
      this._stageSrc = src;
      this._sp.art.snap(0);
      // the stage takes the artwork's shape first, then the artwork arrives into it
      el.art.onload = () => {
        const r = el.art.naturalWidth / el.art.naturalHeight;
        if (Number.isFinite(r) && r > 0.05) put(el.stage, "--ar", clamp(r, 0.56, 2.6).toFixed(4));
        this._sp.art.to(1, MEDIA_MOTION.art);
        this._wake();
      };
      el.art.onerror = () => { this._sp.art.to(1, MEDIA_MOTION.art); this._wake(); };
      el.art.src = src;
    }
    this._stageOwner = owner;
    const info = this._mediaOf(owner);
    text(el.stageT, info.title);
    text(el.stageS, info.sub);
    const pos = this._position(this._hass.states[owner.entity]);
    el.progress.hidden = pos == null;
    if (pos != null) {
      if (this._first || Math.abs(pos - this._sp.progress.x) > 0.08) this._sp.progress.snap(pos);
      else this._sp.progress.to(pos);
    }
  }

  // one ticking clock, only while something is actually running on screen
  _syncTick() {
    const owner = this._stageOwner;
    const need = !!owner && ACTIVE.has(this._hass.states[owner.entity]?.state) && this._position(this._hass.states[owner.entity]) != null;
    if (need === !!this._tick) return;
    clearInterval(this._tick);
    this._tick = need ? setInterval(() => {
      if (!this._onscreen || !this._stageOwner) return;
      const p = this._position(this._hass.states[this._stageOwner.entity]);
      if (p != null) { this._sp.progress.to(p); this._wake(); }
    }, 1000) : 0;
  }

  _paint(dirty, all, red) {
    const sp = this._sp, el = this._el;
    if (all || dirty.has("sources")) {
      const pill = el.sources.querySelector(".sel"), w = Math.max(0, sp.pillW.x);
      put(pill, "opacity", w < 1 ? "0" : "");
      put(pill, "width", `${w.toFixed(2)}px`);
      put(pill, "transform", `translate3d(${sp.pill.x.toFixed(2)}px,0,0)`);
    }
    if (all || dirty.has("speakers")) {
      const pill = el.speakers.querySelector(".sel"), w = Math.max(0, sp.spkW.x);
      put(pill, "opacity", w < 1 ? "0" : "");
      put(pill, "width", `${w.toFixed(2)}px`);
      put(pill, "transform", `translate3d(${sp.spk.x.toFixed(2)}px,0,0)`);
    }
    if (all || dirty.has("now")) {
      const s = clamp(sp.swap.x);
      put(el.nowRow, "opacity", s > 0.999 ? "" : s.toFixed(3));
      put(el.nowRow, "transform", red || s > 0.999 ? "" : `translateY(${((1 - s) * 5).toFixed(2)}px)`);
    }
    if (all || dirty.has("stage")) {
      const a = clamp(sp.art.x);
      // blur and scale together, so the artwork arrives as a material
      put(el.art, "opacity", a.toFixed(3));
      put(el.art, "filter", red || a > 0.995 ? "" : `blur(${((1 - a) * 14).toFixed(2)}px)`);
      put(el.art, "transform", red || a > 0.995 ? "" : `scale(${(1.04 - 0.04 * a).toFixed(4)})`);
      put(el.progressFill, "transform", `scaleX(${clamp(sp.progress.x).toFixed(4)})`);
    }
    for (const [, bar] of this._bars) {
      if (!all && !dirty.has(bar.value.group)) continue;
      const v = clamp(bar.value.x), g = clamp(bar.grab.x);
      put(bar.el.querySelector(".fill"), "transform", `scaleX(${v.toFixed(4)})`);
      put(bar.el.querySelector(".bar"), "transform", red ? "" : `scaleY(${(1 + 0.45 * g).toFixed(3)})`);
      text(bar.el.querySelector(".pct"), `${Math.round(v * 100)}%`);
      const [down, up] = bar.el.querySelectorAll(".vstep");
      if (down) attr(down, "disabled", v <= 0.001);
      if (up) attr(up, "disabled", v >= 0.999);
    }
  }
}

// ---------- editor ----------
const playerList = (name, label, helper) => ({ name, label, helper, type: "list", add: { selector: { entity: { domain: "media_player" } }, label: "Add a player" },
  item: [
    { name: "entity", label: "Player", selector: { entity: { domain: "media_player" } } },
    { type: "grid", name: "", schema: [{ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }] },
    { name: "power", label: "Power switch", helper: "A switch that powers it, when the player can't turn itself on.", selector: { entity: { domain: ["switch", "input_boolean"] } } },
    { name: "screen", label: "Screen", helper: "The TV this source plays on, when the room has more than one.", selector: { entity: { domain: "media_player" } } },
    { name: "output", label: "Sound output", helper: "For a screen: the soundbar it sends its sound to. Overrides the card's output.", selector: { entity: { domain: "media_player" } } },
    { name: "sound_select", label: "Sound output list", helper: "A select entity that switches where the TV's sound goes. An LG TV needs none: its outputs are found.", selector: { entity: { domain: ["select", "input_select"] } } },
    { name: "volume", label: "Volume helper", helper: "A helper that is the real volume, when the player's own isn't.", selector: { entity: { domain: ["input_number", "number"] } } },
    { name: "artwork", label: "Artwork when", helper: "A binary sensor that says the artwork is worth showing.", selector: { entity: { domain: "binary_sensor" } } },
  ] });

const EDITOR = defineEditor("savvy-media-card", (hass, c) => [
  S.area(),
  S.grid(S.text("name", "Name"), S.select("layout", "Layout", [{ value: "full", label: "Full" }, { value: "compact", label: "Compact (one row)" }])),
  S.titleLink("name"),
  playerList("video", "Video sources", "Empty: the area's players (not its speakers)."),
  playerList("audio", "Speakers", "The room's speakers: each with its transport, volume and power; two or more get a picker. Empty: the area's speakers and receivers."),
  { name: "screen", label: "Screen", helper: "The TV the sources play on: it owns their volume. Empty: the one source that is a TV.", selector: { entity: { domain: "media_player" } } },
  { name: "output_source", label: "Soundbar's TV input", helper: "The soundbar's source while it plays the TV, when it isn't called TV, ARC, eARC, HDMI or Optical.", selector: { text: {} } },
  { name: "video_output", label: "Screen's sound output", helper: "The soundbar or receiver the screen sends its sound to (eARC). While it does, the bar is the soundbar's and the soundbar leaves Listen. Empty: the TV plays through itself.", selector: { entity: { domain: "media_player" } } },
  S.grid(S.bool("artwork", "Show artwork", null, true), S.bool("volume_buttons", "Volume buttons", null, true)),
  S.grid(S.number("volume_step", "Volume step", 1, 25, 1, "%"), S.number("artwork_max_height", "Artwork height", 80, 800, 10, "px")),
  { type: "expandable", name: "labels", title: "Captions", schema: [S.text("video", "Video caption"), S.text("audio", "Speaker caption")] },
  { type: "expandable", name: "alarm", title: "Alarm clock", schema: [
    { name: "entity", label: "On / off", selector: { entity: { domain: ["input_boolean", "switch"] } } },
    { name: "time", label: "Time", selector: { entity: { domain: "input_datetime" } } },
    { name: "name", label: "Name", selector: { text: {} } },
  ] },
  { type: "expandable", name: "tts", title: "Text to speech", schema: [
    { name: "action", label: "Action", helper: "e.g. tts.speak, or notify.alexa_media_…", selector: { text: {} } },
    { name: "data", label: "Data", helper: "$MSG is where the text goes.", selector: { object: {} } },
    { name: "placeholder", label: "Placeholder", selector: { text: {} } },
  ] },
  S.chips("presets", "Presets", "Stations, playlists: a button presses, a script runs."),
  S.chips("chips", "Custom chips", "The room's other media controls."),
]);

registerCard("savvy-media-card", SavvyMediaCard, "Media",
  "A room's media: artwork, its sources and the speaker they play through, volume, presets and text to speech.");
