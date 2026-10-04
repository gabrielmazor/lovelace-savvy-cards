// ---------------------------------------------------------------------------------------
// core/rows: what a popup row controls, by domain. A lock gets its track; a media player
// its transport and volume; a climate unit its target and modes; a light a brightness bar;
// a cover its buttons; an alarm panel its arm modes. Everything else is a switch or just
// its state. Each kind builds its controls once per row and updates them from the state.
//
//   ROW_KINDS[domain] = { build(ctx) -> { main?, extra?, fixed?, update(st, hass) -> { extra, sub, val, timed, art } } }
//   main: the control on the row's line (a play button, a stepper); extra: one more line under it,
//   opened by the row's chevron (or always there, when `fixed`: the lock's track).
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

// ---- binary sensors: read-only. Presence and motion say when it last changed; a tripped
// leak / smoke / gas / CO sensor is red.
ROW_KINDS.binary_sensor = {
  build(ctx) {
    // a room's merged sensors: the row's chevron lists the sensors behind it, read only
    const merged = !!ctx.hass().states[ctx.id]?.attributes.savvy_members;
    const extra = merged ? div("sv-xline sv-agg") : null;
    const lines = new Map();
    return {
      extra,
      update(st, hass) {
        const dc = st.attributes.device_class;
        const unavailable = st.state === "unavailable" || st.state === "unknown";
        if (extra) {
          const ids = st.attributes.savvy_members || [];
          ids.forEach((id, i) => {
            let l = lines.get(id);
            if (!l) {
              l = div("sv-agg-l");
              l.setAttribute("role", "button");
              l.tabIndex = 0;
              l.innerHTML = '<span class="n"></span><span class="s"></span>';
              l.onclick = () => moreInfo(ctx.host, id);
              l.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); moreInfo(ctx.host, id); } };
              lines.set(id, l);
            }
            const m = hass.states[id];
            text(l.querySelector(".n"), shortName(hass, id, null));
            const t = Date.parse(m?.last_changed);
            text(l.querySelector(".s"), [m ? stateText(hass, m) : "", Number.isFinite(t) ? since(t, false) : ""].filter(Boolean).join(" · "));
            attr(l, "data-on", m?.state === "on");
            place(extra, l, i);
          });
          for (const [id, l] of lines) if (!ids.includes(id)) { l.remove(); lines.delete(id); }
        }
        return { val: stateText(hass, st), timed: !unavailable && (merged || PRESENCE_CLASSES.includes(dc)), extra: merged,
          sub: merged ? plural(st.attributes.savvy_members.length, "sensor", "sensors") : undefined,
          alert: !unavailable && SAFETY_CLASSES.includes(dc) && st.state === "on" };
      },
    };
  },
};

