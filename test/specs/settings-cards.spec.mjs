// Real cards, with and without Savvy settings: what they show and do, that a change in the
// settings reaches them live, and that a card the change doesn't touch isn't rebuilt.
import { openPage, idle } from "./_util.mjs";

const SETTINGS = {
  pages: { home: "/lovelace/home", lights: "/lovelace/lights", climate: "/lovelace/climate", media: "/lovelace/media", security: "/lovelace/security", health: "/lovelace/admin", room: "/lovelace/{slug}" },
  house: { control: "input_select.house_mode", weather: "weather.home", tap: "navigate" },
  health: { battery_threshold: 25, warn_above: 5, group_by: "device", group_min: 4 },
  ignore: { entities: ["light.porch"] },
  rooms: { kitchen: { name: "Cook", icon: "mdi:pot", control: "input_select.kitchen_mode", light_state: "input_boolean.kitchen_light", temperature: "sensor.kitchen_t", humidity: "sensor.kitchen_h", page: "/lovelace/kitchen-x" } },
};

const STATES = {
  "input_boolean.kitchen_light": { state: "off", attributes: { friendly_name: "Kitchen light helper" } },
  "input_select.kitchen_mode": { state: "Cooking", attributes: { friendly_name: "Kitchen mode", options: ["Cooking", "Dinner"] } },
  "input_select.house_mode": { state: "Home", attributes: { friendly_name: "House mode", options: ["Home", "Away"] } },
  "sensor.kitchen_t": { state: "23.5", attributes: { friendly_name: "Kitchen temperature", unit_of_measurement: "°C", device_class: "temperature" } },
  "sensor.kitchen_h": { state: "48", attributes: { friendly_name: "Kitchen humidity", unit_of_measurement: "%", device_class: "humidity" } },
};

