// ---------------------------------------------------------------------------------------
// core/icons: the icon of an entity, decided here, never by Home Assistant's own state-icon element.
// That element falls back to a bookmark whenever it can't resolve an icon (translations that
// load late, custom integrations, domains it doesn't know), so every Savvy card draws its
// entity icons itself, with a plain <ha-icon>:
//   1. the entity's own `icon` attribute      2. its registry icon
//   3. our table by domain, device class and state      4. a neutral question mark
// <savvy-state-icon> is the drop-in for it: set .hass and .stateObj and it draws the icon.
// ---------------------------------------------------------------------------------------

const NEUTRAL_ICON = "mdi:help-circle-outline";

const BINARY_ICONS = {
  battery: ["mdi:battery-alert", "mdi:battery"], battery_charging: ["mdi:battery-charging", "mdi:battery"],
  carbon_monoxide: ["mdi:smoke-detector-alert", "mdi:smoke-detector"], cold: ["mdi:snowflake", "mdi:thermometer"],
  connectivity: ["mdi:check-network-outline", "mdi:close-network-outline"], door: ["mdi:door-open", "mdi:door-closed"],
  garage_door: ["mdi:garage-open", "mdi:garage"], gas: ["mdi:alert-circle", "mdi:check-circle"],
  heat: ["mdi:fire", "mdi:thermometer"], light: ["mdi:brightness-7", "mdi:brightness-5"],
  lock: ["mdi:lock-open", "mdi:lock"], moisture: ["mdi:water-alert", "mdi:water-off"],
  motion: ["mdi:motion-sensor", "mdi:motion-sensor-off"], moving: ["mdi:arrow-right", "mdi:octagon"],
  occupancy: ["mdi:home", "mdi:home-outline"], opening: ["mdi:square-outline", "mdi:square"],
  plug: ["mdi:power-plug", "mdi:power-plug-off"], power: ["mdi:power-plug", "mdi:power-plug-off"],
  presence: ["mdi:home", "mdi:home-outline"], problem: ["mdi:alert-circle", "mdi:check-circle"],
  running: ["mdi:play", "mdi:stop"], safety: ["mdi:alert-circle", "mdi:check-circle"],
  smoke: ["mdi:smoke-detector-variant-alert", "mdi:smoke-detector-variant"], sound: ["mdi:music-note", "mdi:music-note-off"],
  tamper: ["mdi:alert-circle", "mdi:check-circle"], update: ["mdi:package-up", "mdi:package"],
  vibration: ["mdi:vibrate", "mdi:crop-portrait"], window: ["mdi:window-open", "mdi:window-closed"],
};

const SENSOR_ICONS = {
  apparent_power: "mdi:flash", aqi: "mdi:air-filter", atmospheric_pressure: "mdi:gauge", battery: "mdi:battery",
  carbon_dioxide: "mdi:molecule-co2", carbon_monoxide: "mdi:molecule-co", current: "mdi:current-ac", data_rate: "mdi:transmission-tower",
  data_size: "mdi:database", date: "mdi:calendar", distance: "mdi:ruler", duration: "mdi:timer-outline", energy: "mdi:lightning-bolt",
  enum: "mdi:format-list-bulleted", frequency: "mdi:sine-wave", gas: "mdi:gas-burner", humidity: "mdi:water-percent",
  illuminance: "mdi:brightness-5", irradiance: "mdi:sun-wireless", moisture: "mdi:water-percent", monetary: "mdi:cash",
  nitrogen_dioxide: "mdi:molecule", ozone: "mdi:molecule", ph: "mdi:ph", pm1: "mdi:air-filter", pm10: "mdi:air-filter",
  pm25: "mdi:air-filter", power: "mdi:flash", power_factor: "mdi:angle-acute", precipitation: "mdi:weather-rainy",
  precipitation_intensity: "mdi:weather-pouring", pressure: "mdi:gauge", reactive_power: "mdi:flash", signal_strength: "mdi:wifi",
  sound_pressure: "mdi:ear-hearing", speed: "mdi:speedometer", sulphur_dioxide: "mdi:molecule", temperature: "mdi:thermometer",
  timestamp: "mdi:clock-outline", volatile_organic_compounds: "mdi:molecule", voltage: "mdi:sine-wave", volume: "mdi:car-coolant-level",
  water: "mdi:water", weight: "mdi:weight", wind_speed: "mdi:weather-windy",
};

