// 0.10.1: admin-only visibility. The health cog and its count badge can be kept from people who are not
// administrators: `admin_only: [health_cog, health_badges]` in the Savvy settings, `admin_only` on the card
// to override. Everyone sees everything unless it is listed. A user Home Assistant does not describe counts as an admin.
import { openPage, idle } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) {
    const tag = `[${theme}]`;
    const { page, errors } = await openPage(browser, base, { theme, width: 900 });
    const r = await page.evaluate(async () => {
      const S = window.__savvy, out = {};
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
      const header = (cfg) => window.mount("savvy-home-header-card", { health: { watchman: W }, lights: false, climate: false, media: false, security: false, ...cfg }, 900);
      const read = (el) => { const R = el.shadowRoot, c = R.getElementById("health"); return { cog: !c.hidden, count: !R.getElementById("count").hidden, label: c.getAttribute("aria-label"), width: c.offsetWidth, alert: c.hasAttribute("data-alert"), ac: getComputedStyle(c).getPropertyValue("--ac").trim() }; };
      const as = (user) => { window.hass = { ...window.hass, user }; };

      // nothing listed: everyone sees the cog and its count
      as({ is_admin: false });
      let a = header({}), b;
      await wait(300);
      out.default = read(a);

      // the settings list the cog
      window.mount("savvy-settings-card", { admin_only: ["health_cog"] }, 900);
      const base = window.cards.length;
      as({ is_admin: false });
      header({});                                   // base + 0: non-admin
      as({ is_admin: true });
      header({});                                   // base + 1: admin
      as({ is_admin: false });
      header({ admin_only: false });                // base + 2: the card says nobody is hidden
      header({ admin_only: ["health_badges"] });    // base + 3: the card's own list wins over the settings
      await wait(900);
      out.cogNon = read(window.cards[base]);
      out.cogAdmin = read(window.cards[base + 1]);
      out.cardFalse = read(window.cards[base + 2]);
      out.cardList = read(window.cards[base + 3]);
      out.cogHiddenCount = (window.cards[base]._config.admin_only || []).join(",");
      return out;
    });
    check(`${tag} nothing listed: a non-admin sees the cog and its count`, r.default.cog && r.default.count, JSON.stringify(r.default));
    check(`${tag} the settings list health_cog: hidden for a non-admin, shown to an admin`, !r.cogNon.cog && r.cogAdmin.cog && r.cogAdmin.count, JSON.stringify([r.cogNon, r.cogAdmin]));
    check(`${tag} a hidden cog leaves no width behind`, r.cogNon.width === 0, JSON.stringify(r.cogNon));
    check(`${tag} the card's own admin_only: false beats the settings`, r.cardFalse.cog && r.cardFalse.count, JSON.stringify(r.cardFalse));
    check(`${tag} a cog whose badge is kept looks idle (no alert tone), an admin's keeps it`, !r.cardList.alert && r.cardList.ac !== r.default.ac && r.default.alert, JSON.stringify([r.cardList, r.default]));
    check(`${tag} the card's own list replaces the settings': badges only keeps the cog, drops the number`, r.cardList.cog && !r.cardList.count && r.cardList.label === "System health", JSON.stringify(r.cardList));
    await page.close();

    const { page: p2, errors: e2 } = await openPage(browser, base, { theme, width: 900 });
    const q = await p2.evaluate(async () => {
      const S = window.__savvy, out = {};
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
      const header = (cfg, width = 900) => window.mount("savvy-home-header-card", { health: { watchman: W }, ...cfg }, width);
      const read = (el) => { const R = el.shadowRoot, c = R.getElementById("health"); return { cog: !c.hidden, count: !R.getElementById("count").hidden, label: c.getAttribute("aria-label") }; };
      const as = (user) => { window.hass = { ...window.hass, user }; };

      // true hides both; the list can name one; no user at all is an admin
      as({ is_admin: false });
      const t = header({ admin_only: true });
      const cnt = header({ admin_only: ["health_badges"] });
      as(undefined);
      const noUser = header({ admin_only: true });
      as({ name: "Someone" });
      const noFlag = header({ admin_only: true });
      await wait(400);
      out.all = read(t); out.badges = read(cnt); out.noUser = read(noUser); out.noFlag = read(noFlag);

      // no gap: the one-row header without its cog still fits, with the chips in place
      as({ is_admin: false });
      const row = window.mount("savvy-home-header-card", { admin_only: ["health_cog"], health: { watchman: W }, weather: false }, 900);
      const full = window.mount("savvy-home-header-card", { health: { watchman: W }, weather: false }, 900);
      await wait(400);
      const lay = (el) => { const R = el.shadowRoot, rw = R.getElementById("row"); const chips = [...R.querySelectorAll("#chips .chip")].map((c) => c.getBoundingClientRect()); return { single: rw.hasAttribute("data-single"), fits: rw.scrollWidth <= rw.clientWidth + 1, last: Math.max(...chips.map((c) => c.right)), n: chips.length }; };
      out.noGap = [lay(row), lay(full)];

      // settings: normalised, in the resolver's table, and in the editor
      out.norm = [S.normalizeSettings({ admin_only: true })?.admin_only, S.normalizeSettings({ admin_only: ["health_cog", "nope"] })?.admin_only, S.normalizeSettings({ admin_only: [] })];
      const res = S.resolveSettings("savvy-home-header-card", { health: {} }, { admin_only: ["health_cog"] });
      out.inherit = res.inherited.find((i) => i.path === "admin_only") || null;
      out.inheritConfig = res.config.admin_only;
      out.cardWins = S.resolveSettings("savvy-home-header-card", { admin_only: false }, { admin_only: ["health_cog"] }).config.admin_only;
      out.items = [S.adminOnlyItems(["health_badges"]).has("health_badges"), S.adminOnlyItems(false).size, S.isAdminUser({ user: { is_admin: false } }), S.isAdminUser({}), S.isAdminUser({ user: {} })];
      const ed = document.createElement("savvy-settings-card-editor");
      document.getElementById("stage").appendChild(ed);
      ed.hass = window.hass;
      ed.setConfig({ type: "custom:savvy-settings-card" });
      await wait(200);
      const flat = (list) => list.flatMap((f) => (f.schema ? flat(f.schema) : [f]));
      const field = flat(ed.schema ? ed.schema(window.hass) : []).find((f) => f.name === "admin_only");
      out.settingsField = field ? field.selector.select.options.map((o) => o.value) : null;
      const he = document.createElement("savvy-home-header-card-editor");
      document.getElementById("stage").appendChild(he);
      he.hass = window.hass;
      he.setConfig({ type: "custom:savvy-home-header-card" });
      await wait(200);
      out.headerField = flat(he.schema ? he.schema(window.hass) : []).filter((f) => f.name === "admin_only" || f.name === "dismiss").map((f) => f.name);
      return out;
    });
    check(`${tag} admin_only: true hides the cog for a non-admin`, !q.all.cog, JSON.stringify(q.all));
    check(`${tag} a list can name just the badge`, q.badges.cog && !q.badges.count, JSON.stringify(q.badges));
    check(`${tag} with no user (or one with no admin flag) nothing is hidden by mistake`, q.noUser.cog && q.noUser.count && q.noFlag.cog && q.noFlag.count, JSON.stringify([q.noUser, q.noFlag]));
    check(`${tag} without the cog the row still fits and the chips are where they were`, q.noGap[0].single && q.noGap[0].fits && q.noGap[0].n === q.noGap[1].n && q.noGap[0].last <= q.noGap[1].last + 1, JSON.stringify(q.noGap));
    check(`${tag} the settings normalise the list (true means both, unknown names go, empty is nothing)`,
      JSON.stringify(q.norm[0]) === JSON.stringify(["health_cog", "health_badges"]) && JSON.stringify(q.norm[1]) === JSON.stringify(["health_cog"]) && q.norm[2] === null, JSON.stringify(q.norm));
    check(`${tag} the header takes it from the settings, and says so in the inherited block`, q.inherit?.label === "Admin only" && JSON.stringify(q.inheritConfig) === JSON.stringify(["health_cog"]), JSON.stringify([q.inherit, q.inheritConfig]));
    check(`${tag} the card's own false is never replaced`, q.cardWins === false, JSON.stringify(q.cardWins));
    check(`${tag} admin helpers: a user with no flag or no user is an admin`, JSON.stringify(q.items) === JSON.stringify([true, 0, false, true, true]), JSON.stringify(q.items));
    check(`${tag} the settings editor has the Admin only list with both items`, JSON.stringify(q.settingsField) === JSON.stringify(["health_cog", "health_badges"]), JSON.stringify(q.settingsField));
    check(`${tag} the header editor has Admin only and the Dismiss button`, q.headerField.includes("admin_only") && q.headerField.includes("dismiss"), JSON.stringify(q.headerField));
    check(`${tag} springs idle`, await idle(p2));
    check(`${tag} no errors`, [...errors, ...e2].length === 0, [...errors, ...e2].join(" | "));
    await p2.close();
  }
}