const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 520], ["light", 340]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    // stay on the default dashboard while the home header navigates
    await page.evaluate(({ SETTINGS, STATES }) => {
      history.replaceState({}, "", "/lovelace/home");
      window.nav = [];
      window.addEventListener("location-changed", () => window.nav.push(location.pathname));
      window.setStates(STATES);
      const SS = window.__savvy.SettingsStore;
      SS._sync();
      SS.set(SETTINGS);
    }, { SETTINGS, STATES });

    const mountAll = (width) => page.evaluate((width) => {
      const cfgs = [
        ["savvy-home-header-card", { media: { hold_action: { action: "navigate", navigation_path: "/lovelace/media" } } }],
        ["savvy-system-health-card", { source: "all" }],
        ["savvy-room-header-card", { area: "kitchen" }],
        ["savvy-section-title-card", { area: "kitchen" }],
        ["savvy-room-tile", { area: "kitchen" }],
        ["savvy-lights-card", { area: "kitchen" }],
        ["savvy-climate-card", { area: "kitchen" }],
        ["savvy-room-activity-card", { area: "kitchen" }],
        ["savvy-section-title-card", { area: "kitchen", name: "Mine" }],
      ];
      for (const [type, cfg] of cfgs) window.mount(type, cfg, width);
    }, width);
    await mountAll(width);
    await page.waitForTimeout(700);

    const eff = await page.evaluate(() => window.cards.map((c) => ({ type: c.tagName.toLowerCase(), inherited: (c._inherited || []).length, c: c._config })));
    const [home, health, header, title, tile, lights, climate, activity, mine] = eff;
    check(`${tag} home header: control, weather, home button, each chip's page, the cog`,
      home.c.control === "input_select.house_mode" && home.c.weather === "weather.home" && home.c.home_path === "/lovelace/home"
      && home.c.lights.navigation_path === "/lovelace/lights" && home.c.health.navigation_path === "/lovelace/admin" && home.c.health.battery_threshold === 25 && home.inherited > 10, JSON.stringify(home.c).slice(0, 400));
    check(`${tag} system health takes the health options`, health.c.battery_threshold === 25 && health.c.warn_above === 5 && health.c.group_by === "device" && health.c.group_min === 4);
    check(`${tag} room header: the room's control, temperature and pinned light helper`,
      header.c.control === "input_select.kitchen_mode" && header.c.temperature === "sensor.kitchen_t" && header.c.entities[0].entity === "input_boolean.kitchen_light");
    check(`${tag} section title: name, icon, control, page`, title.c.name === "Cook" && title.c.icon === "mdi:pot" && title.c.control === "input_select.kitchen_mode" && title.c.navigation_path === "/lovelace/kitchen-x");
    check(`${tag} room tile: name, toggle, page`, tile.c.name === "Cook" && tile.c.toggle === "input_boolean.kitchen_light" && tile.c.navigation_path === "/lovelace/kitchen-x");
    check(`${tag} lights: the pill's toggle is the room's light helper`, lights.c.toggle?.entity === "input_boolean.kitchen_light");
    check(`${tag} climate: the room's temperature and humidity`, climate.c.temperature === "sensor.kitchen_t" && climate.c.humidity === "sensor.kitchen_h");
    check(`${tag} room activity reads its room`, activity.inherited === 0 && activity.c.area === "kitchen");
    check(`${tag} the card's own name wins`, mine.c.name === "Mine" && mine.c.icon === "mdi:pot");

    // what shows
    const shown = await page.evaluate(() => ({
      title: window.cards[3].shadowRoot.querySelector("ha-card").textContent, mine: window.cards[8].shadowRoot.querySelector("ha-card").textContent,
      tile: window.cards[4].shadowRoot.querySelector("ha-card").textContent,
    }));
    check(`${tag} the room's name shows on the title and the tile; the card's own name over it`, /\bCook\b/.test(shown.title) && /\bCook\b/.test(shown.tile) && /Mine/.test(shown.mine) && !/\bCook\b/.test(shown.mine), JSON.stringify(shown).slice(0, 300));
    check(`${tag} the room's control shows its value`, /Cooking/.test(shown.title), shown.title.slice(0, 200));

    // the home header: a tap goes to the page; media's own hold keeps its tap for the list
    const chip = (i) => page.evaluate((i) => { const r = window.cards[0].shadowRoot.querySelectorAll("#chips .chip")[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i);
    await page.mouse.click(...Object.values(await chip(0)));
    await page.waitForTimeout(450);
    const tapNav = await page.evaluate(() => ({ nav: [...window.nav], sheets: window.__savvy.portalRoot().querySelectorAll(".sv-sheet").length }));
    check(`${tag} house.tap navigate: a tap on lights goes to its page`, tapNav.nav.at(-1) === "/lovelace/lights" && tapNav.sheets === 0, JSON.stringify(tapNav));
    await hold(page, await chip(0));
    await page.waitForTimeout(500);
    const holdGo = await page.evaluate(() => { const g = window.__savvy.portalRoot().querySelector(".sv-sheet .sv-go"); return g ? g.querySelector("span").textContent : null; });
    check(`${tag} hold lists, with the page button from the settings`, holdGo === "Open lights", String(holdGo));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(...Object.values(await chip(2)));
    await page.waitForTimeout(500);
    const media = await page.evaluate(() => ({ nav: [...window.nav], sheets: window.__savvy.portalRoot().querySelectorAll(".sv-sheet").length }));
    check(`${tag} a chip with its own hold keeps the tap on the list`, media.nav.length === 0 && media.sheets === 1, JSON.stringify(media));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);

    // a change in the settings reaches the cards; the ones it doesn't touch aren't rebuilt
    await page.evaluate((SETTINGS) => {
      window.__savvy.SettingsStore.set({ ...SETTINGS, rooms: { kitchen: { ...SETTINGS.rooms.kitchen, name: "Kitchenette" } } });
    }, SETTINGS);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      names: [window.cards[3]._config.name, window.cards[4]._config.name, window.cards[8]._config.name], title: window.cards[3].shadowRoot.querySelector("ha-card").textContent,
    }));
    check(`${tag} a changed room name reaches the title and the tile, and the card's own stays`, after.names.join() === "Kitchenette,Kitchenette,Mine" && /Kitchenette/.test(after.title), JSON.stringify(after));
    check(`${tag} cards the change doesn't touch keep their DOM`, await page.evaluate(() => {
      const climate = window.cards[6], el = climate._el || climate._root, key = climate._appliedKey;
      const SS = window.__savvy.SettingsStore;
      SS.set({ ...SS.settings, pages: { ...SS.settings.pages, lights: "/lovelace/lights-2" } });
      return (climate._el || climate._root) === el && climate._appliedKey === key;
    }));

    // without settings the cards behave as ever
    await page.evaluate(() => {
      window.__savvy.SettingsStore.set(null);
      for (const c of window.cards) c.remove();
      window.cards.length = 0;
      window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      window.mount("savvy-room-tile", { area: "kitchen" }, 400);
      window.mount("savvy-home-header-card", {}, 400);
      window.mount("savvy-lights-card", { area: "kitchen" }, 400);
    });
    await page.waitForTimeout(500);
    const plain = await page.evaluate(() => window.cards.map((c) => ({ inherited: (c._inherited || []).length, name: c._config.name, nav: c._config.navigation_path, toggle: c._config.toggle })));
    check(`${tag} with no settings, nothing is inherited and nothing changes`, plain.every((p) => p.inherited === 0) && plain[0].name === undefined && plain[1].nav === undefined, JSON.stringify(plain));
    const text = await page.evaluate(() => window.cards[0].shadowRoot.querySelector("ha-card").textContent);
    check(`${tag} with no settings the title shows the area's own name`, /Kitchen/.test(text) && !/Cook/.test(text), text.slice(0, 120));

    check(`${tag} springs idle`, await idle(page));
    const real = errors.filter((e) => !/Failed to load resource|callWS not implemented/.test(e));
    check(`${tag} no errors`, real.length === 0, real.join(" | "));
    await page.close();
  }
}
