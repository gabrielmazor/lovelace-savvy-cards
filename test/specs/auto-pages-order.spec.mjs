// What the dashboard says about itself: a view named lights, climate, media or security (or a room's
// name) is the page for it without a line of settings, and a lights card with no order of its own
// follows the first lights card for the same room that has one, until it is unlinked.
import { openPage, idle } from "./_util.mjs";

const L = (area, order, extra = {}) => ({ type: "custom:savvy-lights-card", area, ...(order ? { order } : {}), ...extra });
const CONF = {
  views: [
    { path: "home", title: "Home", sections: [{ cards: [L("living_room", ["light.living_room_strip", "light.living_room_ceiling", "light.living_room_floor_lamp"])] }] },
    { path: "lights", title: "Lights", cards: [L("living_room", ["light.living_room_ceiling", "light.living_room_strip"])] },
    { path: "climate", title: "Climate" }, { path: "media", title: "Media" }, { path: "security", title: "Security" },
    { path: "living-room", title: "Living room" }, { path: "kitchen", title: "Kitchen" },
  ],
};

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 520], ["light", 340]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(() => { history.replaceState({}, "", "/lovelace/home"); window.__savvy.SettingsStore._sync(); });

    const r = await page.evaluate(async ({ CONF, width }) => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      window.hass.callWS = async (m) => (m.type === "lovelace/config" ? JSON.parse(JSON.stringify(CONF)) : Promise.reject(new Error("no")));
      const mk = (type, cfg) => window.mount(type, cfg, width);
      const head = mk("savvy-home-header-card", {});
      const title = mk("savvy-section-title-card", { area: "kitchen" });
      const tile = mk("savvy-room-tile", { area: "living_room" });
      const own = mk("savvy-room-tile", { area: "kitchen", navigation_path: "/lovelace/mine" });
      const follower = mk("savvy-lights-card", { area: "living_room" });
      const independent = mk("savvy-lights-card", { area: "living_room", sync_order: false });
      const mine = mk("savvy-lights-card", { area: "living_room", order: ["light.living_room_floor_lamp"] });
      const other = mk("savvy-lights-card", { area: "kitchen" });
      await wait(500);
      const out = {
        pages: ["lights", "climate", "media", "security"].map((k) => head._config[k]?.navigation_path),
        taps: ["lights", "climate", "media", "security"].map((k) => head._config[k]?.tap_action || null),
        health: head._config.health?.navigation_path ?? null,
        title: title._config.navigation_path, tile: tile._config.navigation_path, own: own._config.navigation_path,
        follower: follower._config.order, independent: independent._config.order, mine: mine._config.order, other: other._config.order,
        rows: head._inherited.map((i) => `${i.label}:${i.from}`),
      };
      // the editors
      const ed = document.createElement("savvy-lights-card-editor");
      document.body.appendChild(ed);
      ed.setConfig({ type: "custom:savvy-lights-card", area: "living_room" });
      ed.hass = window.hass;
      await wait(100);
      let box = ed.shadowRoot.querySelector(".sv-inherit");
      out.edText = box?.textContent || null;
      out.edHead = box?.querySelector(".h")?.textContent || null;
      let changed = null;
      ed.addEventListener("config-changed", (e) => { changed = e.detail.config; });
      box?.querySelector(".unlink")?.click();
      await wait(100);
      out.unlinked = changed;
      out.edAfter = ed.shadowRoot.querySelector(".sv-inherit")?.textContent || null;
      ed.remove();
      const se = document.createElement("savvy-settings-card-editor");
      document.body.appendChild(se);
      se.setConfig({ type: "custom:savvy-settings-card" });
      se.hass = window.hass;
      await wait(100);
      out.setHelpers = JSON.stringify(se.schema(window.hass)).match(/Found automatically: [^ .]+/g) || [];
      se.remove();
      const sc = mk("savvy-settings-card", {});
      await wait(100);
      out.status = sc.shadowRoot.querySelector("#sub").textContent;
      return out;
    }, { CONF, width });
    const ends = (p, s) => typeof p === "string" && p.endsWith(s);
    check(`${tag} lights, climate, media and security chips find their pages by name`, ["lights", "climate", "media", "security"].every((k, i) => ends(r.pages[i], `/${k}`)), JSON.stringify(r.pages));
    check(`${tag} a tap still opens the list: no tap_action comes with a found page`, r.taps.every((t) => t === null), JSON.stringify(r.taps));
    check(`${tag} the health page is never guessed`, r.health === null, String(r.health));
    check(`${tag} a section title and a room tile find the room's page`, ends(r.title, "/kitchen") && ends(r.tile, "/living-room"), JSON.stringify([r.title, r.tile]));
    check(`${tag} the card's own page wins`, r.own === "/lovelace/mine", String(r.own));
    check(`${tag} the home header says where each page was found`, r.rows.some((x) => /Lights page:found automatically/.test(x)), JSON.stringify(r.rows));
    check(`${tag} a lights card with no order takes the first card's (in dashboard order)`, JSON.stringify(r.follower) === JSON.stringify(["light.living_room_strip", "light.living_room_ceiling", "light.living_room_floor_lamp"]), JSON.stringify(r.follower));
    check(`${tag} sync_order: false, an order of its own, and another room's card stay as they are`, !r.independent?.length && r.mine.length === 1 && !r.other?.length, JSON.stringify([r.independent, r.mine, r.other]));
    check(`${tag} the editor says where the order is read from, with Unlink`, /Order/.test(r.edText) && /Lights card on Home, the first of 2/.test(r.edText) && /Unlink/.test(r.edText) && /Found on the dashboard/.test(r.edHead), `${r.edHead} | ${r.edText}`);
    check(`${tag} Unlink copies the order into the card, and it stops following`, Array.isArray(r.unlinked?.order) && r.unlinked.order[0] === "light.living_room_strip" && !/Order/.test(r.edAfter || ""), JSON.stringify([r.unlinked, r.edAfter]));
    check(`${tag} the settings card lists the pages it found`, r.setHelpers.length >= 4 && /pages? found by name/.test(r.status), JSON.stringify([r.setHelpers, r.status]));

    // explicit false, settings that name a page, and two views that both claim a name
    const r2 = await page.evaluate(async ({ CONF, width }) => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const SS = window.__savvy.SettingsStore;
      const conf = JSON.parse(JSON.stringify(CONF));
      conf.views.push({ path: "a", title: "Heating" }, { path: "b", title: "Heating" }, { path: "heating-x", title: "Other" });
      conf.views[1].cards.push({ type: "custom:savvy-settings-card", pages: { lights: false, media: "/lovelace/set-media" } });
      conf.views = conf.views.filter((v) => v.path !== "climate");
      conf.views.push({ path: "c1", title: "Climate" }, { path: "c2", title: "Climate" });
      window.hass.callWS = async () => conf;
      SS.reset(); SS._sync();
      const head = window.mount("savvy-home-header-card", {}, width);
      await wait(500);
      return { lights: head._config.lights?.navigation_path ?? null, media: head._config.media?.navigation_path, climate: head._config.climate?.navigation_path ?? null, security: head._config.security?.navigation_path };
    }, { CONF, width });
    check(`${tag} pages: false switches it off; the settings' page beats the found one; two views claiming a name: no guess`,
      r2.lights === null && r2.media === "/lovelace/set-media" && r2.climate === null && /\/security$/.test(r2.security), JSON.stringify(r2));
    check(`${tag} springs idle, no errors`, (await idle(page)) && errors.filter((x) => !/Failed to load resource/.test(x)).length === 0, errors.join(" | "));
    await page.close();
  }
}
