// The Savvy settings resolver: what every card takes from the settings, and that the card's own
// config (even `false`) always wins. Pure functions, no card needed.
import { openPage } from "./_util.mjs";

const SETTINGS = {
  pages: { home: "/lovelace/home", lights: "/lovelace/lights", climate: "/lovelace/climate", media: "/lovelace/media", security: "/lovelace/security", health: "/lovelace/admin", room: "/lovelace/{slug}" },
  house: { control: "input_select.house_mode", weather: "weather.home", security: "lock.front", tap: "navigate" },
  health: { watchman: ["sensor.wm"], battery_threshold: 25, warn_above: 5, exclude_platforms: ["mobile_app"], group_by: "device", group_min: 4, watchman_last_run: "sensor.wm_last" },
  ignore: { entities: ["light.porch"], areas: ["hallway"] },
  rooms: {
    kitchen: { name: "Cook", icon: "mdi:pot", page: "/lovelace/kitchen-x", control: "input_select.kitchen_mode", light_state: "input_boolean.kitchen_light",
      temperature: "sensor.kitchen_t", humidity: "sensor.kitchen_h", include: ["lock.k"], exclude: ["light.k2"] },
    living_room: { light_state: "input_boolean.lr" },
  },
};

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, {});
  const R = (type, cfg, settings = SETTINGS) => page.evaluate(({ type, cfg, settings }) => {
    const before = JSON.stringify(cfg);
    const r = window.__savvy.resolveSettings(type, cfg, settings);
    return { config: r.config, inherited: r.inherited, mutated: JSON.stringify(cfg) !== before, same: r.config === cfg };
  }, { type, cfg, settings });
  const by = (r, path) => r.inherited.find((i) => i.path === path);

  // nothing to inherit: the very same config comes back
  let r = await R("savvy-section-title-card", { area: "kitchen" }, null);
  check("no settings: the card's config comes back untouched", r.same && !r.inherited.length);
  r = await R("savvy-section-title-card", { area: "kitchen" }, {});
  check("empty settings: nothing inherited", !r.inherited.length);

  // a room's values reach the section title
  r = await R("savvy-section-title-card", { area: "kitchen" });
  check("section title: the room's name, icon, control, temperature, include and exclude",
    r.config.name === "Cook" && r.config.icon === "mdi:pot" && r.config.control === "input_select.kitchen_mode" && r.config.temperature === "sensor.kitchen_t"
    && JSON.stringify(r.config.include) === '["lock.k"]' && JSON.stringify(r.config.exclude) === '["light.k2"]', JSON.stringify(r.config));
  check("section title: the room's light helper is not pinned as a badge", r.config.entities === undefined && !by(r, "entities"), JSON.stringify(r.config.entities));
  check("section title: the room's page, else the pattern", r.config.navigation_path === "/lovelace/kitchen-x");
  r = await R("savvy-section-title-card", { area: "living_room" });
  check("section title: with no page of its own the pattern fills in ({slug})", r.config.navigation_path === "/lovelace/living-room" && by(r, "navigation_path").from === "pages.room", JSON.stringify(r.inherited));
  r = await R("savvy-section-title-card", { name: "Appliances" });
  check("section title: with no area nothing room-related is inherited", !r.inherited.length && r.same);

  // the card wins, including an explicit false
  r = await R("savvy-section-title-card", { area: "kitchen", temperature: "sensor.mine", control: false, name: "" , icon: false });
  check("the card's own value wins, and so does false", r.config.temperature === "sensor.mine" && r.config.control === false && r.config.icon === false, JSON.stringify(r.config));
  check("an empty string counts as set", r.config.name === "");

  // lists add to the card's own; false switches that off
  r = await R("savvy-section-title-card", { area: "kitchen", exclude: ["light.own"] });
  check("lists: the settings' exclude is added to the card's own", JSON.stringify(r.config.exclude.sort()) === '["light.k2","light.own"]', JSON.stringify(r.config.exclude));
  r = await R("savvy-section-title-card", { area: "kitchen", exclude: false, include: false });
  check("lists: false turns inheritance off", r.config.exclude === false && r.config.include === false);
  r = await R("savvy-section-title-card", { area: "kitchen", exclude: ["light.k2"] });
  check("lists: nothing new, nothing changes", by(r, "exclude") === undefined);

  // the light helper is not a badge: a card's own pins are its own
  r = await R("savvy-section-title-card", { area: "kitchen", entities: [{ entity: "input_boolean.kitchen_light" }] });
  check("pin: a card can still pin the helper itself, once", r.config.entities.length === 1 && !by(r, "entities"));
  r = await R("savvy-section-title-card", { area: "kitchen", entities: [{ entity: "binary_sensor.door" }] });
  check("pin: the card's own entities are left alone", r.config.entities.map((e) => e.entity).join() === "binary_sensor.door" && !by(r, "entities"));
  r = await R("savvy-section-title-card", { area: "kitchen", entities: false });
  check("pin: entities: false is respected", r.config.entities === false);

  // which room: exactly one
  r = await R("savvy-lights-card", { area: ["kitchen", "living_room"] });
  check("lights: several areas, no room settings", !r.inherited.length);
  r = await R("savvy-lights-card", { area: ["kitchen"] });
  check("lights: one area in a list still counts", r.config.toggle?.entity === "input_boolean.kitchen_light");
  r = await R("savvy-lights-card", { area: "kitchen", toggle: "input_boolean.mine" });
  check("lights: the card's own toggle wins", r.config.toggle === "input_boolean.mine" && !r.inherited.length);
  r = await R("savvy-lights-card", { area: "kitchen", master: "input_boolean.old" });
  check("lights: the pre-Savvy master wins too", r.config.toggle === undefined);
  r = await R("savvy-lights-card", { area: "kitchen", toggle: { entity: "input_boolean.mine", name: "x" } });
  check("lights: an object toggle wins", r.config.toggle.entity === "input_boolean.mine");

  // room header
  r = await R("savvy-room-header-card", { area: "kitchen" });
  check("room header: control, temperature, include, exclude, pin, home button, room pages",
    r.config.control === "input_select.kitchen_mode" && r.config.temperature === "sensor.kitchen_t" && r.config.entities === undefined
    && r.config.home_path === "/lovelace/home" && r.config.room_path === "/lovelace/{slug}" && r.config.include[0] === "lock.k" && r.config.exclude[0] === "light.k2", JSON.stringify(r.config));
  check("room header: no name or icon of its own to fill", r.config.name === undefined && r.config.icon === undefined);

  // room tile
  r = await R("savvy-room-tile", { area: "kitchen" });
  check("room tile: name, icon, control, temperature, toggle, page",
    r.config.name === "Cook" && r.config.icon === "mdi:pot" && r.config.control === "input_select.kitchen_mode" && r.config.temperature === "sensor.kitchen_t"
    && r.config.toggle === "input_boolean.kitchen_light" && r.config.navigation_path === "/lovelace/kitchen-x", JSON.stringify(r.config));
  r = await R("savvy-room-tile", { area: "kitchen", light_state: "input_boolean.old" });
  check("room tile: the pre-Savvy light_state wins", r.config.toggle === undefined);

  // climate and room activity
  r = await R("savvy-climate-card", { area: "kitchen" });
  check("climate: the room's temperature and humidity", r.config.temperature === "sensor.kitchen_t" && r.config.humidity === "sensor.kitchen_h");
  r = await R("savvy-climate-card", { entity: "climate.k" });
  check("climate: with no area, nothing", !r.inherited.length);
  r = await R("savvy-room-activity-card", { area: "kitchen", exclude: ["x.y"] });
  check("room activity: the room's exclude joins the card's", r.config.exclude.includes("light.k2") && r.config.exclude.includes("x.y"));
  check("room activity: the room's include is taken too (0.8.0: a lock that has no area)", JSON.stringify(r.config.include) === '["lock.k"]', JSON.stringify(r.config.include));
  r = await R("savvy-room-activity-card", { area: "kitchen", include: false });
  check("room activity: include: false turns it off", r.config.include === false);

  // system health
  r = await R("savvy-system-health-card", {});
  check("system health: every health option",
    r.config.battery_threshold === 25 && r.config.warn_above === 5 && r.config.group_by === "device" && r.config.group_min === 4 && r.config.watchman[0] === "sensor.wm"
    && r.config.exclude_platforms[0] === "mobile_app" && r.config.watchman_last_run === "sensor.wm_last", JSON.stringify(r.config));
  r = await R("savvy-system-health-card", { battery_threshold: 10, watchman_last_run: false });
  check("system health: the card's own values win", r.config.battery_threshold === 10 && r.config.watchman_last_run === false && r.config.warn_above === 5);

  // home header
  r = await R("savvy-home-header-card", {});
  const h = r.config;
  check("home header: control, weather, home button", h.control === "input_select.house_mode" && h.weather === "weather.home" && h.home_path === "/lovelace/home", JSON.stringify(h));
  check("home header: each chip's page", h.lights.navigation_path === "/lovelace/lights" && h.climate.navigation_path === "/lovelace/climate"
    && h.media.navigation_path === "/lovelace/media" && h.security.navigation_path === "/lovelace/security");
  check("home header: house.tap navigate makes a tap go to the page", h.lights.tap_action.action === "navigate" && h.lights.tap_action.navigation_path === "/lovelace/lights"
    && h.security.tap_action.navigation_path === "/lovelace/security");
  check("home header: the security entity", h.security.entity === "lock.front");
  check("home header: global ignores reach every chip", ["lights", "climate", "media", "security"].every((k) => h[k].exclude[0] === "light.porch" && h[k].exclude_areas[0] === "hallway"));
  check("home header: the cog takes its page, its tap and every health option",
    h.health.navigation_path === "/lovelace/admin" && h.health.tap_action.navigation_path === "/lovelace/admin" && h.health.battery_threshold === 25 && h.health.warn_above === 5
    && h.health.group_by === "device" && h.health.group_min === 4 && h.health.watchman[0] === "sensor.wm" && h.health.watchman_last_run === "sensor.wm_last", JSON.stringify(h.health));
  r = await R("savvy-home-header-card", { media: { hold_action: { action: "navigate", navigation_path: "/lovelace/media" } }, lights: { tap_action: { action: "toggle" } }, climate: false,
    security: { entity: "lock.mine", navigation_path: "/lovelace/sec" }, health: false, control: false });
  const c = r.config;
  check("home header: a chip with its own hold keeps its tap (the list)", c.media.tap_action === undefined && c.media.navigation_path === "/lovelace/media");
  check("home header: an explicit tap_action stays", c.lights.tap_action.action === "toggle");
  check("home header: false chips and false health stay false, with nothing inherited under them", c.climate === false && c.health === false);
  check("home header: the chip's own entity and page win", c.security.entity === "lock.mine" && c.security.navigation_path === "/lovelace/sec" && c.security.tap_action.navigation_path === "/lovelace/sec");
  check("home header: control: false stays", c.control === false);
  r = await R("savvy-home-header-card", { lights: { exclude: ["light.own"] } }, { ...SETTINGS, house: { ...SETTINGS.house, tap: "list" } });
  check("home header: house.tap list leaves taps alone, and lists still add up",
    r.config.lights.tap_action === undefined && r.config.health.tap_action === undefined && r.config.lights.exclude.length === 2);

  // where each value came from, for the editors
  r = await R("savvy-section-title-card", { area: "kitchen" });
  const ctl = by(r, "control"), pg = by(r, "navigation_path");
  check("inherited: label, value and source", ctl.label === "Control" && ctl.value === "input_select.kitchen_mode" && ctl.from === "rooms.kitchen" && pg.from === "rooms.kitchen", JSON.stringify(r.inherited));
  r = await R("savvy-home-header-card", {});
  check("inherited: actions read as words", r.inherited.some((i) => i.path === "lights.tap_action" && i.value === "navigate to /lovelace/lights"), JSON.stringify(r.inherited.slice(0, 6)));
  check("the card's own config is never mutated", !(await R("savvy-home-header-card", { lights: { name: "L" } })).mutated);

  // a card without rules is left alone
  r = await R("savvy-entity-card", { entity: "light.x" });
  check("a card with no rules gets nothing", r.same && !r.inherited.length);

  const real = errors.filter((e) => !/Failed to load resource|callWS not implemented/.test(e));
  check("no errors", real.length === 0, real.join(" | "));
  await page.close();
}