// ---- media players: play / pause (power when off) on the line; the rest on the extra line
ROW_KINDS.media_player = {
  build(ctx) {
    const { kit } = ctx;
    const powerTap = () => { const s = ctx.hass().states[ctx.id]?.state; call(ctx, "media_player", ["off", "standby"].includes(s) ? "turn_on" : "turn_off"); };
    const main = div("sv-act-in");
    const mainPower = iconButton(kit, { icon: "mdi:power", label: "Power", onTap: powerTap });
    const play = iconButton(kit, { icon: "mdi:play", label: "Play", solid: true, cls: "sv-play", onTap: () => {
      const s = ctx.hass().states[ctx.id]?.state;
      call(ctx, "media_player", s === "idle" ? "media_play" : "media_play_pause");
    } });
    main.append(play, mainPower);
    const extra = div("sv-xline sv-ctl-media");
    const power = iconButton(kit, { icon: "mdi:power", label: "Power", onTap: powerTap });
    const prev = iconButton(kit, { icon: "mdi:skip-previous", label: "Previous", onTap: () => call(ctx, "media_player", "media_previous_track") });
    const next = iconButton(kit, { icon: "mdi:skip-next", label: "Next", onTap: () => call(ctx, "media_player", "media_next_track") });
    const mute = iconButton(kit, { icon: "mdi:volume-high", label: "Mute", onTap: () => {
      const st = ctx.hass().states[ctx.id];
      call(ctx, "media_player", "volume_mute", { is_volume_muted: !st?.attributes.is_volume_muted });
    } });
    const bar = new SideBar(kit, { label: "Volume", onChange: (v) => call(ctx, "media_player", "volume_set", { volume_level: Math.round(v * 100) / 100 }) });
    const down = iconButton(kit, { icon: "mdi:minus", label: "Volume down", onTap: () => bar.nudge(-1) });
    const up = iconButton(kit, { icon: "mdi:plus", label: "Volume up", onTap: () => bar.nudge(1) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    const vol = div("sv-volg");
    vol.append(down, bar.el, up, pct);
    extra.append(prev, next, mute, vol, power);
    let first = true;
    return {
      main, extra,
      update(st) {
        const s = st.state, f = (bit) => feature(st, bit);
        const off = ["off", "unavailable", "unknown", "standby"].includes(s);
        const active = ["playing", "paused", "buffering"].includes(s);
        const canPower = (f(128) || f(256)) && s !== "unavailable";
        mainPower.hidden = !(off && canPower);
        play.hidden = !((active && (f(1) || f(16384))) || (s === "idle" && f(16384)));
        play.setIcon(s === "playing" || s === "buffering" ? "mdi:pause" : "mdi:play");
        attr(play, "aria-label", s === "playing" ? "Pause" : "Play");
        power.hidden = !(canPower && !off);
        attr(power, "data-on", !off);
        prev.hidden = !(active && f(16));
        next.hidden = !(active && f(32));
        mute.hidden = !(active && f(8));
        const muted = !!st.attributes.is_volume_muted;
        mute.setIcon(muted ? "mdi:volume-off" : "mdi:volume-high");
        attr(mute, "data-on", muted);
        vol.hidden = !(active && f(4));
        const level = clamp(Number(st.attributes.volume_level) || 0);
        bar.setLevel(level, first);
        text(pct, `${Math.round((bar.pending ?? level) * 100)}%`);
        first = false;
        const title = [st.attributes.media_title, st.attributes.media_artist].filter(Boolean).join(" · ");
        return {
          extra: [power, prev, next, mute].some((b) => !b.hidden) || !vol.hidden,
          sub: active ? title || st.attributes.source || null : null,
          art: active ? st.attributes.entity_picture_local || st.attributes.entity_picture || null : null,
        };
      },
    };
  },
};

// ---- climate: a - target + stepper on the line (power when off); the modes on the extra line
// Off is a power control, so it comes last in a list of modes
const offLast = (modes) => [...modes.filter((m) => m !== "off"), ...modes.filter((m) => m === "off")];
const HVAC_ORDER = ["off", "cool", "heat", "heat_cool", "auto", "dry", "fan_only"];
const HVAC_LOOK = {
  off: ["Off", "mdi:power"], cool: ["Cool", "mdi:snowflake"], heat: ["Heat", "mdi:fire"], heat_cool: ["Heat/Cool", "mdi:sun-snowflake-variant"],
  auto: ["Auto", "mdi:thermostat-auto"], dry: ["Dry", "mdi:water-percent"], fan_only: ["Fan", "mdi:fan"],
};
ROW_KINDS.climate = {
  build(ctx) {
    const { kit } = ctx;
    const main = div("sv-act-in");
    const power = iconButton(kit, { icon: "mdi:power", label: "Turn on", onTap: () => {
      const cur = ctx.hass().states[ctx.id];
      if (feature(cur, 128)) return call(ctx, "climate", "turn_on");
      const m = HVAC_ORDER.find((x) => x !== "off" && (cur?.attributes.hvac_modes || []).includes(x));
      if (m) call(ctx, "climate", "set_hvac_mode", { hvac_mode: m });
    } });
    const step = new Stepper(kit, { label: "Target temperature", compact: true, onChange: (v) => call(ctx, "climate", "set_temperature", { temperature: v }) });
    main.append(step.el, power);
    const extra = div("sv-xline sv-ctl-climate");
    let seg = null, segKey = "";
    return {
      main, extra,
      update(st, hass) {
        const a = st.attributes, unit = hass.config?.unit_system?.temperature || "°C";
        const target = Number(a.temperature);
        const hasTarget = a.temperature != null && Number.isFinite(target);
        const off = st.state === "off";
        power.hidden = !off;
        step.el.hidden = off || !hasTarget || st.state === "unavailable";
        if (!step.el.hidden) {
          step.set({ value: target, min: Number.isFinite(a.min_temp) ? a.min_temp : 7, max: Number.isFinite(a.max_temp) ? a.max_temp : 35,
            step: Number(a.target_temp_step) || (unit.includes("F") ? 1 : 0.5), unit: "°" });
        }
        const have = a.hvac_modes || [];
        // Off, Cool and Heat first, then whatever else the unit has, while there's room for it
        const modes = offLast(HVAC_ORDER.filter((m) => have.includes(m)).slice(0, 4));
        const key = modes.join();
        if (key !== segKey) {
          seg?.el.remove();
          segKey = key;
          seg = modes.length > 1 ? new Seg(kit, { label: "Mode", items: modes.map((m) => ({ value: m, label: HVAC_LOOK[m][0], icon: HVAC_LOOK[m][1] })),
            onPick: (m) => { if (m !== ctx.hass().states[ctx.id]?.state) call(ctx, "climate", "set_hvac_mode", { hvac_mode: m }); } }) : null;
          if (seg) extra.appendChild(seg.el);
          seg?.setValue(st.state, true);
        }
        seg?.setValue(st.state);
        const cur = Number(a.current_temperature);
        const action = a.hvac_action && !["off", "idle"].includes(a.hvac_action) ? title(a.hvac_action) : null;
        const lead = action || (HVAC_LOOK[st.state]?.[0] ?? title(st.state));
        const range = !hasTarget && Number.isFinite(Number(a.target_temp_low)) && Number.isFinite(Number(a.target_temp_high)) && !off
          ? `${Number(a.target_temp_low)}–${Number(a.target_temp_high)}°` : null;
        return { extra: !!seg && st.state !== "unavailable", sub: [lead, Number.isFinite(cur) ? `${cur.toFixed(1)}° now` : null].filter(Boolean).join(" · "), val: range };
      },
    };
  },
};

// ---- lights: the switch on the line; a brightness bar on the extra line
ROW_KINDS.light = {
  build(ctx) {
    const { kit } = ctx;
    const extra = div("sv-xline sv-ctl-light");
    const bar = new SideBar(kit, { label: "Brightness", onChange: (v) => call(ctx, "light", "turn_on", { brightness_pct: Math.max(1, Math.round(v * 100)) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    extra.append(bar.el, pct);
    let first = true;
    return {
      extra,
      update(st) {
        const on = st.state === "on" && dimmable(st);
        const level = clamp((Number(st.attributes.brightness) || 0) / 255);
        if (on) bar.setLevel(level, first);
        text(pct, `${Math.round((bar.pending ?? level) * 100)}%`);
        first = !on;
        return { extra: on, sub: on ? `${Math.round(level * 100)}%` : null };
      },
    };
  },
};

// ---- covers: open / close (stop while it moves) on the line; stop and a position bar below
ROW_KINDS.cover = {
  build(ctx) {
    const { kit } = ctx;
    const main = div("sv-act-in");
    const go = iconButton(kit, { icon: "mdi:arrow-up", label: "Open", onTap: () => {
      call(ctx, "cover", go.__mode === "stop" ? "stop_cover" : go.__mode === "close" ? "close_cover" : "open_cover");
    } });
    go.__mode = "open";
    main.appendChild(go);
    const extra = div("sv-xline sv-ctl-cover");
    const stop = iconButton(kit, { icon: "mdi:stop", label: "Stop", onTap: () => call(ctx, "cover", "stop_cover") });
    const bar = new SideBar(kit, { label: "Position", onChange: (v) => call(ctx, "cover", "set_cover_position", { position: Math.round(v * 100) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    extra.append(stop, bar.el, pct);
    let first = true;
    return {
      main, extra,
      update(st) {
        const sf = st.attributes.supported_features ?? 11;
        const moving = st.state === "opening" || st.state === "closing";
        const mode = moving && (sf & 8) ? "stop" : st.state === "closed" ? "open" : "close";
        go.__mode = mode;
        go.setIcon({ open: "mdi:arrow-up", close: "mdi:arrow-down", stop: "mdi:stop" }[mode]);
        attr(go, "aria-label", { open: "Open", close: "Close", stop: "Stop" }[mode]);
        go.hidden = st.state === "unavailable" || (mode === "open" && !(sf & 1)) || (mode === "close" && !(sf & 2));
        stop.hidden = !(sf & 8);
        const pos = Number(st.attributes.current_position);
        const hasPos = !!(sf & 4) && Number.isFinite(pos);
        bar.el.hidden = pct.hidden = !hasPos;
        if (hasPos) { bar.setLevel(clamp(pos / 100), first); text(pct, `${Math.round((bar.pending ?? pos / 100) * 100)}%`); first = false; }
        const words = title(st.state);
        return { extra: st.state !== "unavailable" && (!stop.hidden || hasPos), sub: Number.isFinite(pos) ? `${words} · ${Math.round(pos)}%` : words };
      },
    };
  },
};

// ---- alarm panels: the state on the line; arm modes below; disarming (and a code) is the more-info dialog's job
const ARM = [["home", "Home", 1, "mdi:shield-home"], ["away", "Away", 2, "mdi:shield-lock"], ["night", "Night", 4, "mdi:shield-moon"], ["vacation", "Vacation", 32, "mdi:shield-airplane"]];
ROW_KINDS.alarm_control_panel = {
  build(ctx) {
    const { kit } = ctx;
    const main = div("sv-act-in");
    const pill = document.createElement("button");
    pill.className = "sv-pillbtn sv-state";
    pill.innerHTML = "<span></span>";
    attr(pill, "aria-label", "Open alarm panel");
    kit.press(pill, () => moreInfo(ctx.host, ctx.id), { depth: 0.05 });
    main.appendChild(pill);
    const extra = div("sv-xline sv-ctl-alarm");
    const disarm = iconButton(kit, { icon: "mdi:shield-off", label: "Disarm", onTap: () => moreInfo(ctx.host, ctx.id) });
    extra.appendChild(disarm);
    let seg = null, segKey = "";
    return {
      main, extra,
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
          if (seg) extra.insertBefore(seg.el, disarm);
          seg?.setValue(undefined, true);
        }
        const armed = /^armed_(.+)$/.exec(st.state);
        seg?.setValue(armed && modes.some((m) => m[0] === armed[1]) ? armed[1] : null);
        disarm.hidden = st.state === "disarmed" || st.state === "unavailable";
        const words = stateText(ctx.hass(), st);
        text(pill.firstElementChild, words);
        attr(pill, "data-armed", armed || st.state === "triggered" || st.state === "arming" || st.state === "pending");
        return { extra: st.state !== "unavailable" && (modes.length > 0 || !disarm.hidden), sub: null };
      },
    };
  },
};

// ---- fans: the switch on the line; a speed bar on the extra line
ROW_KINDS.fan = {
  build(ctx) {
    const { kit } = ctx;
    const extra = div("sv-xline sv-ctl-fan");
    const bar = new SideBar(kit, { label: "Speed", step: 0.1, onChange: (v) => call(ctx, "fan", "set_percentage", { percentage: Math.max(1, Math.round(v * 100)) }) });
    const pct = document.createElement("span");
    pct.className = "sv-pct";
    extra.append(bar.el, pct);
    let first = true;
    return {
      extra,
      update(st) {
        const p = Number(st.attributes.percentage);
        const on = st.state === "on" && st.attributes.percentage != null && Number.isFinite(p);
        if (on) bar.setLevel(clamp(p / 100), first);
        if (on) text(pct, `${Math.round((bar.pending ?? p / 100) * 100)}%`);
        first = !on;
        return { extra: on, sub: on ? `${Math.round(p)}%` : null };
      },
    };
  },
};

// ---- locks: the row's own icon is the handle you slide across the row
ROW_KINDS.lock = {
  build(ctx) {
    const { kit } = ctx;
    const slide = new LockSlide(kit, {
      host: ctx.line, handle: ctx.handle, label: "Lock", canOpen: feature(ctx.hass().states[ctx.id], 1), fade: [ctx.text],
      onLock: () => call(ctx, "lock", "lock"), onUnlock: () => call(ctx, "lock", "unlock"), onOpen: () => call(ctx, "lock", "open"),
    });
    slide.onWords = () => ctx.refresh?.();
    let first = true;
    return {
      track: slide, slide,
      update(st) {
        slide.setState(st.state, first);
        first = false;
        return { sub: slide.words, timed: true };
      },
    };
  },
};

// ---- bulk actions: what the popup's top button does to everything it lists
const BULK = {
  lights: { label: "All off", icon: "mdi:lightbulb-off-outline", domain: "light", service: "turn_off", needs: (st) => st.state === "on" },
  climate: { label: "All off", icon: "mdi:power", domain: "climate", service: "turn_off", needs: (st) => !["off", "unavailable", "unknown"].includes(st.state) },
  media: { label: "Pause all", icon: "mdi:pause", domain: "media_player", service: "media_pause", needs: (st) => st.state === "playing" },
  security: { label: "Lock all", icon: "mdi:lock", domain: "lock", service: "lock", needs: (st) => !["locked", "locking", "jammed", "unavailable", "unknown"].includes(st.state) },
};
// the kind of bulk action a list's entities all agree on (a popup that doesn't name one), or null
function bulkKindOf(ids) {
  const doms = new Set(ids.map(domainOf));
  if (doms.size !== 1) return null;
  const d = [...doms][0];
  return Object.keys(BULK).find((k) => BULK[k].domain === d) || null;
}
// exactly the listed entities of the kind's domain that still need it
const bulkTargets = (kind, ids, hass) => ids.filter((id) => domainOf(id) === BULK[kind].domain && hass.states[id] && BULK[kind].needs(hass.states[id]));

// ---- sorting: by room (headings), by recent change (flat), or as given
// `order`: area ids listed first, in this order; the rest follow by name, and "No room" is always last
function sortRows(hass, ids, { sort, pinned = [], order = [] } = {}) {
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
  const rank = new Map([].concat(order || []).map((a, i) => [a, i]));
  const keys = [...groups.keys()].sort((a, b) => (!a) - (!b) || (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || label(a).localeCompare(label(b)));
  for (const area of keys) {
    out.push({ head: { key: area || "_none", label: label(area) } });
    const list = groups.get(area).sort((a, b) => (isActive(hass.states[b]) - isActive(hass.states[a])) || nameOf(a).localeCompare(nameOf(b)));
    for (const id of list) out.push({ id });
  }
  return out;
}

const ROWS_CSS = `
  .sv-sheet [hidden] { display: none !important; }
  /* every button in a popup starts from nothing: the browser's border and padding would push anything drawn inside it off centre */
  :where(.sv-sheet, .sv-scrim) button { appearance: none; -webkit-appearance: none; border: 0; margin: 0; padding: 0; background: none; box-sizing: border-box;
    font: inherit; color: inherit; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
  .sv-btn, .sv-seg-b, .sv-pillbtn, .sv-bulk, .sv-chev { cursor: pointer; }
  /* a row: one line; its chevron opens one more */
  .sv-row { display: flex; flex-direction: column; border-radius: 14px; }
  .sv-line1 { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 3px 4px 3px 4px; border-radius: 14px; }
  .sv-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 38px; border-radius: 12px; cursor: pointer; outline: none; }
  .sv-main:hover { background: var(--well); }
  .sv-row[data-off] .sv-main, .sv-row[data-off] .sv-val { opacity: 0.55; }
  .sv-act { flex: none; display: flex; align-items: center; gap: 6px; }
  .sv-act:empty { display: none; }
  .sv-act-in { display: flex; align-items: center; gap: 6px; }
  .sv-chev { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .sv-chev ha-icon { display: flex; }
  .sv-chev[data-none] { visibility: hidden; pointer-events: none; }
  .sv-row[data-open] .sv-chev { color: var(--primary-text-color); background: var(--well); }
  .sv-art { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
  .sv-ic[data-art] { overflow: hidden; padding: 0; }
  /* the extra line: one row of controls, opened with a spring */
  .sv-ctl { overflow: hidden; }
  .sv-ctl-in { padding: 2px 6px 8px 50px; }
  @container (max-width: 380px) { .sv-ctl-in { padding-inline-start: 6px; } }
  .sv-xline { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .sv-xline .sv-btn { width: var(--c-s); height: var(--c-s); border-radius: 11px; --mdc-icon-size: 18px; }
  .sv-xline .sv-seg { flex: 1; }
  .sv-xline.sv-agg { flex-direction: column; align-items: stretch; gap: 2px; padding: 0 6px 6px 48px; }
  .sv-agg-l { display: flex; justify-content: space-between; gap: 10px; padding: 6px 8px; border-radius: 10px; font-size: 12.5px; line-height: 16px; color: var(--secondary-text-color); cursor: pointer; outline: none; }
  .sv-agg-l .n { min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-agg-l[data-on] .n { color: var(--primary-text-color); }
  @media (hover: hover) { .sv-agg-l:hover { background: var(--well); } }
  .sv-volg { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
  @container (max-width: 330px) { .sv-volg .sv-btn, .sv-volg .sv-pct { display: none; } }
  .sv-spacer { flex: 1; }
  .sv-cap { flex: 1; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  .sv-pct { flex: none; min-width: 34px; text-align: end; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--secondary-text-color); }
  /* round buttons */
  .sv-btn { flex: none; display: grid; place-items: center; width: var(--c-s); height: var(--c-s); border-radius: 11px; background: var(--well);
    color: var(--primary-text-color); --mdc-icon-size: 19px; }
  .sv-btn ha-icon { display: flex; }
  .sv-btn[data-on] { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) 16%, transparent); }
  .sv-btn[data-solid] { width: 34px; border-radius: 50%; background: var(--row-c, rgb(var(--accent))); color: #fff; --mdc-icon-size: 20px; }
  .sv-xline .sv-btn[data-solid] { width: 32px; border-radius: 50%; }
  .sv-btn[disabled] { opacity: 0.35; cursor: default; }
  :host([kbd]) .sv-btn:focus-visible, :host([kbd]) .sv-seg-b:focus-visible, :host([kbd]) .sv-bar:focus-visible, :host([kbd]) .sv-sl-handle:focus-visible, :host([kbd]) .sv-pillbtn:focus-visible, :host([kbd]) .sv-main:focus-visible,
    :host([kbd]) .sv-chev:focus-visible, :host([kbd]) .sv-bulk:focus-visible, :host([kbd]) .sv-tog:focus-visible
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
  .sv-step[data-compact] { gap: 2px; }
  .sv-step[data-compact] .sv-btn { --mdc-icon-size: 17px; }
  .sv-step[data-compact] .sv-step-v { min-width: 42px; font-size: 14px; line-height: 18px; }
  .sv-pillbtn { flex: none; display: inline-flex; align-items: center; gap: 6px; height: var(--c-l); padding: 0 12px; border-radius: 13px; background: var(--well);
    font-size: 12.5px; font-weight: 600; color: var(--primary-text-color); --mdc-icon-size: 17px; }
  .sv-pillbtn ha-icon { display: flex; }
  .sv-pillbtn.sv-state { height: var(--c-s); padding: 0 10px; border-radius: 16px; font-size: 12px; max-width: 132px; }
  .sv-pillbtn.sv-state span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-pillbtn.sv-state[data-armed] { color: var(--row-c, rgb(var(--accent))); background: color-mix(in oklab, var(--row-c, rgb(var(--accent))) var(--mix-on), transparent); }
  /* the top of a popup's list: the sort toggle and the bulk action */
  .sv-tools { display: flex; align-items: center; gap: 8px; }
  .sv-tools .sv-seg { flex: 1; min-width: 0; }
  .sv-tools .sv-seg-b { height: 28px; }
  .sv-bulk { flex: none; display: inline-flex; align-items: center; gap: 5px; height: var(--c-s); padding: 0 12px; border-radius: 11px; background: var(--well);
    font-size: 12.5px; line-height: 16px; font-weight: 650; color: var(--primary-text-color); --mdc-icon-size: 16px; white-space: nowrap; }
  .sv-bulk ha-icon { display: flex; }
  .sv-bulk[disabled] { opacity: 0.4; cursor: default; }
  .sv-tools[data-solo] .sv-bulk { margin-inline-start: auto; }
  ${LOCK_SLIDE_CSS}
  .sv-row[data-kind="lock"] .sv-line1 { padding: 3px 4px; border-radius: 22px; min-height: 46px; }
  .sv-row[data-kind="lock"] .sv-main:hover { background: none; }
  @media (prefers-contrast: more) { .sv-seg { box-shadow: inset 0 0 0 1px currentColor; } }
`;
