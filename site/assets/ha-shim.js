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
    disconnectedCallback() { this._io?.disconnect(); cancelAnimationFrame(this._raf); this._raf = 0; }
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
      const sc = SCENES[key] || SCENES.front_door;
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, sc.sky[0]); grad.addColorStop(0.55, sc.wall); grad.addColorStop(1, sc.floor);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.save(); g.scale(w / 640, h / 360); sc.draw(g, 640, 360, t); g.restore();
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
