// The settings store: finding the settings card in a dashboard's config, one fetch per page load,
// the localStorage cache (no flash, and fine when storage is blocked), refresh, and the
// settings card on the page publishing live.
import { openPage } from "./_util.mjs";

const COOK = { type: "custom:savvy-settings-card", rooms: { kitchen: { name: "Cook" } }, pages: { lights: "/lovelace/lights" } };

export default async function ({ browser, base, check }) {
  // ---- finding it in a dashboard config
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(() => {
      const f = (c) => window.__savvy.findSettingsCards(c).length;
      const S = { type: "custom:savvy-settings-card" };
      const paths = {};
      for (const p of ["/lovelace/home", "/lovelace", "/", "/dash-mobile/home", "/lovelace-x/y"]) { history.replaceState({}, "", p); paths[p] = window.__savvy.dashboardPath(); }
      return {
        sections: f({ views: [{ sections: [{ cards: [{ type: "grid", cards: [S] }] }] }] }),
        masonry: f({ views: [{ cards: [{ type: "vertical-stack", cards: [{ type: "entities" }, { type: "conditional", card: S }] }] }] }),
        none: f({ views: [{ cards: [{ type: "entities" }] }] }),
        two: f({ views: [{ cards: [S] }, { sections: [{ cards: [S] }] }] }),
        junk: f(null) + f("x") + f([]) + f({}),
        norm: JSON.stringify(window.__savvy.normalizeSettings({ type: "x", layout: "compact", pages: { a: "/b" }, house: {}, rooms: {} })),
        normNone: window.__savvy.normalizeSettings({ type: "x", pages: {} }),
        paths,
      };
    });
    check("finds the settings card in sections, nested grids, stacks and conditionals", r.sections === 1 && r.masonry === 1 && r.two === 2 && r.none === 0 && r.junk === 0, JSON.stringify(r));
    check("only the known, filled-in sections are kept", r.norm === '{"pages":{"a":"/b"}}' && r.normNone === null, r.norm);
    check("the dashboard is the first path segment, null for the default", r.paths["/lovelace/home"] === null && r.paths["/lovelace"] === null && r.paths["/"] === null
      && r.paths["/dash-mobile/home"] === "dash-mobile" && r.paths["/lovelace-x/y"] === "lovelace-x", JSON.stringify(r.paths));
    check("no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- one fetch per page load, the first of several, the cache
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async (COOK) => {
      history.replaceState({}, "", "/lovelace/home");
      window.asked = [];
      const second = { ...COOK, rooms: { kitchen: { name: "Second" } } };
      window.hass.callWS = async (m) => { window.asked.push(JSON.stringify(m)); return { views: [{ sections: [{ cards: [{ type: "grid", cards: [COOK, second] }] }] }] }; };
      const SS = window.__savvy.SettingsStore;
      const a = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      window.mount("savvy-room-tile", { area: "kitchen" }, 400);
      const first = a._config.name;
      await new Promise((res) => setTimeout(res, 400));
      return { first, name: a._config.name, asked: [...window.asked], found: SS.found, cache: localStorage.getItem("savvy:settings:default"), consumers: SS.consumers(), text: a.shadowRoot.textContent };
    }, COOK);
    check("a fresh load asks the dashboard once for all cards, with url_path null for the default", r.asked.length === 1 && r.asked[0] === '{"type":"lovelace/config","url_path":null}', JSON.stringify(r.asked));
    check("the first card has no settings until they arrive; then it follows them", r.first === undefined && r.name === "Cook" && /Cook/.test(r.text), JSON.stringify(r).slice(0, 300));
    check("with several settings cards the first wins, and the count says so", r.found === 2, String(r.found));
    check("the answer is cached in localStorage", !!r.cache && JSON.parse(r.cache).settings.rooms.kitchen.name === "Cook");
    check("cards count as consumers", r.consumers === 3, String(r.consumers));
    check("no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // a named dashboard is asked for by its url_path
  {
    const { page } = await openPage(browser, base, {});
    const r = await page.evaluate(async (COOK) => {
      history.replaceState({}, "", "/dash-mobile/home");
      window.asked = [];
      window.hass.callWS = async (m) => { window.asked.push(JSON.stringify(m)); return { views: [{ cards: [COOK] }] }; };
      const a = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      await new Promise((res) => setTimeout(res, 300));
      return { asked: [...window.asked], name: a._config.name, key: Object.keys(localStorage) };
    }, COOK);
    check("a named dashboard is read by its url_path, and cached under it", r.asked[0] === '{"type":"lovelace/config","url_path":"dash-mobile"}' && r.name === "Cook" && r.key.includes("savvy:settings:dash-mobile"), JSON.stringify(r));
    await page.close();
  }

  // ---- the cache: settings at the first paint, nothing flashes when the fetch agrees
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async (COOK) => {
      history.replaceState({}, "", "/lovelace/home");
      localStorage.setItem("savvy:settings:default", JSON.stringify({ settings: { rooms: COOK.rooms, pages: COOK.pages }, found: 1 }));
      let release;
      window.hass.callWS = () => new Promise((res) => { release = () => res({ views: [{ cards: [COOK] }] }); });
      const a = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      const sync = { name: a._config.name, nav: a._config.navigation_path };
      const el = a._el, key = a._appliedKey;
      await new Promise((res) => setTimeout(res, 150));
      release();
      await new Promise((res) => setTimeout(res, 300));
      return { sync, rebuilt: a._el !== el || a._appliedKey !== key, name: a._config.name };
    }, COOK);
    check("cached settings apply on the very first setConfig: no flash", r.sync.name === "Cook" && r.sync.nav === undefined, JSON.stringify(r));
    check("a fetch that agrees with the cache rebuilds nothing", !r.rebuilt && r.name === "Cook");
    check("no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- the cache is corrected when the dashboard says otherwise, and cleared when the card is gone
  {
    const { page } = await openPage(browser, base, {});
    const r = await page.evaluate(async (COOK) => {
      history.replaceState({}, "", "/lovelace/home");
      localStorage.setItem("savvy:settings:default", JSON.stringify({ settings: { rooms: { kitchen: { name: "Old" } } }, found: 1 }));
      let answer = { views: [{ cards: [COOK] }] };
      window.hass.callWS = async () => answer;
      const a = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      const old = a._config.name;
      await new Promise((res) => setTimeout(res, 300));
      const fixed = a._config.name;
      // the settings card is deleted from the dashboard: the next refresh clears them
      answer = { views: [{ cards: [] }] };
      const SS = window.__savvy.SettingsStore;
      SS._fetchedAt = Date.now() - 6 * 60 * 1000;
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((res) => setTimeout(res, 300));
      return { old, fixed, cleared: a._config.name, cache: localStorage.getItem("savvy:settings:default") };
    }, COOK);
    check("a stale cache is replaced by what the dashboard says", r.old === "Old" && r.fixed === "Cook", JSON.stringify(r));
    check("a dashboard without the settings card clears them, and the cache", r.cleared === undefined && r.cache === null, JSON.stringify(r));
    await page.close();
  }

  // ---- refresh when the page comes back after five minutes, not before
  {
    const { page } = await openPage(browser, base, {});
    const r = await page.evaluate(async (COOK) => {
      history.replaceState({}, "", "/lovelace/home");
      window.asked = 0;
      window.hass.callWS = async () => { window.asked++; return { views: [{ cards: [COOK] }] }; };
      window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      await new Promise((res) => setTimeout(res, 300));
      const first = window.asked;
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((res) => setTimeout(res, 150));
      const soon = window.asked;
      window.__savvy.SettingsStore._fetchedAt = Date.now() - 6 * 60 * 1000;
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((res) => setTimeout(res, 150));
      return { first, soon, later: window.asked };
    }, COOK);
    check("coming back within five minutes doesn't refetch; after five it does", r.first === 1 && r.soon === 1 && r.later === 2, JSON.stringify(r));
    await page.close();
  }

  // ---- failing and blocked: the cards just work
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async (COOK) => {
      history.replaceState({}, "", "/lovelace/home");
      window.hass.callWS = async () => { throw new Error("no access"); };
      const a = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      await new Promise((res) => setTimeout(res, 200));
      const failed = { name: a._config.name, text: a.shadowRoot.textContent };
      // storage that throws, a fetch that works
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = () => { throw new Error("blocked"); };
      Storage.prototype.setItem = () => { throw new Error("blocked"); };
      window.__savvy.SettingsStore.reset();
      window.hass.callWS = async () => ({ views: [{ cards: [COOK] }] });
      const b = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      await new Promise((res) => setTimeout(res, 300));
      const blocked = b._config.name;
      Storage.prototype.getItem = get; Storage.prototype.setItem = set;
      // garbage in the cache
      window.__savvy.SettingsStore.reset();
      localStorage.setItem("savvy:settings:default", "{not json");
      window.hass.callWS = async () => { throw new Error("x"); };
      const c = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      return { failed, blocked, garbage: c._config.name };
    }, COOK);
    check("a refused dashboard config: the card shows as if there were no settings", r.failed.name === undefined && /Kitchen/.test(r.failed.text), JSON.stringify(r.failed));
    check("blocked localStorage: the fetched settings still apply", r.blocked === "Cook", JSON.stringify(r));
    check("a corrupt cache is ignored", r.garbage === undefined);
    check("none of it logs an error", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- the settings card on the page publishes while it is edited
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async (COOK) => {
      history.replaceState({}, "", "/lovelace/home");
      window.hass.callWS = async () => ({ views: [{ cards: [{ ...COOK, rooms: { kitchen: { name: "Saved" } } }] }] });
      const SS = window.__savvy.SettingsStore;
      const s = window.mount("savvy-settings-card", { rooms: { kitchen: { name: "Draft" } } }, 400);
      const t = window.mount("savvy-section-title-card", { area: "kitchen" }, 400);
      const sync = t._config.name;
      await new Promise((res) => setTimeout(res, 300));
      const afterFetch = t._config.name;
      s.setConfig({ rooms: { kitchen: { name: "Edited" } } });
      await new Promise((res) => setTimeout(res, 100));
      const edited = t._config.name;
      s.remove();
      await new Promise((res) => setTimeout(res, 300));
      return { sync, afterFetch, edited, afterRemove: t._config.name, live: SS.live };
    }, COOK);
    check("the settings card on the page wins over the fetched copy while it is there", r.sync === "Draft" && r.afterFetch === "Draft", JSON.stringify(r));
    check("editing it updates every card at once", r.edited === "Edited", JSON.stringify(r));
    check("removing it hands back to the saved dashboard", r.afterRemove === "Saved" && r.live === null, JSON.stringify(r));
    check("no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
