/**
 * Reusable Home Assistant element stubs for testing dashboard cards headlessly.
 *
 * These are NOT the real ha-card / ha-icon / ha-state-icon: they are just enough
 * to let a custom card render and be interacted with in a plain browser (or
 * Playwright) without Home Assistant's frontend installed.
 *
 * Usage in a test HTML page:
 *   <script src="mdi-icons.js"></script>   (see below, generated per-project)
 *   <script src="ha-stubs.js"></script>
 *   <script src="../cards/lights-card.js"></script>
 *
 * window.ICONS must be populated before these stubs render anything (see
 * "Generating an icon map" below). An icon that isn't in the map falls back
 * silently to whatever DEFAULT_ICON is set to below.
 */
(() => {
  const DEFAULT_ICON = "mdi:circle-outline";

  // Real HA always provides these as globals from its own theme CSS; this stub never did,
  // so any test that checks a computed `color`/`background` (not just a card's own custom
  // property) was silently unreliable - it was reading inherited-default black, not what
  // the card's CSS actually resolves to under a real theme. Dark is the default to match
  // every test page's own `body { background: #1c1c1e }` / `body.light { ... }` convention;
  // add `light` to <body> the same way those pages already do to get the light variant.
  const THEME = document.createElement("style");
  THEME.textContent = `
    :root, body {
      --primary-text-color: #e3e3e6;
      --secondary-text-color: #9b9ba0;
      --card-background-color: #1e1e20;
      --divider-color: rgba(227, 227, 230, 0.12);
      --primary-color: #58a6ff;
      --disabled-text-color: #6b6b70;
    }
    body.light {
      --primary-text-color: #1c1c1e;
      --secondary-text-color: #6b6b70;
      --card-background-color: #ffffff;
      --divider-color: rgba(0, 0, 0, 0.12);
      --primary-color: #0969da;
      --disabled-text-color: #b0b0b5;
    }
  `;
  document.head.appendChild(THEME);

  const svg = (path) =>
    `<svg viewBox="0 0 24 24" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);display:block">` +
    `<path fill="currentColor" d="${path}"/></svg>`;

  // A ha-card in real HA has a bunch of theme CSS; the one thing that actually
  // matters for testing is that it ships `transition: all` on :host, which
  // every card's stylesheet must explicitly override. Keep that here so a
  // regression shows up in tests the same way it would in real HA.
  customElements.define(
    "ha-card",
    class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML =
          "<style>:host{display:block;transition:all .3s ease-out}</style><slot></slot>";
      }
    }
  );

  customElements.define(
    "ha-icon",
    class extends HTMLElement {
      static get observedAttributes() {
        return ["icon"];
      }
      attributeChangedCallback() {
        const icon = this.getAttribute("icon");
        this.innerHTML = svg((window.ICONS && window.ICONS[icon]) || (window.ICONS && window.ICONS[DEFAULT_ICON]) || "");
        if (!window.ICONS?.[icon]) {
          console.warn(`[ha-stubs] no icon mapped for "${icon}": add it to your icon map`);
        }
      }
    }
  );

  // ha-state-icon picks an icon from the entity's domain/device_class. This
  // stub covers the common cases used across this repo's cards; extend the
  // `guess()` function per-project as new domains show up rather than
  // hand-wiring icons in every test page.
  customElements.define(
    "ha-state-icon",
    class extends HTMLElement {
      set stateObj(st) {
        this._st = st;
        this.innerHTML = svg((window.ICONS && window.ICONS[guess(st)]) || (window.ICONS && window.ICONS[DEFAULT_ICON]) || "");
      }
      get stateObj() {
        return this._st;
      }
    }
  );

  function guess(st) {
    if (!st) return DEFAULT_ICON;
    const [domain] = st.entity_id.split(".");
    const dc = st.attributes.device_class;
    if (domain === "binary_sensor") {
      if (["motion", "occupancy", "presence"].includes(dc)) return st.state === "on" ? "mdi:motion-sensor" : "mdi:motion-sensor-off";
      if (dc === "door") return st.state === "on" ? "mdi:door-open" : "mdi:door-closed";
      if (dc === "window") return "mdi:window-shutter-open";
      if (dc === "moisture") return "mdi:water-alert";
      if (["smoke", "gas", "carbon_monoxide"].includes(dc)) return "mdi:smoke-detector-alert";
      if (dc === "connectivity") return st.state === "on" ? "mdi:check-network-outline" : "mdi:close-network-outline";
      if (dc === "battery") return "mdi:battery-alert";
      return st.state === "on" ? "mdi:checkbox-marked-circle" : "mdi:radiobox-blank";
    }
    if (domain === "media_player") return "mdi:television";
    if (domain === "lock") return "mdi:lock-open-variant";
    if (domain === "fan") return "mdi:fan";
    if (domain === "cover") return "mdi:window-shutter-open";
    if (domain === "climate") return "mdi:air-conditioner";
    if (domain === "weather") {
      if (st.state === "sunny") return "mdi:weather-sunny";
      if (st.state === "clear-night") return "mdi:weather-night";
      return "mdi:weather-partly-cloudy";
    }
    if (domain === "light") return st.state === "on" ? "mdi:lightbulb" : "mdi:lightbulb-outline";
    if (domain === "sensor") {
      if (dc === "temperature") return "mdi:thermometer";
      if (dc === "humidity") return "mdi:water-percent";
      if (dc === "battery") return "mdi:battery";
      if (dc === "illuminance") return "mdi:brightness-5";
      if (dc === "power") return "mdi:flash";
      if (dc === "timestamp") return "mdi:clock-outline";
      return "mdi:eye";
    }
    if (domain === "button" || domain === "input_button") return "mdi:gesture-tap-button";
    if (domain === "switch" || domain === "input_boolean") return st.state === "on" ? "mdi:toggle-switch" : "mdi:toggle-switch-off";
    if (domain === "person") return "mdi:account";
    if (domain === "script") return "mdi:script-text";
    if (domain === "scene") return "mdi:palette";
    if (domain === "timer") return "mdi:timer-outline";
    if (domain === "vacuum") return "mdi:robot-vacuum";
    if (domain === "camera") return "mdi:cctv";
    if (domain === "alarm_control_panel") return "mdi:shield-home";
    if (domain === "select" || domain === "input_select") return "mdi:format-list-bulleted";
    return DEFAULT_ICON;
  }
})();

