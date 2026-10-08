// A live Home Assistant for the demo: the `hass` object the cards read, and the services and
// websocket calls they make, answered against the demo house. A tap changes the house a moment
// later, the way a real device answers, and every card on the page follows.
//   const live = SavvyDemo.createLive({ dark, dashboard, onMoreInfo })
//   live.attach(card)   live.detach(card)   live.setDark(bool)   live.hass
(() => {
  const D = window.SavvyDemo;
  const MIN = 60000, HOUR = 60 * MIN;
  const now = () => new Date().toISOString();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ids = (target, data) => [].concat(target?.entity_id ?? data?.entity_id ?? []).filter(Boolean);
  const domainOf = (id) => id.split(".")[0];
  // the few states Home Assistant words differently from their raw value
  const WORDS = { partlycloudy: "Partly cloudy", "clear-night": "Clear night", lightning: "Lightning", "lightning-rainy": "Thunderstorm", snowy: "Snowy", pouring: "Pouring",
    not_home: "Away", armed_home: "Armed home", armed_away: "Armed away", armed_night: "Armed night", fan_only: "Fan only", heat_cool: "Heat/cool" };
  const title = (v) => String(v ?? "").replace(/_/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

  function createLive({ dark = true, dashboard = {}, onMoreInfo = () => {} } = {}) {
    const house = D.makeHouse();
    const cards = new Set();
    const userData = {};
    let hass = null, queued = false;

    // ---- the state store
    const get = (id) => house.states[id];
    const patch = (id, next) => {
      const cur = house.states[id];
      if (!cur) return;
      const attributes = { ...cur.attributes, ...(next.attributes || {}) };
      const state = next.state != null ? String(next.state) : cur.state;
      const changed = state !== cur.state;
      house.states[id] = { ...cur, state, attributes, last_changed: changed ? now() : cur.last_changed, last_updated: now() };
      publish();
    };
    // many changes in one task reach the cards as one new hass
    const publish = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; build(); });
    };
    const later = (ms, fn) => setTimeout(fn, ms);

    function build() {
      hass = {
        states: { ...house.states },
        entities: house.entities,
        devices: house.devices,
        areas: house.areas,
        user: { id: "demo", name: "Demo", is_admin: true },
        themes: { darkMode: dark },
        selectedTheme: null,
        language: "en",
        locale: { language: "en", number_format: "language", time_format: "language" },
        config: { unit_system: { temperature: "°C", length: "km" }, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, currency: "EUR" },
        formatEntityState: (st, state) => { const v = state ?? st.state; return WORDS[v] || title(v); },
        callService,
        callWS,
        callApi: async () => { throw new Error("Not available in the demo"); },
        connection: { subscribeMessage: async () => () => {}, subscribeEvents: async () => () => {} },
      };
      for (const card of cards) card.hass = hass;
    }

    // ---- services: what each tap asks for, and how the house answers
    function callService(domain, service, data = {}, target) {
      const list = ids(target, data);
      if (domain === "homeassistant") {
        for (const id of list) callService(domainOf(id), service, {}, { entity_id: id });
        return Promise.resolve();
      }
      const fn = SERVICES[domain]?.[service] || SERVICES._generic[service];
      if (fn) for (const id of list) if (get(id)) fn(id, data);
      return Promise.resolve();
    }

    const onOff = (on) => (id) => later(180, () => patch(id, { state: on ? "on" : "off" }));
    const toggle = (id) => later(180, () => patch(id, { state: get(id).state === "on" ? "off" : "on" }));

    const lightOn = (id, d) => later(160, () => {
      const a = get(id).attributes, modes = a.supported_color_modes || [];
      const next = { state: "on", attributes: {} };
      const n = next.attributes;
      if (!modes.includes("onoff")) {
        if (d.brightness_pct != null) n.brightness = Math.round(clamp(d.brightness_pct, 1, 100) * 2.55);
        else if (d.brightness != null) n.brightness = clamp(d.brightness, 1, 255);
        else if (a.brightness == null) n.brightness = 200;
        if (d.color_temp_kelvin != null) { n.color_mode = "color_temp"; n.color_temp_kelvin = d.color_temp_kelvin; }
        else if (d.hs_color) { n.color_mode = "hs"; n.hs_color = d.hs_color; n.rgb_color = D.hsToRgb(d.hs_color[0], d.hs_color[1] / 100); }
        else if (d.rgb_color) { n.color_mode = "rgb"; n.rgb_color = d.rgb_color; }
        else if (!a.color_mode) n.color_mode = modes.includes("hs") ? "hs" : modes.includes("color_temp") ? "color_temp" : "brightness";
        if (n.color_mode === "hs" && !n.hs_color && !a.hs_color) { n.hs_color = [35, 60]; n.rgb_color = D.hsToRgb(35, 0.6); }
        if (n.color_mode === "color_temp" && !n.color_temp_kelvin && !a.color_temp_kelvin) n.color_temp_kelvin = 2700;
      } else n.color_mode = "onoff";
      patch(id, next);
    });
    const lightOff = (id) => later(160, () => patch(id, { state: "off", attributes: { brightness: null, color_mode: null } }));

    // a cover travels: its position moves a little at a time, as a motor does
    const travel = (id, to) => {
      const a = get(id).attributes;
      clearInterval(house.__travel?.[id]);
      house.__travel = house.__travel || {};
      let pos = a.current_position ?? (get(id).state === "open" ? 100 : 0);
      if (pos === to) return;
      patch(id, { state: to > pos ? "opening" : "closing" });
      house.__travel[id] = setInterval(() => {
        pos += Math.sign(to - pos) * Math.min(4, Math.abs(to - pos));
        const done = pos === to;
        patch(id, { state: done ? (to === 0 ? "closed" : "open") : (to > pos ? "opening" : "closing"), attributes: { current_position: pos } });
        if (done) clearInterval(house.__travel[id]);
      }, 120);
    };

    // ---- the players: a playlist each, a position that moves while playing, the next track when one ends
    const PL = D.PLAYLISTS, at = {};
    for (const [id, list] of Object.entries(PL)) at[id] = Math.max(0, list.findIndex((t) => t.title === get(id)?.attributes.media_title));
    // where a player is now, in seconds
    const positionOf = (id) => {
      const a = get(id).attributes;
      if (a.media_position == null) return 0;
      const run = get(id).state === "playing" ? (Date.now() - Date.parse(a.media_position_updated_at)) / 1000 : 0;
      return Math.min(a.media_duration || Infinity, a.media_position + run);
    };
    const hold = (id) => ({ media_position: Math.round(positionOf(id)), media_position_updated_at: now() });
    const skip = (id, dir) => {
      const list = PL[id];
      if (!list) return;
      // back to the start of this track first, the way players do, unless it has only just begun
      if (dir < 0 && positionOf(id) > 5) return later(150, () => patch(id, { attributes: { media_position: 0, media_position_updated_at: now() } }));
      at[id] = (at[id] + dir + list.length) % list.length;
      later(250, () => patch(id, { attributes: D.nowPlaying(list[at[id]], 0) }));
    };
    const play = (id) => {
      const list = PL[id], cur = get(id);
      const fresh = list && (!cur.attributes.media_title || cur.state === "off" || cur.state === "idle");
      later(200, () => patch(id, { state: "playing", attributes: fresh ? D.nowPlaying(list[at[id]], 0) : { media_position_updated_at: now() } }));
    };
    const pause = (id) => later(200, () => patch(id, { state: "paused", attributes: hold(id) }));
    setInterval(() => {
      for (const id of Object.keys(PL)) {
        const st = get(id);
        if (st?.state === "playing" && st.attributes.media_duration && positionOf(id) >= st.attributes.media_duration - 0.5) skip(id, 1);
      }
    }, 1000);

    // scenes the demo knows how to show; any other scene just records that it ran
    const SCENES = {
      "scene.living_room_movie": { "light.living_room_ceiling": 0, "light.living_room_floor_lamp": { pct: 15, k: 2200 }, "light.living_room_tv_backlight": { pct: 60, hs: [262, 75] }, "light.living_room_sconces": 0, "light.living_room_bookshelf": 0 },
      "scene.living_room_reading": { "light.living_room_floor_lamp": { pct: 85, k: 4000 }, "light.living_room_ceiling": { pct: 55, k: 3500 }, "light.living_room_tv_backlight": 0 },
      "scene.living_room_evening": { "light.living_room_ceiling": { pct: 50, k: 2700 }, "light.living_room_floor_lamp": { pct: 40, k: 2400 }, "light.living_room_sconces": { pct: 35 }, "light.living_room_bookshelf": { pct: 40, hs: [30, 55] } },
      "scene.living_room_bright": { "light.living_room_ceiling": { pct: 100, k: 4500 }, "light.living_room_floor_lamp": { pct: 100, k: 4000 }, "light.living_room_sconces": { pct: 100 }, "light.living_room_bookshelf": { pct: 80, k: 4000 } },
      "scene.kitchen_cooking": { "light.kitchen_pendants": { pct: 100, k: 4000 }, "light.kitchen_island": { pct: 100 }, "light.kitchen_ceiling": 1, "light.kitchen_under_cabinet": { pct: 90, hs: [40, 25] } },
      "scene.kitchen_late_snack": { "light.kitchen_pendants": 0, "light.kitchen_island": 0, "light.kitchen_ceiling": 0, "light.kitchen_under_cabinet": { pct: 25, hs: [28, 70] } },
      "scene.dining_room_dinner": { "light.dining_room_chandelier": { pct: 60, k: 2700 }, "light.dining_room_candles": { pct: 35, hs: [22, 85] }, "light.dining_room_sideboard": { pct: 30, k: 2400 } },
      "scene.dining_room_candlelight": { "light.dining_room_chandelier": { pct: 15, k: 2200 }, "light.dining_room_candles": { pct: 50, hs: [18, 90] }, "light.dining_room_sideboard": 0 },
      "scene.bedroom_wind_down": { "light.bedroom_ceiling": 0, "light.bedroom_bedside_left": { pct: 20, k: 2200 }, "light.bedroom_bedside_right": { pct: 20, k: 2200 }, "light.bedroom_headboard": { pct: 25, hs: [340, 55] } },
      "scene.bedroom_wake_up": { "light.bedroom_ceiling": { pct: 80 }, "light.bedroom_bedside_left": { pct: 70, k: 4000 }, "light.bedroom_bedside_right": { pct: 70, k: 4000 }, "light.bedroom_headboard": 0 },
      "scene.office_focus": { "light.office_desk_lamp": { pct: 100, k: 5500 }, "light.office_ceiling": { pct: 80 }, "light.office_monitor_bar": { pct: 30, k: 5000 } },
      "scene.office_calls": { "light.office_desk_lamp": { pct: 70, k: 4200 }, "light.office_ceiling": { pct: 40 }, "light.office_monitor_bar": { pct: 70, hs: [205, 60] } },
      "scene.kids_room_bedtime": { "light.kids_room_ceiling": 0, "light.kids_room_night_light": { pct: 10, hs: [36, 80] }, "light.kids_room_star_projector": { pct: 40, hs: [230, 80] } },
      "scene.kids_room_play": { "light.kids_room_ceiling": { pct: 100 }, "light.kids_room_night_light": 0, "light.kids_room_star_projector": 0 },
      "scene.party": { "light.living_room_tv_backlight": { pct: 90, hs: [300, 90] }, "light.living_room_bookshelf": { pct: 80, hs: [190, 90] }, "light.kitchen_under_cabinet": { pct: 90, hs: [120, 80] }, "light.dining_room_candles": { pct: 70, hs: [20, 95] } },
    };
    const runScene = (id) => {
      patch(id, { state: now() });
      for (const [light, v] of Object.entries(SCENES[id] || {})) {
        if (!v) lightOff(light);
        else lightOn(light, v === 1 ? {} : { brightness_pct: v.pct, ...(v.k ? { color_temp_kelvin: v.k } : {}), ...(v.hs ? { hs_color: v.hs } : {}) });
      }
    };
    const runScript = (id) => {
      later(100, () => patch(id, { state: "on" }));
      later(1800, () => patch(id, { state: "off" }));
      if (id === "script.good_night") for (const lid of Object.keys(house.states)) if (lid.startsWith("light.") && !lid.includes("night_light")) lightOff(lid);
    };
    const climateAction = (a, mode) => {
      if (mode === "off") return "off";
      if (mode === "fan_only") return "fan";
      const t = a.temperature, c = a.current_temperature;
      if ((mode === "cool" || mode === "auto") && c > t + 0.2) return "cooling";
      if ((mode === "heat" || mode === "auto") && c < t - 0.2) return "heating";
      return "idle";
    };
    const setClimate = (id, next) => later(220, () => {
      const cur = get(id), mode = next.state ?? cur.state;
      const a = { ...cur.attributes, ...(next.attributes || {}) };
      patch(id, { state: mode, attributes: { ...(next.attributes || {}), hvac_action: climateAction(a, mode) } });
    });

    const SERVICES = {
      _generic: { turn_on: onOff(true), turn_off: onOff(false), toggle },
      light: {
        turn_on: lightOn, turn_off: lightOff,
        toggle: (id, d) => (get(id).state === "on" ? lightOff(id) : lightOn(id, d)),
      },
      climate: {
        set_temperature: (id, d) => setClimate(id, { attributes: { temperature: d.temperature } }),
        set_hvac_mode: (id, d) => setClimate(id, { state: d.hvac_mode }),
        set_fan_mode: (id, d) => later(150, () => patch(id, { attributes: { fan_mode: d.fan_mode } })),
        turn_on: (id) => setClimate(id, { state: get(id).attributes.hvac_modes?.find((m) => m !== "off") || "heat" }),
        turn_off: (id) => setClimate(id, { state: "off" }),
        toggle: (id) => setClimate(id, { state: get(id).state === "off" ? (get(id).attributes.hvac_modes?.find((m) => m !== "off") || "heat") : "off" }),
      },
      media_player: {
        media_play_pause: (id) => (get(id).state === "playing" ? pause(id) : play(id)),
        media_play: play,
        media_pause: pause,
        media_stop: (id) => later(200, () => patch(id, { state: "idle", attributes: { media_position: 0, media_position_updated_at: now() } })),
        media_seek: (id, d) => later(120, () => patch(id, { attributes: { media_position: d.seek_position, media_position_updated_at: now() } })),
        media_next_track: (id) => skip(id, 1),
        media_previous_track: (id) => skip(id, -1),
        volume_set: (id, d) => later(120, () => patch(id, { attributes: { volume_level: clamp(d.volume_level, 0, 1) } })),
        volume_up: (id) => later(120, () => patch(id, { attributes: { volume_level: clamp((get(id).attributes.volume_level ?? 0.3) + 0.05, 0, 1) } })),
        volume_down: (id) => later(120, () => patch(id, { attributes: { volume_level: clamp((get(id).attributes.volume_level ?? 0.3) - 0.05, 0, 1) } })),
        volume_mute: (id, d) => later(120, () => patch(id, { attributes: { is_volume_muted: !!d.is_volume_muted } })),
        select_source: (id, d) => later(200, () => patch(id, { attributes: { source: d.source } })),
        // a TV that comes on starts what was on; a box with nothing queued just wakes
        turn_on: (id) => (PL[id] && get(id).attributes.device_class === "tv" ? play(id) : later(400, () => patch(id, { state: "on" }))),
        turn_off: (id) => later(300, () => patch(id, { state: "off", attributes: hold(id) })),
        toggle: (id) => (get(id).state === "off" ? SERVICES.media_player.turn_on(id) : SERVICES.media_player.turn_off(id)),
      },
      lock: {
        lock: (id) => { later(80, () => patch(id, { state: "locking" })); later(900, () => patch(id, { state: "locked", attributes: { changed_by: "Demo" } })); },
        unlock: (id) => { later(80, () => patch(id, { state: "unlocking" })); later(900, () => patch(id, { state: "unlocked", attributes: { changed_by: "Demo" } })); },
        open: (id) => { later(80, () => patch(id, { state: "opening" })); later(1400, () => patch(id, { state: "unlocked", attributes: { changed_by: "Demo" } })); },
      },
      alarm_control_panel: Object.fromEntries([["alarm_arm_home", "armed_home"], ["alarm_arm_away", "armed_away"], ["alarm_arm_night", "armed_night"], ["alarm_disarm", "disarmed"]]
        .map(([svc, st]) => [svc, (id) => { if (st !== "disarmed") later(80, () => patch(id, { state: "arming" })); later(st === "disarmed" ? 300 : 1500, () => patch(id, { state: st })); }])),
      cover: {
        open_cover: (id) => travel(id, 100), close_cover: (id) => travel(id, 0),
        stop_cover: (id) => { clearInterval(house.__travel?.[id]); const p = get(id).attributes.current_position ?? 0; patch(id, { state: p === 0 ? "closed" : "open" }); },
        set_cover_position: (id, d) => travel(id, clamp(d.position, 0, 100)),
        set_cover_tilt_position: (id, d) => later(200, () => patch(id, { attributes: { current_tilt_position: clamp(d.tilt_position, 0, 100) } })),
        open_cover_tilt: (id) => later(200, () => patch(id, { attributes: { current_tilt_position: 100 } })),
        close_cover_tilt: (id) => later(200, () => patch(id, { attributes: { current_tilt_position: 0 } })),
        toggle: (id) => travel(id, (get(id).attributes.current_position ?? 0) > 0 ? 0 : 100),
      },
      fan: {
        turn_on: (id, d) => later(180, () => patch(id, { state: "on", attributes: { percentage: d.percentage ?? (get(id).attributes.percentage || 50), ...(d.preset_mode ? { preset_mode: d.preset_mode } : {}) } })),
        turn_off: onOff(false), toggle,
        set_percentage: (id, d) => later(150, () => patch(id, { state: d.percentage > 0 ? "on" : "off", attributes: { percentage: d.percentage } })),
        set_preset_mode: (id, d) => later(150, () => patch(id, { state: "on", attributes: { preset_mode: d.preset_mode } })),
        oscillate: (id, d) => later(150, () => patch(id, { attributes: { oscillating: !!d.oscillating } })),
        set_direction: (id, d) => later(150, () => patch(id, { attributes: { direction: d.direction } })),
      },
      humidifier: {
        turn_on: onOff(true), turn_off: onOff(false), toggle,
        set_humidity: (id, d) => later(150, () => patch(id, { attributes: { humidity: d.humidity } })),
        set_mode: (id, d) => later(150, () => patch(id, { attributes: { mode: d.mode } })),
      },
      input_select: { select_option: (id, d) => later(120, () => patch(id, { state: d.option })),
        select_next: (id) => { const o = get(id).attributes.options; later(120, () => patch(id, { state: o[(o.indexOf(get(id).state) + 1) % o.length] })); } },
      select: { select_option: (id, d) => later(120, () => patch(id, { state: d.option })) },
      scene: { turn_on: runScene },
      script: { turn_on: runScript, toggle: runScript },
      button: { press: (id) => patch(id, { state: now() }) },
      input_button: { press: (id) => patch(id, { state: now() }) },
      vacuum: {
        start: (id) => { later(300, () => patch(id, { state: "cleaning" })); later(400, () => patch("sensor.robot_status", { state: "cleaning" })); },
        pause: (id) => later(300, () => patch(id, { state: "paused" })),
        stop: (id) => later(300, () => patch(id, { state: "idle" })),
        return_to_base: (id) => {
          later(300, () => { patch(id, { state: "returning" }); patch("sensor.robot_status", { state: "returning_home" }); });
          later(6000, () => { patch(id, { state: "docked" }); patch("sensor.robot_status", { state: "charging" }); });
        },
        locate: () => {},
        set_fan_speed: (id, d) => later(150, () => patch(id, { attributes: { fan_speed: d.fan_speed } })),
        send_command: () => {},
      },
    };
    SERVICES.switch = SERVICES.input_boolean = { turn_on: onOff(true), turn_off: onOff(false), toggle };

    // ---- the house lives: rooms drift toward their targets, the power meter moves
    setInterval(() => {
      for (const id of Object.keys(house.states).filter((k) => k.startsWith("climate."))) {
        const st = get(id), a = st.attributes;
        if (st.state === "off" || a.current_temperature == null) continue;
        const step = clamp(a.temperature - a.current_temperature, -0.1, 0.1);
        if (Math.abs(step) < 0.05) continue;
        const cur = Math.round((a.current_temperature + step) * 10) / 10;
        patch(id, { attributes: { current_temperature: cur, hvac_action: climateAction({ ...a, current_temperature: cur }, st.state) } });
      }
      const lightsOn = Object.values(house.states).filter((s) => s.entity_id.startsWith("light.") && s.state === "on").length;
      patch("sensor.house_power", { state: String(Math.round(780 + lightsOn * 34 + Math.random() * 120)) });
    }, 8000);

    // ---- websocket: history, statistics, the logbook, Frigate, the registry, the dashboard
    async function callWS(m) {
      switch (m.type) {
        case "lovelace/config": return dashboard;
        case "history/history_during_period": return history(m);
        case "recorder/statistics_during_period": return statistics(m);
        case "logbook/get_events": return logbook(m);
        case "config_entries/get": return house.entries;
        case "config/entity_registry/get":
          if (m.entity_id === "vacuum.robot") return { entity_id: m.entity_id, options: { vacuum: { area_mapping: { living_room: ["16"], kitchen: ["17"], bedroom: ["18"], office: ["19"], kids_room: ["20"], dining_room: ["21"] } } } };
          return { entity_id: m.entity_id, options: {} };
        case "vacuum/get_segments": return { segments: [] };
        case "frontend/get_user_data": return { value: userData[m.key] ?? null };
        case "frontend/set_user_data": userData[m.key] = m.value; return null;
        case "auth/sign_path": return { path: m.path };
        case "frigate/reviews/get": return frigateReviews(m);
        case "frigate/events/get": return [];
        case "frigate/recordings/get": return [];
        case "frigate/recordings/summary": return [];
        case "frigate/reviews/viewed": return {};
        default: throw new Error(`${m.type} is not part of the demo`);
      }
    }

    // a value through the day: a slow wave around the current reading, warmer in the afternoon
    const wave = (base, amp, t, phase = 0) => base + amp * Math.sin(((new Date(t).getHours() + new Date(t).getMinutes() / 60 - 9 + phase) / 24) * Math.PI * 2);
    function history(m) {
      const start = Date.parse(m.start_time), end = m.end_time ? Date.parse(m.end_time) : Date.now();
      const out = {};
      for (const id of m.entity_ids || []) {
        const st = get(id);
        if (!st) continue;
        const rows = [], n = 96, span = Math.max(1, end - start);
        const v = Number(st.state), numeric = st.state !== "" && Number.isFinite(v);
        for (let i = 0; i < n; i++) {
          const t = start + (span * i) / n;
          let s;
          if (numeric) {
            const dc = st.attributes.device_class;
            const amp = dc === "temperature" ? 1.6 : dc === "humidity" ? 6 : dc === "power" ? v * 0.4 : dc === "monetary" ? 0 : v * 0.08;
            s = dc === "monetary" ? (v * i) / n : wave(v, amp, t) + ((i * 7919) % 13) * amp * 0.02;
            s = (Math.round(s * 10) / 10).toString();
          } else if (id.startsWith("binary_sensor.")) s = ((i * 37) % 11) < 3 ? "on" : "off";
          else if (id.startsWith("climate.")) s = i < n * 0.35 ? "off" : st.state;
          else s = st.state;
          rows.push({ s, lu: t / 1000 });
        }
        rows.push({ s: st.state, lu: Date.now() / 1000 });
        out[id] = rows;
      }
      return out;
    }

    // hourly use by appliance: the shape of a weekday
    const USE = {
      "sensor.house_energy": (h) => 0.32 + (h >= 6 && h <= 9 ? 0.7 : 0) + (h >= 17 && h <= 22 ? 1.1 : 0) + (h >= 12 && h <= 14 ? 0.4 : 0),
      "sensor.kitchen_oven_energy": (h) => (h === 18 || h === 12 ? 0.9 : 0.02),
      "sensor.living_room_tv_energy": (h) => (h >= 17 ? 0.16 : 0.01),
      "sensor.living_room_ac_energy": (h) => (h >= 13 && h <= 20 ? 0.55 : 0.05),
      "sensor.office_heater_energy": (h) => (h >= 8 && h <= 17 ? 0.35 : 0.02),
      "sensor.washer_energy": (h) => (h === 8 || h === 9 ? 0.5 : 0),
    };
    function statistics(m) {
      const step = { "5minute": 5 * MIN, hour: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR, month: 30 * 24 * HOUR }[m.period] || HOUR;
      const start = Date.parse(m.start_time), end = m.end_time ? Date.parse(m.end_time) : Date.now();
      const out = {};
      for (const id of m.statistic_ids || []) {
        const st = get(id);
        const rows = [];
        let sum = 0;
        for (let t = start; t < end && t <= Date.now(); t += step) {
          let change;
          if (USE[id]) {
            if (step <= HOUR) change = USE[id](new Date(t).getHours()) * (step / HOUR);
            else { change = 0; for (let h = 0; h < 24; h++) change += USE[id](h); change *= (step / (24 * HOUR)) * (0.85 + ((t / step) % 5) * 0.06); }
          } else change = 0;
          sum += change;
          const base = Number(st?.state);
          const mean = Number.isFinite(base) ? wave(base, Math.abs(base) * 0.06 + 0.8, t) : 0;
          rows.push({ start: t, end: t + step, change, sum, state: sum, mean, min: mean - 0.6, max: mean + 0.6 });
        }
        out[id] = rows;
      }
      return out;
    }

    // a day at home, for the story card
    function logbook(m) {
      const day = new Date(); day.setHours(0, 0, 0, 0);
      const at = (hh, mm = 0) => (day.getTime() + (hh * 60 + mm) * 60000) / 1000;
      const ev = (entity_id, state, when, extra = {}) => ({ entity_id, state, when, ...extra });
      const nowS = Date.now() / 1000;
      const all = [
        ...[0, 4, 9, 15, 22].map((x) => ev("binary_sensor.kitchen_motion", "on", at(7, 5 + x))),
        ev("light.kitchen_pendants", "on", at(7, 6)), ev("scene.bedroom_wake_up", "scening", at(7, 0)),
        ev("person.sam", "not_home", at(8, 10)), ev("person.jo", "not_home", at(8, 25)), ev("lock.entrance_door", "locked", at(8, 26)),
        ev("vacuum.robot", "cleaning", at(10, 0)), ev("vacuum.robot", "docked", at(11, 5)),
        ev("binary_sensor.living_room_door", "on", at(12, 0)), ev("binary_sensor.living_room_door", "off", at(12, 1)),
        ev("climate.living_room_ac", "cool", at(14, 30)), ev("binary_sensor.bedroom_window", "on", at(15, 40)),
        ev("person.alex", "home", at(17, 55)), ev("lock.entrance_door", "unlocked", at(18, 2), { context_user_id: "person.alex" }), ev("lock.entrance_door", "locked", at(18, 3)),
        ev("light.living_room_ceiling", "on", at(18, 4)), ev("light.living_room_floor_lamp", "on", at(18, 10)), ev("scene.dining_room_dinner", "scening", at(19, 30)),
        ev("media_player.living_room_tv", "playing", at(20, 15)), ev("lock.back_door", "unlocked", at(21, 5)),
      ].filter((e) => e.when <= nowS);
      const start = m.start_time ? Date.parse(m.start_time) / 1000 : 0;
      return all.filter((e) => e.when >= start && (!m.entity_ids || m.entity_ids.includes(e.entity_id)));
    }

    function frigateReviews(m) {
      const t = Date.now() / 1000, cam = (m.cameras || [])[0] || "front_door";
      return [
        { id: "r1", camera: cam, start_time: t - 300, end_time: t - 240, severity: "alert", has_been_reviewed: false, thumb_path: "", data: { objects: ["person"] } },
        { id: "r2", camera: cam, start_time: t - 7200, end_time: t - 7150, severity: "detection", has_been_reviewed: true, thumb_path: "", data: { objects: ["cat"] } },
      ];
    }

    // more-info: the cards fire it; the demo shows its own panel in place of Home Assistant's dialog
    window.addEventListener("hass-more-info", (e) => { const id = e.detail?.entityId; if (id && get(id)) onMoreInfo(id); });

    build();
    return {
      get hass() { return hass; },
      house,
      attach(card) { cards.add(card); card.hass = hass; },
      detach(card) { cards.delete(card); },
      setDark(v) { dark = !!v; build(); },
      state: get,
      callService,
    };
  }

  D.createLive = createLive;
})();
