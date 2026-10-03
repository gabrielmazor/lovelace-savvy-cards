// The global `ignore.entities` of the Savvy settings reaches every card that discovers by itself: room header,
// section title, room tile, room activity, lock, lights. Ignored sensors never show, never join a merged
// item, never count in a slot; a card that names an entity still shows it, and its own `exclude: false` opts out.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.house.areas.den = { area_id: "den", name: "Den" };
  const patch = {};
  const add = (id, state, attrs, mins = 5) => {
    window.house.entities[id] = { entity_id: id, area_id: "den", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
    patch[id] = { entity_id: id, state, attributes: attrs, last_changed: ago(mins), last_updated: ago(mins) };
  };
  add("binary_sensor.den_p1", "on", { friendly_name: "Den Radar Occupancy", device_class: "occupancy" }, 30);
  add("binary_sensor.den_p2", "on", { friendly_name: "Den Camera Motion", device_class: "motion" }, 10);
  add("binary_sensor.den_p3", "off", { friendly_name: "Den Desk Presence", device_class: "presence" }, 3);
  add("binary_sensor.den_d1", "on", { friendly_name: "Den Patio Door", device_class: "door" });
  add("sensor.den_t1", "31", { friendly_name: "Den Hot Temperature", device_class: "temperature", unit_of_measurement: "°C" });
  add("sensor.den_t2", "21", { friendly_name: "Den Temperature", device_class: "temperature", unit_of_measurement: "°C" });
  add("lock.den_a", "locked", { friendly_name: "Den Lock A", supported_features: 1 });
  add("lock.den_b", "locked", { friendly_name: "Den Lock B", supported_features: 1 });
  window.setStates(patch);
};
const IGN = ["binary_sensor.den_p1", "binary_sensor.den_d1", "sensor.den_t1", "lock.den_b"];

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) {
    const tag = `[${theme}]`;
    const { page, errors } = await openPage(browser, base, { theme, width: 460 });
    await page.evaluate(SETUP);
    const r = await page.evaluate(async (IGN) => {
      const S = window.__savvy;
      window.mount("savvy-settings-card", { ignore: { entities: IGN }, aggregate: true }, 460);
      const from = window.cards.length;
      window.mount("savvy-room-header-card", { area: "den" }, 460);
      window.mount("savvy-section-title-card", { area: "den" }, 460);
      window.mount("savvy-room-tile", { area: "den" }, 260);
      window.mount("savvy-room-activity-card", { area: "den" }, 460);
      window.mount("savvy-lock-card", { area: "den" }, 460);
      window.mount("savvy-room-header-card", { area: "den", entities: ["binary_sensor.den_p1"] }, 460);   // a pin still shows
      window.mount("savvy-room-header-card", { area: "den", exclude: false }, 460);                       // opts out
      window.mount("savvy-lock-card", { entities: ["lock.den_b"] }, 460);                                // a named lock still shows
      await new Promise((res) => setTimeout(res, 900));
      const C = (i) => window.cards[from + i];
      const ids = (i) => (C(i)._config.exclude || []).map((e) => e.entity || e);
      const badgeIds = (i, cfg) => S.roomBadges(window.hass, "den", cfg || C(i)._config, { idle: true }).flatMap((b) => b.ids);
      const out = { config: [0, 1, 2, 3, 4].map((i) => IGN.every((x) => ids(i).includes(x))) };
      const view = S.aggregateHass(window.hass, { kinds: true, exclude: IGN });
      out.merged = view.states["binary_sensor.savvy_agg_presence_den"]?.attributes.savvy_members;
      out.header = badgeIds(0);
      out.title = badgeIds(1);
      out.tile = badgeIds(2);
      out.temp = S.roomTemperature(window.hass, "den", C(0)._config)?.entity;
      out.tempNoIgnore = S.roomTemperature(window.hass, "den", C(6)._config)?.entity;
      out.locks = C(4)._items().map((i) => i.entity);
      out.named = C(7)._items().map((i) => i.entity);
      out.pinned = badgeIds(5);
      out.optout = ids(6);
      out.actText = C(3).shadowRoot.textContent;
      return out;
    }, IGN);
    check(`${tag} room header, section title, room tile, room activity and lock all take the ignore list`, r.config.every(Boolean), JSON.stringify(r.config));
    check(`${tag} an ignored sensor never joins a merged item`, !r.merged || !r.merged.includes("binary_sensor.den_p1"), JSON.stringify(r.merged));
    check(`${tag} the badges drop ignored sensors (header, title, tile)`, [r.header, r.title, r.tile].every((l) => !l.some((x) => IGN.includes(x))), JSON.stringify([r.header, r.title, r.tile]));
    check(`${tag} the room temperature skips an ignored sensor`, r.temp === "sensor.den_t2", String(r.temp));
    check(`${tag} the lock card drops an ignored lock but keeps the other`, r.locks.includes("lock.den_a") && !r.locks.includes("lock.den_b"), JSON.stringify(r.locks));
    check(`${tag} a lock the card names still shows`, r.named.includes("lock.den_b"), JSON.stringify(r.named));
    check(`${tag} a pinned entity still shows`, r.pinned.includes("binary_sensor.den_p1"), JSON.stringify(r.pinned));
    check(`${tag} the card's own exclude: false opts out of the list`, r.optout.length === 0, JSON.stringify(r.optout));
    check(`${tag} the room activity card does not show the ignored door or hot sensor`, r.actText.length > 20 && !/Patio Door/.test(r.actText) && !/\b31\b/.test(r.actText), r.actText.slice(0, 200));
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
