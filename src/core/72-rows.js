// ---------------------------------------------------------------------------------------
// core/rows: what a popup row controls, by domain. A lock gets its track; a media player
// its transport and volume; a climate unit its target and modes; a light a brightness bar;
// a cover its buttons; an alarm panel its arm modes. Everything else is a switch or just
// its state. Each kind builds its controls once per row and updates them from the state.
//
//   ROW_KINDS[domain] = { tog?, build(ctx) -> { el, update(st, hass) -> { visible, sub, timed, art } } }
//   ctx: { id, kit, host, hass() }
// ---------------------------------------------------------------------------------------

const feature = (st, bit) => ((st?.attributes.supported_features || 0) & bit) === bit;
const TOGGLE_DOMAINS = new Set(["light", "switch", "input_boolean", "fan", "siren", "humidifier"]);
const call = (ctx, domain, service, data) => ctx.hass().callService(domain, service, data || {}, { entity_id: ctx.id });
const div = (cls) => { const d = document.createElement("div"); d.className = cls; return d; };
const dimmable = (st) => {
  const modes = st.attributes.supported_color_modes;
  return Array.isArray(modes) ? modes.some((m) => ["brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white"].includes(m)) : st.attributes.brightness != null;
};

const ROW_KINDS = {};

// ---- media players: power, previous, play / pause, next, mute; a volume bar with - and +
ROW_KINDS.media_player = {
  build(ctx) {
    const { kit } = ctx;
    const el = div("sv-ctl-media");
    const top = div("sv-line"), vol = div("sv-line sv-vol");
    const power = iconButton(kit, { icon: "mdi:power", label: "Power", onTap: () => { const s = ctx.hass().states[ctx.id]?.state; call(ctx, "media_player", ["off", "standby"].includes(s) ? "turn_on" : "turn_off"); } });
    const prev = iconButton(kit, { icon: "mdi:skip-previous", label: "Previous", onTap: () => call(ctx, "media_player", "media_previous_track") });
    const play = iconButton(kit, { icon: "mdi:play", label: "Play", solid: true, cls: "sv-play", onTap: () => {
      const s = ctx.hass().states[ctx.id]?.state;
      call(ctx, "media_player", s === "idle" ? "media_play" : "media_play_pause");
    } });
    const next = iconButton(kit, { icon: "mdi:skip-next", label: "Next", onTap: () => call(ctx, "media_player", "media_next_track") });
    const mute = iconButton(kit, { icon: "mdi:volume-high", label: "Mute", onTap: () => {
      const st = ctx.hass().states[ctx.id];
      call(ctx, "media_player", "volume_mute", { is_volume_muted: !st?.attributes.is_volume_muted });
    } });
    const spacer = div("sv-spacer");
    top.append(power, prev, play, next, spacer, mute);
    const bar = new SideBar(kit, { label: "Volume", onChange: (v) => call(ctx, "media_player", "volume_set", { volume_level: Math.round(v * 100) / 100 }) });
    const down = iconButton(kit, { icon: "mdi:minus", label: "Volume down", onTap: () => bar.nudge(-1) });
    const up = iconButton(kit, { icon: "mdi:plus", label: "Volume up", onTap: () => bar.nudge(1) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    vol.append(down, bar.el, up, pct);
    el.append(top, vol);
    let first = true;
    return {
      el,
      update(st) {
        const s = st.state, f = (bit) => feature(st, bit);
        const off = ["off", "unavailable", "unknown", "standby"].includes(s);
        const active = ["playing", "paused", "buffering"].includes(s);
        power.hidden = !(f(128) || f(256)) || s === "unavailable";
        attr(power, "data-on", !off);
        prev.hidden = !(active && f(16));
        next.hidden = !(active && f(32));
        play.hidden = !((active && (f(1) || f(16384))) || (s === "idle" && f(16384)));
        play.setIcon(s === "playing" || s === "buffering" ? "mdi:pause" : "mdi:play");
        attr(play, "aria-label", s === "playing" ? "Pause" : "Play");
        mute.hidden = !(active && f(8));
        const muted = !!st.attributes.is_volume_muted;
        mute.setIcon(muted ? "mdi:volume-off" : "mdi:volume-high");
        attr(mute, "data-on", muted);
        vol.hidden = !(active && f(4));
        spacer.hidden = mute.hidden;
        const level = clamp(Number(st.attributes.volume_level) || 0);
        bar.setLevel(level, first);
        text(pct, `${Math.round((bar.pending ?? level) * 100)}%`);
        first = false;
        const title = [st.attributes.media_title, st.attributes.media_artist].filter(Boolean).join(" · ");
        return {
          visible: !top.querySelectorAll(".sv-btn:not([hidden])").length ? !vol.hidden : true,
          sub: active ? title || st.attributes.source || null : null,
          art: active ? st.attributes.entity_picture_local || st.attributes.entity_picture || null : null,
        };
      },
    };
  },
};

// ---- climate: a - target + stepper, and the modes
const HVAC_ORDER = ["off", "cool", "heat", "heat_cool", "auto", "dry", "fan_only"];
const HVAC_LOOK = {
  off: ["Off", "mdi:power"], cool: ["Cool", "mdi:snowflake"], heat: ["Heat", "mdi:fire"], heat_cool: ["Heat/Cool", "mdi:sun-snowflake-variant"],
  auto: ["Auto", "mdi:thermostat-auto"], dry: ["Dry", "mdi:water-percent"], fan_only: ["Fan", "mdi:fan"],
};
ROW_KINDS.climate = {
  build(ctx) {
    const { kit } = ctx;
    const el = div("sv-ctl-climate");
    const line = div("sv-line");
    const label = document.createElement("span");
    label.className = "sv-cap";
    label.textContent = "Target";
    const step = new Stepper(kit, { label: "Target temperature", onChange: (v) => call(ctx, "climate", "set_temperature", { temperature: v }) });
    line.append(label, step.el);
    el.appendChild(line);
    let seg = null, segKey = "";
    return {
      el,
      update(st, hass) {
        const a = st.attributes, unit = hass.config?.unit_system?.temperature || "°C";
        const target = Number(a.temperature);
        line.hidden = !(a.temperature != null && Number.isFinite(target));
        if (!line.hidden) {
          step.set({ value: target, min: Number.isFinite(a.min_temp) ? a.min_temp : 7, max: Number.isFinite(a.max_temp) ? a.max_temp : 35,
            step: Number(a.target_temp_step) || (unit.includes("F") ? 1 : 0.5), unit: "°" });
          attr(line, "data-dim", st.state === "off");
        }
        const have = a.hvac_modes || [];
        // Off, Cool and Heat first, then whatever else the unit has, while there's room for it
        const modes = HVAC_ORDER.filter((m) => have.includes(m)).slice(0, 4);
        const key = modes.join();
        if (key !== segKey) {
          seg?.el.remove();
          segKey = key;
          seg = modes.length ? new Seg(kit, { label: "Mode", items: modes.map((m) => ({ value: m, label: HVAC_LOOK[m][0], icon: HVAC_LOOK[m][1] })),
            onPick: (m) => { if (m !== ctx.hass().states[ctx.id]?.state) call(ctx, "climate", "set_hvac_mode", { hvac_mode: m }); } }) : null;
          if (seg) el.appendChild(seg.el);
          seg?.setValue(st.state, true);
        }
        seg?.setValue(st.state);
        const cur = Number(a.current_temperature);
        const action = a.hvac_action && !["off", "idle"].includes(a.hvac_action) ? title(a.hvac_action) : null;
        return { visible: st.state !== "unavailable", sub: [Number.isFinite(cur) ? `${cur.toFixed(1)}° now` : null, action].filter(Boolean).join(" · ") || null };
      },
    };
  },
};

// ---- lights: a brightness bar
ROW_KINDS.light = {
  tog: true,
  build(ctx) {
    const { kit } = ctx;
    const el = div("sv-line sv-ctl-light");
    const bar = new SideBar(kit, { label: "Brightness", onChange: (v) => call(ctx, "light", "turn_on", { brightness_pct: Math.max(1, Math.round(v * 100)) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    el.append(bar.el, pct);
    let first = true;
    return {
      el,
      update(st) {
        const on = st.state === "on" && dimmable(st);
        const level = clamp((Number(st.attributes.brightness) || 0) / 255);
        if (on) bar.setLevel(level, first);
        text(pct, `${Math.round((bar.pending ?? level) * 100)}%`);
        first = !on;
        return { visible: on };
      },
    };
  },
};

// ---- covers: open, stop, close, and a position bar
ROW_KINDS.cover = {
  build(ctx) {
    const { kit } = ctx;
    const el = div("sv-ctl-cover");
    const line = div("sv-line");
    const open = iconButton(kit, { icon: "mdi:arrow-up", label: "Open", onTap: () => call(ctx, "cover", "open_cover") });
    const stop = iconButton(kit, { icon: "mdi:stop", label: "Stop", onTap: () => call(ctx, "cover", "stop_cover") });
    const close = iconButton(kit, { icon: "mdi:arrow-down", label: "Close", onTap: () => call(ctx, "cover", "close_cover") });
    line.append(open, stop, close);
    const posLine = div("sv-line");
    const bar = new SideBar(kit, { label: "Position", onChange: (v) => call(ctx, "cover", "set_cover_position", { position: Math.round(v * 100) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    posLine.append(bar.el, pct);
    el.append(line, posLine);
    let first = true;
    return {
      el,
      update(st) {
        const sf = st.attributes.supported_features ?? 11;
        open.hidden = !(sf & 1);
        close.hidden = !(sf & 2);
        stop.hidden = !(sf & 8);
        attr(open, "disabled", st.state === "open" && st.attributes.current_position === 100);
        attr(close, "disabled", st.state === "closed");
        const pos = Number(st.attributes.current_position);
        posLine.hidden = !((sf & 4) && Number.isFinite(pos));
        if (!posLine.hidden) { bar.setLevel(clamp(pos / 100), first); text(pct, `${Math.round((bar.pending ?? pos / 100) * 100)}%`); first = false; }
        const words = title(st.state);
        return { visible: st.state !== "unavailable", sub: Number.isFinite(pos) ? `${words} · ${Math.round(pos)}%` : words };
      },
    };
  },
};

// ---- alarm panels: arm modes; disarming (and a code) is the more-info dialog's job
const ARM = [["home", "Home", 1, "mdi:shield-home"], ["away", "Away", 2, "mdi:shield-lock"], ["night", "Night", 4, "mdi:shield-moon"], ["vacation", "Vacation", 32, "mdi:shield-airplane"]];
ROW_KINDS.alarm_control_panel = {
  build(ctx) {
    const { kit } = ctx;
    const el = div("sv-ctl-alarm sv-line");
    let seg = null, segKey = "";
    const disarm = document.createElement("button");
    disarm.className = "sv-pillbtn";
    disarm.innerHTML = '<ha-icon icon="mdi:shield-off"></ha-icon><span>Disarm</span>';
    kit.press(disarm, () => moreInfo(ctx.host, ctx.id), { depth: 0.05 });
    el.appendChild(disarm);
    return {
      el,
      update(st) {
        const a = st.attributes, sf = a.supported_features ?? 7;
        const modes = ARM.filter((m) => sf & m[2]);
        const key = modes.map((m) => m[0]).join();
        if (key !== segKey) {
          seg?.el.remove();
          segKey = key;
          seg = modes.length ? new Seg(kit, { label: "Arm mode", items: modes.map((m) => ({ value: m[0], label: m[1], icon: m[3] })), onPick: (m) => {
            const cur = ctx.hass().states[ctx.id];
            if (cur?.state === `armed_${m}`) return;
            const needsCode = cur?.attributes.code_format != null && cur.attributes.code_arm_required !== false;
            if (needsCode) moreInfo(ctx.host, ctx.id);
            else call(ctx, "alarm_control_panel", `alarm_arm_${m}`);
          } }) : null;
          if (seg) el.insertBefore(seg.el, disarm);
          seg?.setValue(undefined, true);
        }
        const armed = /^armed_(.+)$/.exec(st.state);
        seg?.setValue(armed && modes.some((m) => m[0] === armed[1]) ? armed[1] : null);
        disarm.hidden = st.state === "disarmed" || st.state === "unavailable";
        return { visible: st.state !== "unavailable", sub: stateText(ctx.hass(), st) };
      },
    };
  },
};

// ---- fans: a speed bar
ROW_KINDS.fan = {
  tog: true,
  build(ctx) {
    const { kit } = ctx;
    const el = div("sv-line sv-ctl-fan");
    const bar = new SideBar(kit, { label: "Speed", step: 0.1, onChange: (v) => call(ctx, "fan", "set_percentage", { percentage: Math.max(1, Math.round(v * 100)) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    el.append(bar.el, pct);
    let first = true;
    return {
      el,
      update(st) {
        const p = Number(st.attributes.percentage);
        const on = st.state === "on" && st.attributes.percentage != null && Number.isFinite(p);
        if (on) bar.setLevel(clamp(p / 100), first);
        if (on) text(pct, `${Math.round((bar.pending ?? p / 100) * 100)}%`);
        first = !on;
        return { visible: on };
      },
    };
  },
};

// ---- locks: the track
ROW_KINDS.lock = {
  build(ctx) {
    const { kit } = ctx;
    const el = div("sv-ctl-lock");
    const track = new LockTrack(kit, {
      label: "Lock", canOpen: feature(ctx.hass().states[ctx.id], 1),
      onLock: () => call(ctx, "lock", "lock"), onUnlock: () => call(ctx, "lock", "unlock"), onOpen: () => call(ctx, "lock", "open"),
    });
    track.onWords = () => ctx.refresh?.();
    el.appendChild(track.el);
    let first = true;
    return {
      el, track,
      update(st) {
        if (track.canOpen !== feature(st, 1)) { /* the feature set doesn't change at runtime */ }
        track.setState(st.state, first);
        first = false;
        return { visible: true, sub: track.words, timed: true };
      },
    };
  },
};

// ---- sorting: by room (headings), by recent change (flat), or as given
function sortRows(hass, ids, { sort, pinned = [] } = {}) {
  const out = [];
  if (!sort) return ids.map((id) => ({ id }));
  const pin = new Set(pinned);
  for (const id of pinned) if (ids.includes(id)) out.push({ id });
  const rest = ids.filter((id) => !pin.has(id));
  const nameOf = (id) => hass.states[id]?.attributes.friendly_name || id;
  const changed = (id) => Date.parse(hass.states[id]?.last_changed) || 0;
  if (sort === "recent") {
    rest.sort((a, b) => changed(b) - changed(a) || nameOf(a).localeCompare(nameOf(b)));
    for (const id of rest) out.push({ id });
    return out;
  }
  const groups = new Map();
  for (const id of rest) {
    const area = entityArea(hass, id) || "";
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(id);
  }
  const label = (area) => (area ? areaInfo(hass, area).name : "No room");
  const keys = [...groups.keys()].sort((a, b) => (!a) - (!b) || label(a).localeCompare(label(b)));
  for (const area of keys) {
    out.push({ head: { key: area || "_none", label: label(area) } });
    const list = groups.get(area).sort((a, b) => (isActive(hass.states[b]) - isActive(hass.states[a])) || nameOf(a).localeCompare(nameOf(b)));
    for (const id of list) out.push({ id });
  }
  return out;
}

const ROWS_CSS = `
  .sv-sheet [hidden] { display: none !important; }
  .sv-btn, .sv-seg-b, .sv-pillbtn { border: 0; margin: 0; font: inherit; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
  .sv-seg-b { background: none; }
  .sv-row { display: flex; flex-direction: column; border-radius: 14px; }
  .sv-main { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 8px 6px 6px; border-radius: 14px; cursor: pointer; }
  .sv-main:hover { background: var(--well); }
  .sv-row[data-off] .sv-main { opacity: 0.55; }
  .sv-art { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
  .sv-ic[data-art] { overflow: hidden; padding: 0; }
  .sv-ctl { display: flex; flex-direction: column; gap: 8px; padding: 2px 8px 10px 54px; }
  @container (max-width: 380px) { .sv-ctl { padding-inline-start: 8px; } }
  .sv-ctl > div:not(.sv-line) { display: flex; flex-direction: column; gap: 8px; }
  .sv-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .sv-line[data-dim] { opacity: 0.5; }
  .sv-spacer { flex: 1; }
  .sv-cap { flex: 1; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .sv-pct { flex: none; min-width: 34px; text-align: end; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  /* round buttons */
  .sv-btn { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: var(--well);
    color: var(--primary-text-color); --mdc-icon-size: 19px; }
  .sv-btn ha-icon { display: flex; }
  .sv-btn[data-on] { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) 16%, transparent); }
  .sv-btn[data-solid] { width: 44px; border-radius: 14px; background: var(--row-c, rgb(var(--accent))); color: #fff; --mdc-icon-size: 23px; }
  .sv-btn[disabled] { opacity: 0.35; cursor: default; }
  :host([kbd]) .sv-btn:focus-visible, :host([kbd]) .sv-seg-b:focus-visible, :host([kbd]) .sv-bar:focus-visible, :host([kbd]) .sv-lk:focus-visible, :host([kbd]) .sv-pillbtn:focus-visible, :host([kbd]) .sv-main:focus-visible
    { outline: 2px solid var(--row-c, rgb(var(--accent))); outline-offset: 2px; }
  /* the bar: a pill that only moves on a sideways drag */
  .sv-bar { position: relative; flex: 1; min-width: 60px; height: 30px; border-radius: 99px; overflow: hidden; background: var(--well);
    touch-action: pan-y; cursor: grab; outline: none; }
  .sv-bar:active { cursor: grabbing; }
  .sv-bar-fill { position: absolute; inset: 0; border-radius: 99px; transform-origin: 0 50%; transform: scaleX(0);
    background: linear-gradient(90deg, color-mix(in oklab, var(--row-c, rgb(var(--accent))) 55%, transparent), var(--row-c, rgb(var(--accent)))); }
  /* segmented control */
  .sv-seg { position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); padding: 3px; border-radius: 13px; background: var(--well); min-width: 0; }
  .sv-seg-pill { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--n)); border-radius: 10px;
    background: var(--card-background-color, #fff); box-shadow: 0 1px 4px rgb(0 0 0 / 0.22);
    transform: translateX(calc(var(--i, 0) * 100%)); }
  .sv-seg-b { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; height: 32px; padding: 0 4px;
    border-radius: 10px; font-size: 12.5px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); --mdc-icon-size: 16px; }
  .sv-seg-b ha-icon { display: flex; flex: none; }
  .sv-seg-b span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-seg-b[data-on] { color: var(--row-c, rgb(var(--accent))); }
  /* stepper */
  .sv-step { flex: none; display: flex; align-items: center; gap: 6px; }
  .sv-step-v { min-width: 52px; text-align: center; font-size: 16px; line-height: 20px; font-weight: 650; letter-spacing: -0.01em; }
  .sv-pillbtn { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; border-radius: 13px; background: var(--well);
    font-size: 12.5px; font-weight: 600; color: var(--primary-text-color); --mdc-icon-size: 17px; }
  .sv-pillbtn ha-icon { display: flex; }
  .sv-ctl-alarm .sv-seg { flex: 1; }
  .sv-ctl-climate .sv-seg { flex: none; }
  /* the sort toggle at the top of a popup's list */
  .sv-sortbar { display: flex; }
  .sv-sortbar .sv-seg { flex: 1; }
  .sv-sortbar .sv-seg-b { height: 28px; }
  /* the lock track: three stops, one knob */
  .sv-lk { --lk: 76 175 80; position: relative; box-sizing: border-box; height: 44px; border-radius: 22px; padding: 0 4px; overflow: hidden;
    background: rgb(var(--lk) / 0.16); box-shadow: inset 0 0 0 1px rgb(var(--lk) / 0.28); touch-action: pan-y; cursor: grab; outline: none; user-select: none; -webkit-user-select: none; }
  .sv-lk[data-drag] { cursor: grabbing; }
  .sv-lk[aria-disabled="true"] { opacity: 0.45; cursor: default; }
  .sv-lk-hint { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; font-size: 12.5px; font-weight: 600; letter-spacing: -0.004em;
    color: rgb(var(--lk)); pointer-events: none; white-space: nowrap; }
  .sv-lk-hint.r { right: 18px; }
  .sv-lk-hint.l { left: 18px; }
  .sv-lk-knob { position: absolute; top: 4px; left: 4px; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: #fff;
    background: rgb(var(--lk)); box-shadow: 0 2px 8px rgb(0 0 0 / 0.3); will-change: transform; --mdc-icon-size: 20px; --ring: 0; --breath: 0; }
  .sv-lk-knob::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgb(var(--lk)); opacity: calc(var(--breath) * 0.7); transform: scale(calc(1 + var(--breath) * 0.2)); pointer-events: none; }
  .sv-lk-knob ha-icon { position: absolute; display: flex; }
  .sv-lk-ring { position: absolute; inset: -4px; width: 44px; height: 44px; transform: rotate(-90deg); opacity: var(--ring); pointer-events: none; }
  .sv-lk-ring circle { fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 125.7; stroke-dashoffset: 125.7; }
  .sv-lk[data-armed] .sv-lk-knob { box-shadow: 0 0 0 4px rgb(var(--lk) / 0.35), 0 2px 8px rgb(0 0 0 / 0.3); }
  .sv-lk[data-bad] { --lk: 224 102 102 !important; }
  @media (prefers-contrast: more) { .sv-lk { box-shadow: inset 0 0 0 1.5px rgb(var(--lk)); } .sv-seg { box-shadow: inset 0 0 0 1px currentColor; } }
`;