const WEATHER_ICONS = {
  "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", exceptional: "mdi:alert-circle-outline", fog: "mdi:weather-fog",
  hail: "mdi:weather-hail", lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy", pouring: "mdi:weather-pouring", rainy: "mdi:weather-rainy", snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy", sunny: "mdi:weather-sunny", windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant",
};

// a battery level, in the ten steps MDI has
const batteryLevelIcon = (v) => {
  if (!Number.isFinite(v)) return "mdi:battery";
  if (v >= 95) return "mdi:battery";
  if (v < 5) return "mdi:battery-outline";
  return `mdi:battery-${Math.min(90, Math.max(10, Math.round(v / 10) * 10))}`;
};

// the table: what an entity looks like when nothing more specific names its icon
function fallbackIcon(domain, dc, state, st) {
  const on = state === "on", off = state === "off" || state === "unavailable";
  const open = state === "open" || state === "opening" || state === "closing";
  switch (domain) {
    case "binary_sensor": { const pair = BINARY_ICONS[dc]; return pair ? pair[on ? 0 : 1] : on ? "mdi:checkbox-marked-circle" : "mdi:radiobox-blank"; }
    case "sensor": return dc === "battery" ? batteryLevelIcon(parseFloat(state)) : SENSOR_ICONS[dc] || "mdi:eye";
    case "light": return st?.attributes?.entity_id ? (on ? "mdi:lightbulb-group" : "mdi:lightbulb-group-outline") : on ? "mdi:lightbulb" : "mdi:lightbulb-outline";
    case "switch": return dc === "outlet" ? (on ? "mdi:power-plug" : "mdi:power-plug-off") : on ? "mdi:toggle-switch-variant" : "mdi:toggle-switch-variant-off";
    case "input_boolean": return on ? "mdi:toggle-switch-variant" : "mdi:toggle-switch-variant-off";
    case "fan": return off ? "mdi:fan-off" : "mdi:fan";
    case "lock":
      if (state === "locked") return "mdi:lock";
      if (state === "jammed") return "mdi:lock-alert";
      if (state === "locking" || state === "unlocking") return "mdi:lock-clock";
      if (state === "open" || state === "opening") return "mdi:door-open";
      return "mdi:lock-open-variant";
    case "cover": {
      const o = open && state !== "closing";
      if (dc === "garage") return o ? "mdi:garage-open" : "mdi:garage";
      if (dc === "door") return o ? "mdi:door-open" : "mdi:door-closed";
      if (dc === "gate") return o ? "mdi:gate-open" : "mdi:gate";
      if (dc === "window") return o ? "mdi:window-open" : "mdi:window-closed";
      if (dc === "curtain") return o ? "mdi:curtains" : "mdi:curtains-closed";
      if (["blind", "shade", "awning"].includes(dc)) return o ? "mdi:blinds-open" : "mdi:blinds";
      if (dc === "damper") return o ? "mdi:circle" : "mdi:circle-slice-8";
      return o ? "mdi:window-shutter-open" : "mdi:window-shutter";
    }
    case "media_player":
      if (dc === "tv") return off ? "mdi:television-off" : "mdi:television";
      if (dc === "speaker") return off ? "mdi:speaker-off" : "mdi:speaker";
      if (dc === "receiver") return off ? "mdi:audio-video-off" : "mdi:audio-video";
      return off ? "mdi:cast-off" : state === "playing" || state === "paused" ? "mdi:cast-connected" : "mdi:cast";
    case "climate":
      return { heat: "mdi:fire", cool: "mdi:snowflake", fan_only: "mdi:fan", dry: "mdi:water-percent", heat_cool: "mdi:sun-snowflake-variant", auto: "mdi:thermostat-auto" }[state] || "mdi:thermostat";
    case "vacuum": return state === "error" ? "mdi:robot-vacuum-alert" : "mdi:robot-vacuum";
    case "lawn_mower": return "mdi:robot-mower";
    case "alarm_control_panel":
      return { disarmed: "mdi:shield-off", armed_home: "mdi:shield-home", armed_away: "mdi:shield-lock", armed_night: "mdi:shield-moon",
        armed_vacation: "mdi:shield-airplane", armed_custom_bypass: "mdi:security", triggered: "mdi:bell-ring", arming: "mdi:shield-sync", pending: "mdi:shield-sync", disarming: "mdi:shield-sync" }[state] || "mdi:shield";
    case "button": case "input_button": return "mdi:gesture-tap-button";
    case "script": return "mdi:script-text-outline";
    case "scene": return "mdi:palette";
    case "automation": return on ? "mdi:robot" : "mdi:robot-off";
    case "person": return state === "home" ? "mdi:account" : "mdi:account-arrow-right";
    case "device_tracker": return state === "home" ? "mdi:account" : "mdi:account-arrow-right";
    case "camera": return "mdi:video";
    case "humidifier": return off ? "mdi:air-humidifier-off" : "mdi:air-humidifier";
    case "water_heater": return off ? "mdi:water-boiler-off" : "mdi:water-boiler";
    case "valve": return state === "closed" || state === "closing" ? "mdi:valve-closed" : "mdi:valve-open";
    case "siren": return on ? "mdi:bullhorn" : "mdi:bullhorn-outline";
    case "remote": return "mdi:remote";
    case "update": return on ? "mdi:package-up" : "mdi:package";
    case "number": case "input_number": return "mdi:ray-vertex";
    case "select": case "input_select": return "mdi:format-list-bulleted";
    case "text": case "input_text": return "mdi:form-textbox";
    case "datetime": case "input_datetime": return dc === "date" ? "mdi:calendar" : "mdi:calendar-clock";
    case "date": case "calendar": case "schedule": return "mdi:calendar";
    case "time": return "mdi:clock-outline";
    case "timer": return "mdi:timer-outline";
    case "counter": return "mdi:counter";
    case "event": return "mdi:gesture-double-tap";
    case "image": return "mdi:image";
    case "todo": return "mdi:clipboard-list";
    case "weather": return WEATHER_ICONS[state] || "mdi:weather-partly-cloudy";
    case "sun": return state === "below_horizon" ? "mdi:weather-night" : "mdi:white-balance-sunny";
    case "zone": return "mdi:map-marker-radius";
    case "geo_location": return "mdi:map-marker";
    case "proximity": return "mdi:map-marker-distance";
    case "group": return "mdi:google-circles-communities";
    case "air_quality": return "mdi:air-filter";
    case "tts": return "mdi:account-voice";
    case "stt": return "mdi:microphone-message";
    case "conversation": return "mdi:forum-outline";
    case "assist_satellite": return "mdi:comment-processing";
    case "wake_word": return "mdi:chat-sleep";
    case "notify": return "mdi:message-text";
    case "persistent_notification": return "mdi:bell";
    case "alert": return "mdi:alert";
    case "plant": return "mdi:flower";
    default: return NEUTRAL_ICON;
  }
}

// The icon for an entity, by id and state.
function entityIcon(hass, id, st) {
  st = st || hass?.states?.[id];
  const own = st?.attributes?.icon;
  if (own) return own;
  const reg = hass?.entities?.[id]?.icon;
  if (reg) return reg;
  return fallbackIcon(domainOf(id), st?.attributes?.device_class, st?.state, st);
}

// Set .hass and .stateObj, and it draws a plain <ha-icon> for the entity.
class SavvyStateIcon extends HTMLElement {
  set hass(h) { this._h = h; this._paint(); }
  set stateObj(st) { this._st = st; this._paint(); }
  get stateObj() { return this._st; }
  _paint() {
    const st = this._st;
    if (!st) return;
    if (!this._ic) { this._ic = document.createElement("ha-icon"); this.appendChild(this._ic); }
    const icon = entityIcon(this._h, st.entity_id, st);
    if (this._ic.getAttribute("icon") !== icon) this._ic.setAttribute("icon", icon);
  }
}
if (!customElements.get("savvy-state-icon")) customElements.define("savvy-state-icon", SavvyStateIcon);
