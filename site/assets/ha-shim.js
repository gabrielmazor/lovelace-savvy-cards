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

  window.SavvyDemo = Object.assign(window.SavvyDemo || {}, { iconFor });
})();