/**
 * A minimal `hass` factory. Extend inline per test page rather than growing
 * this file into a second copy of Home Assistant: this is deliberately just
 * enough to exercise callService / states / entities / themes / locale /
 * formatEntityState, which is what every card in this repo actually reads.
 *
 *   const hass = makeHass({ states, entities, dark: false, log });
 *   card.hass = hass;
 *   // log is an array; every callService call pushes a readable string to it
 *
 * `areas` is optional: a map of area_id -> { name, icon } matching HA's own area
 * registry (Settings > Areas), for cards that read hass.areas for a real display
 * name/icon instead of guessing one from the area id's slug.
 */
function makeHass({ states, entities = {}, devices = {}, areas = {}, dark = false, log = [] } = {}) {
  return {
    states: { ...states },
    entities,
    devices,
    areas,
    themes: { darkMode: dark },
    locale: { language: "en" },
    config: { unit_system: { temperature: "°C" } },
    formatEntityState: (stateObj, state) =>
      String(state ?? stateObj.state)
        .replace(/_/g, " ")
        .replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
    callService: (domain, service, data, target) => {
      const entity = target?.entity_id;
      const who = Array.isArray(entity) ? `${entity.length} entities` : entity ?? "-";
      log.push(`${domain}.${service} ${JSON.stringify(data || {})} ${who}`);
    },
    // Only implement callWS/callApi if a test actually needs history (climate-card).
    // Throwing by default makes a card's REST fallback path exercise itself in tests.
    callWS: async () => {
      throw new Error("callWS not implemented in this stub");
    },
    callApi: async () => {
      throw new Error("callApi not implemented in this stub");
    },
  };
}

if (typeof window !== "undefined") window.makeHass = makeHass;

// ---- editor stubs: just enough of ha-form / ha-selector to test Savvy's editors ----
// They record what they were given and render one labelled row per schema field, so a
// test can check the schema, and fire value-changed the way the real ones do.
if (typeof window !== "undefined" && !customElements.get("ha-form")) {
  const flatten = (schema) => schema.flatMap((s) => (s.schema ? flatten(s.schema) : [s]));
  customElements.define("ha-form", class extends HTMLElement {
    set schema(v) { this._schema = v; this._render(); }
    get schema() { return this._schema; }
    set data(v) { this._data = v; this._render(); }
    get data() { return this._data; }
    _render() {
      if (!this._schema) return;
      this.innerHTML = "";
      for (const f of flatten(this._schema)) {
        if (!f.name) continue;
        const row = document.createElement("div");
        row.className = "stub-field";
        row.dataset.name = f.name;
        row.dataset.selector = Object.keys(f.selector || {})[0] || "";
        row.textContent = `${this.computeLabel ? this.computeLabel(f) : f.name}: ${JSON.stringify(this._data?.[f.name] ?? null)}`;
        this.appendChild(row);
      }
    }
    // tests call this to simulate a user edit
    set(name, value) {
      this.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { ...this._data, [name]: value } }, bubbles: true, composed: true }));
    }
  });
  customElements.define("ha-selector", class extends HTMLElement {
    pick(value) { this.dispatchEvent(new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true })); }
  });
}
