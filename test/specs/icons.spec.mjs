// Entity icons are decided by Savvy (entity attribute, registry, our table, a question mark), never by
// Home Assistant's state-icon element, which falls back to a bookmark when it can't resolve one.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });

  // 1) the resolver: every branch returns a real icon, never a bookmark
  const r = await page.evaluate(() => {
    const { entityIcon, fallbackIcon, NEUTRAL_ICON } = window.__savvy;
    const domains = ["alarm_control_panel", "alert", "automation", "binary_sensor", "button", "calendar", "camera", "climate", "conversation", "counter", "cover", "date", "datetime", "device_tracker", "event", "fan", "geo_location",
      "group", "humidifier", "image", "input_boolean", "input_button", "input_datetime", "input_number", "input_select", "input_text", "lawn_mower", "light", "lock", "media_player", "notify", "number", "person", "plant", "proximity",
      "remote", "scene", "schedule", "script", "select", "sensor", "siren", "stt", "sun", "switch", "text", "time", "timer", "todo", "tts", "update", "vacuum", "valve", "water_heater", "weather", "zone"];
    const states = ["on", "off", "open", "closed", "opening", "closing", "locked", "unlocked", "jammed", "playing", "paused", "idle", "home", "not_home", "heat", "cool", "disarmed", "armed_home", "triggered", "sunny", "rainy", "unavailable", "unknown", "42"];
    const classes = [undefined, "door", "window", "garage_door", "motion", "occupancy", "moisture", "smoke", "battery", "connectivity", "temperature", "humidity", "illuminance", "power", "energy", "voltage", "signal_strength", "timestamp", "tv", "speaker", "receiver", "outlet", "switch", "garage", "gate", "curtain", "blind", "damper", "lock", "weird_class"];
    const bad = [];
    let n = 0;
    for (const d of domains) for (const s of states) for (const dc of classes) {
      const icon = fallbackIcon(d, dc, s, { attributes: {} });
      n++;
      if (typeof icon !== "string" || !/^mdi:[a-z0-9-]+$/.test(icon) || /bookmark/.test(icon)) bad.push(`${d}/${dc}/${s}=${icon}`);
    }
    const own = entityIcon({ states: {}, entities: { "light.a": { icon: "mdi:from-registry" } } }, "light.a", { entity_id: "light.a", state: "on", attributes: { icon: "mdi:from-state" } });
    const reg = entityIcon({ states: {}, entities: { "light.a": { icon: "mdi:from-registry" } } }, "light.a", { entity_id: "light.a", state: "on", attributes: {} });
    const tab = entityIcon({ states: {}, entities: {} }, "light.a", { entity_id: "light.a", state: "on", attributes: {} });
    const unknown = entityIcon({ states: {}, entities: {} }, "mystery.thing", { entity_id: "mystery.thing", state: "on", attributes: {} });
    const missing = entityIcon({ states: {}, entities: {} }, "light.nowhere", undefined);
    const lights = [["light", "on"], ["light", "off"]].map(([d, s]) => fallbackIcon(d, undefined, s, { attributes: {} }));
    const lock = ["locked", "unlocked", "jammed", "open"].map((s) => fallbackIcon("lock", undefined, s, {}));
    const door = [fallbackIcon("binary_sensor", "door", "on", {}), fallbackIcon("binary_sensor", "door", "off", {})];
    const garage = [fallbackIcon("cover", "garage", "open", {}), fallbackIcon("cover", "garage", "closed", {})];
    const batteries = [100, 80, 42, 12, 3].map((v) => fallbackIcon("sensor", "battery", String(v), {}));
    return { n, bad: bad.slice(0, 10), badCount: bad.length, own, reg, tab, unknown, missing, neutral: NEUTRAL_ICON, lights, lock, door, garage, batteries };
  });
  check(`the table gives a real icon for ${r.n} domain/class/state combinations, never a bookmark`, r.badCount === 0, JSON.stringify(r.bad));
  check("the entity's own icon wins, then the registry's, then the table", r.own === "mdi:from-state" && r.reg === "mdi:from-registry" && r.tab === "mdi:lightbulb", JSON.stringify([r.own, r.reg, r.tab]));
  check("an unknown domain, or an entity with no state, gets the question mark", r.unknown === r.neutral && r.missing === "mdi:lightbulb-outline" && r.neutral === "mdi:help-circle-outline", JSON.stringify([r.unknown, r.missing]));
  check("the table follows state and class", JSON.stringify(r.lights) === '["mdi:lightbulb","mdi:lightbulb-outline"]' && JSON.stringify(r.lock) === '["mdi:lock","mdi:lock-open-variant","mdi:lock-alert","mdi:door-open"]'
    && JSON.stringify(r.door) === '["mdi:door-open","mdi:door-closed"]' && JSON.stringify(r.garage) === '["mdi:garage-open","mdi:garage"]'
    && JSON.stringify(r.batteries) === '["mdi:battery","mdi:battery-80","mdi:battery-40","mdi:battery-10","mdi:battery-outline"]', JSON.stringify(r));

  // 2) the bundle itself: no Home Assistant state-icon element, no bookmark anywhere
  const src = await page.evaluate(async () => (await fetch("../dist/savvy-cards.js")).text());
  check("the bundle never creates ha-state-icon and never names the bookmark icon", !/ha-state-icon/.test(src) && !/mdi:bookmark/.test(src), `${(src.match(/ha-state-icon|mdi:bookmark/g) || []).length} hits`);

  // 3) the popup rows: entities with no icon of their own show the table icon
  const rows = await page.evaluate(async () => {
    const entries = [
      ["light.ic_lamp", "on", {}, "mdi:lightbulb"], ["light.ic_lamp_off", "off", {}, "mdi:lightbulb-outline"], ["lock.ic_front", "locked", {}, "mdi:lock"],
      ["cover.ic_garage", "open", { device_class: "garage" }, "mdi:garage-open"], ["binary_sensor.ic_door", "on", { device_class: "door" }, "mdi:door-open"],
      ["sensor.ic_temp", "21", { device_class: "temperature" }, "mdi:thermometer"], ["input_boolean.ic_flag", "on", {}, "mdi:toggle-switch-variant"],
      ["switch.ic_plug", "off", { device_class: "outlet" }, "mdi:power-plug-off"], ["scene.ic_movie", "2026-01-01T00:00:00+00:00", {}, "mdi:palette"],
      ["button.ic_press", "unknown", {}, "mdi:gesture-tap-button"], ["mystery.ic_thing", "on", {}, "mdi:help-circle-outline"],
      ["light.ic_own", "on", { icon: "mdi:sony-playstation" }, "mdi:sony-playstation"], ["media_player.ic_ps5", "playing", { device_class: "receiver", supported_features: 0 }, "mdi:audio-video"],
    ];
    const add = (id, state, attributes = {}) => {
      window.house.states[id] = { entity_id: id, state, attributes: { friendly_name: id, ...attributes }, last_changed: new Date(Date.now() - 600000).toISOString(), last_updated: new Date().toISOString() };
      window.house.entities[id] = { entity_id: id, area_id: "living_room", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
    };
    for (const [id, s, a] of entries) add(id, s, a);
    add("light.ic_reg", "on");
    window.house.entities["light.ic_reg"].icon = "mdi:from-registry";
    window.hass = { ...window.hass, states: { ...window.house.states }, entities: { ...window.house.entities } };
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = "<button id=o>open</button>";
    document.body.appendChild(host);
    window.list = new window.__savvy.EntityListSheet(host, { title: "Icons" });
    window.list.show(window.hass, [...entries.map((e) => e[0]), "light.ic_reg"], host.shadowRoot.getElementById("o"));
    await new Promise((res) => setTimeout(res, 300));
    const root = window.__savvy.portalRoot();
    const got = {};
    for (const [id] of [...entries, ["light.ic_reg"]]) got[id] = root.querySelector(`.sv-row[data-id="${id}"] .sv-ic savvy-state-icon ha-icon`)?.getAttribute("icon") || root.querySelector(`.sv-row[data-id="${id}"] .sv-ic ha-icon`)?.getAttribute("icon") || null;
    window.list.sheet.close?.();
    return { got, want: Object.fromEntries([...entries.map((e) => [e[0], e[3]]), ["light.ic_reg", "mdi:from-registry"]]), stateIcons: root.querySelectorAll("ha-state-icon").length };
  });
  const wrong = Object.keys(rows.want).filter((id) => rows.got[id] !== rows.want[id]).map((id) => `${id}: ${rows.got[id]} != ${rows.want[id]}`);
  check("every popup row draws its own icon: attribute, registry or table, never a bookmark", wrong.length === 0 && rows.stateIcons === 0, wrong.join(" | "));

  // 4) every other card that shows an entity icon goes through the same resolver
  const cards = await page.evaluate(async () => {
    window.cards.length = 0;
    document.getElementById("stage").replaceChildren();
    const mk = (t, c, w = 420) => window.mount(t, c, w);
    mk("savvy-lights-card", { area: "living_room" });
    mk("savvy-scene-card", { area: "living_room" });
    mk("savvy-entity-card", { entity: "person.alex", chips: [{ entity: "switch.living_room_lamp" }, { entity: "sensor.alex_phone_battery" }] });
    mk("savvy-graph-card", { entities: ["binary_sensor.living_room_door", "sensor.living_room_temperature", "sensor.watchman_last_parse"] });
    mk("savvy-section-title-card", { area: "living_room" });
    mk("savvy-room-header-card", { area: "living_room" });
    mk("savvy-room-tile", { area: "living_room" });
    mk("savvy-home-header-card", {});
    mk("savvy-media-card", { area: "living_room", chips: [{ entity: "switch.living_room_lamp" }] });
    mk("savvy-climate-card", { area: "living_room", weather: "weather.home" });
    await new Promise((res) => setTimeout(res, 700));
    let n = 0;
    const bad = [];
    for (const c of window.cards) {
      for (const el of c.shadowRoot.querySelectorAll("savvy-state-icon")) {
        n++;
        const icon = el.querySelector("ha-icon")?.getAttribute("icon");
        if (!icon || /bookmark/.test(icon)) bad.push(`${c.tagName.toLowerCase()}:${el.stateObj?.entity_id}=${icon}`);
      }
      if (c.shadowRoot.querySelector("ha-state-icon")) bad.push(`${c.tagName.toLowerCase()} has ha-state-icon`);
    }
    return { n, bad };
  });
  check(`cards: ${cards.n} entity icons, each a real icon from the resolver`, cards.n >= 10 && cards.bad.length === 0, JSON.stringify(cards));
  check("no console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
