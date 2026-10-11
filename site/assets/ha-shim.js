// The three Home Assistant elements the cards draw with, outside Home Assistant:
// <ha-card>, <ha-icon icon="mdi:..."> and <ha-state-icon> (an entity's own icon: its `icon`
// attribute first, else one by domain, device class and state, as Home Assistant picks it).
// Icons come from window.ICONS, a map of mdi names to SVG paths built with the site.
(() => {
  const FALLBACK = "mdi:circle-outline";
  const path = (name) => (window.ICONS && (window.ICONS[name] || window.ICONS[FALLBACK])) || "";
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);display:block"><path fill="currentColor" d="${path(name)}"/></svg>`;

  customElements.define("ha-card", class extends HTMLElement {
    constructor() {
      super();
      // Home Assistant's own card ships `transition: all`; every Savvy card overrides it, as it must there
      this.attachShadow({ mode: "open" }).innerHTML = "<style>:host{display:block;transition:all .3s ease-out}</style><slot></slot>";
    }
  });

  customElements.define("ha-icon", class extends HTMLElement {
    static get observedAttributes() { return ["icon"]; }
    attributeChangedCallback() { this.innerHTML = svg(this.getAttribute("icon")); }
    set icon(v) { this.setAttribute("icon", v); }
    get icon() { return this.getAttribute("icon"); }
  });

  const BINARY = {
    motion: ["mdi:motion-sensor", "mdi:motion-sensor-off"], occupancy: ["mdi:home", "mdi:home-outline"], presence: ["mdi:home", "mdi:home-outline"],
    door: ["mdi:door-open", "mdi:door-closed"], window: ["mdi:window-open", "mdi:window-closed"], garage_door: ["mdi:garage-open", "mdi:garage"],
    moisture: ["mdi:water-alert", "mdi:water-off"], smoke: ["mdi:smoke-detector-alert", "mdi:smoke-detector"], gas: ["mdi:smoke-detector-alert", "mdi:smoke-detector"],
    connectivity: ["mdi:check-network-outline", "mdi:close-network-outline"], battery: ["mdi:battery-alert", "mdi:battery"], problem: ["mdi:alert-circle", "mdi:check-circle"],
  };
  const SENSOR = { temperature: "mdi:thermometer", humidity: "mdi:water-percent", battery: "mdi:battery", illuminance: "mdi:brightness-5", power: "mdi:flash",
    energy: "mdi:lightning-bolt", monetary: "mdi:cash", timestamp: "mdi:clock-outline", carbon_dioxide: "mdi:molecule-co2", duration: "mdi:timer-outline", enum: "mdi:information-outline" };
  const COVER = { blind: ["mdi:blinds-open", "mdi:blinds"], shade: ["mdi:roller-shade", "mdi:roller-shade-closed"], curtain: ["mdi:curtains", "mdi:curtains-closed"],
    awning: ["mdi:awning-outline", "mdi:awning-outline"], garage: ["mdi:garage-open", "mdi:garage"], shutter: ["mdi:window-shutter-open", "mdi:window-shutter"] };

  function iconFor(st) {
    if (!st) return FALLBACK;
    if (st.attributes?.icon) return st.attributes.icon;
    const [domain] = st.entity_id.split(".");
    const dc = st.attributes?.device_class, on = st.state === "on";
    switch (domain) {
      case "binary_sensor": { const pair = BINARY[dc]; return pair ? pair[on ? 0 : 1] : on ? "mdi:checkbox-marked-circle" : "mdi:radiobox-blank"; }
      case "sensor": {
        if (dc === "battery") { const v = Number(st.state); return Number.isFinite(v) ? (v >= 95 ? "mdi:battery" : v < 10 ? "mdi:battery-outline" : `mdi:battery-${Math.max(10, Math.round(v / 10) * 10)}`) : "mdi:battery-unknown"; }
        return SENSOR[dc] || "mdi:eye";
      }
      case "light": return on ? "mdi:lightbulb" : "mdi:lightbulb-outline";
      case "switch": case "input_boolean": return on ? "mdi:toggle-switch" : "mdi:toggle-switch-off";
      case "media_player": return dc === "tv" ? "mdi:television" : dc === "receiver" ? "mdi:audio-video" : "mdi:speaker";
      case "lock": return st.state === "locked" ? "mdi:lock" : st.state === "jammed" ? "mdi:lock-alert" : st.state === "locking" || st.state === "unlocking" ? "mdi:lock-clock" : "mdi:lock-open-variant";
      case "cover": { const pair = COVER[dc] || COVER.shutter; return pair[st.state === "closed" ? 1 : 0]; }
      case "climate": return "mdi:thermostat";
      case "fan": return "mdi:fan";
      case "humidifier": return "mdi:air-humidifier";
      case "weather": return { sunny: "mdi:weather-sunny", "clear-night": "mdi:weather-night", partlycloudy: "mdi:weather-partly-cloudy", cloudy: "mdi:weather-cloudy", rainy: "mdi:weather-rainy" }[st.state] || "mdi:weather-partly-cloudy";
      case "person": return "mdi:account";
      case "device_tracker": return "mdi:cellphone";
      case "zone": return "mdi:map-marker-radius";
      case "script": return "mdi:script-text";
      case "scene": return "mdi:palette";
      case "button": case "input_button": return "mdi:gesture-tap-button";
      case "vacuum": return "mdi:robot-vacuum";
      case "camera": return "mdi:cctv";
      case "alarm_control_panel": return { disarmed: "mdi:shield-off", armed_home: "mdi:shield-home", armed_away: "mdi:shield-lock", armed_night: "mdi:shield-moon", triggered: "mdi:bell-ring" }[st.state] || "mdi:shield";
      case "select": case "input_select": return "mdi:format-list-bulleted";
      case "timer": return "mdi:timer-outline";
      default: return FALLBACK;
    }
  }

  customElements.define("ha-state-icon", class extends HTMLElement {
    set stateObj(st) { this._st = st; this._draw(); }
    get stateObj() { return this._st; }
    set icon(v) { this._icon = v; this._draw(); }
    set hass(v) { this._hass = v; }
    _draw() { this.innerHTML = svg(this._icon || iconFor(this._st)); }
  });

  // <ha-camera-stream>: in Home Assistant, the live picture. Here, a looping scene drawn for each camera,
  // with the grain and the ticking clock of a real feed, so the camera card has something alive to show.
  // It only draws while it is on screen.
  const SCENES = {
    front_door: { sky: ["#b9d3ee", "#e9eef3"], wall: "#59606b", floor: "#3a3f47", draw: porch },
    living_room: { sky: ["#f6d7a6", "#7a5a3c"], wall: "#4a3b2f", floor: "#2b231c", draw: lounge },
    kitchen: { sky: ["#cfe8dc", "#58776a"], wall: "#41544b", floor: "#222b27", draw: kitchen },
    garden: { sky: ["#8fb8ea", "#d7e7f6"], wall: "#3f6b45", floor: "#24402a", draw: garden },
  };
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
  function person(g, x, y, s, a = 0.8) {
    g.fillStyle = `rgba(20,22,28,${a})`;
    g.beginPath(); g.arc(x, y - 58 * s, 10 * s, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x, y - 24 * s, 15 * s, 30 * s, 0, 0, Math.PI * 2); g.fill();
  }
  function porch(g, w, h, t) {
    g.fillStyle = "#6b5a48"; g.fillRect(w * 0.42, h * 0.22, w * 0.16, h * 0.46);              // the door
    g.fillStyle = "#e9c46a"; g.beginPath(); g.arc(w * 0.555, h * 0.46, 3, 0, 7); g.fill();
    g.fillStyle = `rgba(255,214,140,${0.25 + 0.05 * Math.sin(t * 2)})`; g.beginPath(); g.arc(w * 0.62, h * 0.24, 26, 0, 7); g.fill();
    g.fillStyle = "#4b5160"; g.beginPath(); g.moveTo(w * 0.44, h * 0.68); g.lineTo(w * 0.56, h * 0.68); g.lineTo(w * 0.8, h); g.lineTo(w * 0.2, h); g.fill();
    const loop = (t % 14) / 14, walk = loop < 0.5 ? ease(loop * 2) : ease((1 - loop) * 2);  // up the path and back
    if (loop > 0.04 && loop < 0.96) person(g, w * (0.3 + 0.2 * walk), h * (0.98 - 0.26 * walk), 1.4 - 0.55 * walk);
    for (let i = 0; i < 3; i++) { const sx = w * (0.08 + i * 0.05); g.fillStyle = "#2f5134"; g.beginPath(); g.ellipse(sx + Math.sin(t * 1.3 + i) * 3, h * 0.66, 26, 40, 0, 0, 7); g.fill(); }
  }
  function lounge(g, w, h, t) {
    const flick = 0.5 + 0.25 * Math.sin(t * 7.1) + 0.2 * Math.sin(t * 2.3 + 1);
    const hue = (t * 12) % 360;
    g.fillStyle = `hsla(${hue},60%,60%,${0.16 * flick})`; g.fillRect(0, 0, w, h);                  // the TV's light on the room
    g.fillStyle = "#111"; g.fillRect(w * 0.08, h * 0.3, w * 0.26, h * 0.17);
    g.fillStyle = `hsla(${hue},55%,${45 + 15 * flick}%,0.9)`; g.fillRect(w * 0.09, h * 0.31, w * 0.24, h * 0.15);
    g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.roundRect(w * 0.5, h * 0.55, w * 0.4, h * 0.2, 14); g.fill();   // the sofa
    g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.roundRect(w * 0.52, h * 0.47, w * 0.36, h * 0.12, 12); g.fill();
    g.fillStyle = "rgba(255,200,120,.25)"; g.beginPath(); g.arc(w * 0.94, h * 0.38, 46, 0, 7); g.fill();           // the floor lamp
    const c = (t % 18) / 18;                                                                                      // the cat
    if (c < 0.45) { const x = w * (1.05 - 1.2 * (c / 0.45)); g.fillStyle = "rgba(15,15,18,.85)"; g.beginPath(); g.ellipse(x, h * 0.86, 22, 9, 0, 0, 7); g.fill(); g.beginPath(); g.arc(x - 20, h * 0.82, 7, 0, 7); g.fill(); }
  }
  function kitchen(g, w, h, t) {
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, h * 0.58, w, h * 0.1);                       // the counter
    for (let i = 0; i < 3; i++) { const x = w * (0.3 + i * 0.2); g.strokeStyle = "rgba(0,0,0,.4)"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h * 0.16); g.stroke();
      g.fillStyle = `rgba(255,220,160,${0.75 + 0.05 * Math.sin(t * 3 + i)})`; g.beginPath(); g.arc(x, h * 0.18, 9, 0, 7); g.fill();
      g.fillStyle = "rgba(255,220,160,.12)"; g.beginPath(); g.arc(x, h * 0.3, 60, 0, 7); g.fill(); }
    g.fillStyle = "#30363b"; g.fillRect(w * 0.2, h * 0.5, w * 0.1, h * 0.08);                      // the pot, and its steam
    for (let i = 0; i < 6; i++) { const p = ((t * 0.35 + i / 6) % 1); g.fillStyle = `rgba(255,255,255,${0.18 * (1 - p)})`; g.beginPath(); g.arc(w * 0.25 + Math.sin(p * 9 + i) * 8, h * (0.48 - 0.3 * p), 8 + 14 * p, 0, 7); g.fill(); }
    const loop = (t % 16) / 16;
    if (loop > 0.55 && loop < 0.9) person(g, w * (1.1 - 1.3 * ((loop - 0.55) / 0.35)), h * 0.95, 1.6, 0.7);
  }
  function garden(g, w, h, t) {
    for (let i = 0; i < 4; i++) { const x = ((t * (6 + i * 2) + i * 230) % (w + 200)) - 100; g.fillStyle = "rgba(255,255,255,.75)"; g.beginPath(); g.ellipse(x, h * (0.12 + i * 0.05), 60, 16, 0, 0, 7); g.fill(); }
    g.fillStyle = "#3f6b45"; g.fillRect(0, h * 0.62, w, h);
    for (let i = 0; i < 5; i++) { const x = w * (0.1 + i * 0.2), sway = Math.sin(t * 1.1 + i) * 6;
      g.fillStyle = "#4b3a2a"; g.fillRect(x - 4, h * 0.42, 8, h * 0.22);
      g.fillStyle = i % 2 ? "#2e5a35" : "#376b3e"; g.beginPath(); g.ellipse(x + sway, h * 0.38, 44, 54, 0, 0, 7); g.fill(); }
    for (let i = 0; i < 14; i++) { const p = ((t * 0.8 + i / 14) % 1); g.fillStyle = `rgba(200,230,255,${0.5 * (1 - p)})`; g.beginPath(); g.arc(w * 0.7 + Math.cos(i) * 90 * p, h * 0.8 - Math.sin(Math.PI * p) * 70, 2, 0, 7); g.fill(); }
  }

  // Real footage for the rooms that have it: a short loop filmed by a fixed camera. In the living room the footage
  // follows the house: the lamp in the shot is the Arc Lamp. Its light was measured from the same camera with the
  // lamp off and on (cams/living_room_lamp.png: how much of each pixel stays when the lamp is off, gamma-encoded),
  // so the frame is multiplied by that map, opened up as far as the lamp's brightness, tinted by its warmth.
  // The room's other lights lift the whole picture a little; with everything off it sinks into the dark.
  const FEEDS = {
    living_room: { src: "assets/cams/living_room.mp4", room: "living_room",
      lamp: { map: "assets/cams/living_room_lamp.png", light: "light.living_room_arc_lamp", kelvin: 2700 } },
    kitchen: { src: "assets/cams/kitchen.mp4", room: "kitchen" },
  };
  // a lamp's colour at a colour temperature, near enough (Tanner Helland's fit), 0..1 a channel
  const kelvinRgb = (k) => {
    const t = k / 100;
    const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332;
    const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
    return [r, g, b].map((v) => Math.max(0, Math.min(255, v)) / 255);
  };
  const lightLevel = (hass, id) => {
    const st = hass?.states[id];
    if (!st || st.state !== "on") return 0;
    const b = st.attributes.brightness;
    return b == null ? 1 : Math.max(0.02, Math.min(1, b / 255));
  };
  // the share of a room's light that is on, its lamps weighted by brightness (the lamp in the shot left out)
  const roomLight = (hass, area, skip) => {
    if (!hass) return 1;
    const ids = Object.values(hass.entities || {}).filter((e) => e.area_id === area && e.entity_id.startsWith("light.") && !e.hidden && e.entity_id !== skip).map((e) => e.entity_id);
    return ids.length ? ids.reduce((n, id) => n + lightLevel(hass, id), 0) / ids.length : 1;
  };
  const MAPS = {};
  function lampMap(url) {
    if (MAPS[url]) return MAPS[url];
    const m = (MAPS[url] = { ready: false });
    const img = new Image();
    img.onload = () => {
      const w = 480, h = 270, c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data, keep = new Float32Array(w * h * 3);
      for (let i = 0, j = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) keep[j++] = (px[i + k] / 255) ** 2.2;   // linear: the light that stays
      Object.assign(m, { ready: true, w, h, keep, canvas: c, g, data: g.createImageData(w, h), key: "" });
    };
    img.src = url;
    return m;
  }
  // the multiply layer for a level and a tint: the light that stays, plus the lamp's share of the rest
  function lampLayer(m, level, tint) {
    const key = `${level.toFixed(3)}|${tint.map((v) => v.toFixed(2)).join()}`;
    if (m.key === key) return m.canvas;
    const out = m.data.data, keep = m.keep;
    for (let i = 0, j = 0; i < out.length; i += 4) {
      for (let k = 0; k < 3; k++, j++) { const s = keep[j]; out[i + k] = 255 * Math.min(1, s + (1 - s) * level * tint[k]) ** (1 / 2.2); }
      out[i + 3] = 255;
    }
    m.g.putImageData(m.data, 0, 0);
    m.key = key;
    return m.canvas;
  }

  const c2 = (g) => g.canvas;   // the frame drawn so far, drawn again to lift it
  // H.264 where the browser has it, VP9 (the same footage, a .webm beside it) where it does not
  const pickSrc = (mp4) => (document.createElement("video").canPlayType('video/mp4; codecs="avc1.4D401F"') ? mp4 : mp4.replace(/\.mp4$/, ".webm"));
  customElements.define("ha-camera-stream", class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = "<style>:host{display:block;position:absolute;inset:0;overflow:hidden;background:#111}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>";
      this._c = this.shadowRoot.querySelector("canvas");
      this._t0 = performance.now() - Math.random() * 20000;
    }
    set stateObj(st) { this._st = st; }
    get stateObj() { return this._st; }
    connectedCallback() {
      this._io = new IntersectionObserver(([e]) => { this._seen = e.isIntersecting; if (this._seen) this._loop(); });
      this._io.observe(this);
    }
    disconnectedCallback() { this._io?.disconnect(); cancelAnimationFrame(this._raf); this._raf = 0; this._video?.pause(); }
    // the footage, cropped to fill like a camera view, then relit by the house; false until the first frame is in
    _footage(g, w, h, feed) {
      let v = this._video;
      if (!v) {
        v = this._video = Object.assign(document.createElement("video"), { src: pickSrc(feed.src), muted: true, loop: true, playsInline: true, autoplay: true, preload: "auto" });
        v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
        v.currentTime = Math.random() * 6;   // two cards on the same camera are not in lockstep
      }
      if (v.paused) v.play().catch(() => {});
      if (v.readyState < 2 || !v.videoWidth) return false;
      const vw = v.videoWidth, vh = v.videoHeight, s = Math.max(w / vw, h / vh);
      const sw = w / s, sh = h / s, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      g.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
      const hass = this.hass;
      // the lamp in the shot: its light, as bright and as warm as the lamp, eased like a real bulb
      if (feed.lamp) {
        const m = lampMap(feed.lamp.map);
        const want = lightLevel(hass, feed.lamp.light);
        this._lvl = this._lvl == null ? want : this._lvl + (want - this._lvl) * 0.22;
        if (Math.abs(want - this._lvl) < 0.004) this._lvl = want;
        if (m.ready) {
          const st = hass?.states[feed.lamp.light], k = st?.attributes.color_temp_kelvin || feed.lamp.kelvin;
          const own = kelvinRgb(feed.lamp.kelvin), at = kelvinRgb(k);
          // the same light, shifted in colour: as bright to the eye (a channel above full just stays full)
          let tint = at.map((x, i) => x / Math.max(0.05, own[i]));
          const luma = 0.3 * tint[0] + 0.59 * tint[1] + 0.11 * tint[2]; tint = tint.map((x) => x / luma);
          const f = m.w / vw;
          g.globalCompositeOperation = "multiply";
          g.drawImage(lampLayer(m, this._lvl, tint), sx * f, sy * f, sw * f, sh * f, 0, 0, w, h);
        }
      }
      // the rest of the room's light: a lift when it is bright, a sink into the dark when all is off
      const want = roomLight(hass, feed.room, feed.lamp?.light);
      this._amb = this._amb == null ? want : this._amb + (want - this._amb) * 0.15;
      if (this._amb > 0.02) { g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.22 * this._amb; g.drawImage(c2(g), 0, 0); }
      const dark = Math.round(255 * (0.62 + 0.38 * Math.min(1, this._amb * 2)));
      g.globalCompositeOperation = "multiply"; g.globalAlpha = 1; g.fillStyle = `rgb(${dark},${dark},${dark})`; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      return true;
    }
    _loop() {
      if (this._raf || !this.isConnected) return;
      const tick = (now) => {
        this._raf = 0;
        if (!this._seen || !this.isConnected) return;
        if (!this._last || now - this._last > 1000 / 24) { this._last = now; this._draw((now - this._t0) / 1000); }   // a camera's 24 frames a second
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }
    _draw(t) {
      const c = this._c, r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext("2d"), key = (this._st?.entity_id || "").split(".")[1] || "front_door";
      const feed = FEEDS[key];
      if (!feed || !this._footage(g, w, h, feed)) {
        const sc = SCENES[key] || SCENES.front_door;
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, sc.sky[0]); grad.addColorStop(0.55, sc.wall); grad.addColorStop(1, sc.floor);
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.save(); g.scale(w / 640, h / 360); sc.draw(g, 640, 360, t); g.restore();
      }
      // the look of a real feed: a little grain, a soft vignette, the time burnt in
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, dpr, dpr); }
      const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.45)");
      g.fillStyle = v; g.fillRect(0, 0, w, h);
      const d = new Date(), pad = (n) => String(n).padStart(2, "0");
      g.font = `${12 * dpr}px ui-monospace, Menlo, monospace`; g.fillStyle = "rgba(255,255,255,.78)"; g.textAlign = "right";
      g.fillText(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, w - 14 * dpr, 24 * dpr);   // top right: the card's own buttons sit at the bottom
    }
  });

  window.SavvyDemo = Object.assign(window.SavvyDemo || {}, { iconFor });
})();
