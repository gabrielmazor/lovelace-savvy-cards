// Every card can have a title with a link (`title_path`), off by default. A card that already shows a name makes
// that name the link; a card with none gets a slim title line when `title` is set. Only the words are the link:
// pressing the card anywhere else does not navigate, and pressing the words does not also do what the card does.
import { openPage, idle } from "./_util.mjs";

const PATH = "/lovelace/target";
// [type, config, the element that holds the title text, extra config that makes it show]
const CARDS = [
  ["savvy-graph-card", { entities: [{ entity: "sensor.living_room_temperature" }], title: "Climate" }, "#ht"],
  ["savvy-lights-card", { area: "living_room" }, "#title"],
  ["savvy-lock-card", { entity: "lock.front_door" }, "#title"],
  ["savvy-scene-card", { area: "office", title: "Scenes" }, "#title"],
  ["savvy-system-health-card", { title: "System" }, "#name"],
  ["savvy-media-card", { area: "living_room" }, "#title"],
  ["savvy-room-activity-card", { area: "living_room" }, "#title"],
  ["savvy-entity-card", { entity: "person.alex", name: "Alex" }, "#name"],
  ["savvy-climate-card", { entity: "climate.living_room_ac" }, "#name"],
  ["savvy-vacuum-card", { entity: "vacuum.robot" }, "#name"],
  ["savvy-camera-card", { area: "living_room", title: "Cameras" }, ".sv-ttl-t"],
  ["savvy-home-header-card", { title: "Home" }, ".sv-ttl-t"],
  ["savvy-room-header-card", { area: "living_room", title: "Living room" }, ".sv-ttl-t"],
];

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 520], ["light", 360]]) {
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(() => {
      history.replaceState({}, "", "/lovelace/start");
      window.nav = [];
      window.addEventListener("location-changed", () => window.nav.push(location.pathname));
    });

    for (const [type, cfg, sel] of CARDS) {
      const tag = `[${theme} ${width}] ${type}`;
      // ---- off by default: with no title_path nothing is a link
      const off = await page.evaluate(async ({ type, cfg, width }) => {
        window.cards.length = 0;
        document.getElementById("stage").replaceChildren();
        const el = window.mount(type, cfg, width);
        await new Promise((r) => setTimeout(r, 700));
        const R = el.shadowRoot;
        return { links: R.querySelectorAll("[data-tlink]").length };
      }, { type, cfg, width });
      check(`${tag}: no title link by default`, off.links === 0, JSON.stringify(off));

      // a title line only appears when a title is set (cards that show no name of their own)
      if (sel === ".sv-ttl-t") {
        const bare = await page.evaluate(async ({ type, cfg, width }) => {
          const { title, ...rest } = cfg;
          document.getElementById("stage").replaceChildren(); window.cards.length = 0;
          const el = window.mount(type, rest, width);
          await new Promise((r) => setTimeout(r, 500));
          return el.shadowRoot.querySelectorAll(".sv-ttl").length;
        }, { type, cfg, width });
        check(`${tag}: no title, no line`, bare === 0, String(bare));
      }

      // ---- with title_path: only the words are the link
      const on = await page.evaluate(async ({ type, cfg, sel, width, PATH }) => {
        document.getElementById("stage").replaceChildren(); window.cards.length = 0;
        window.nav.length = 0; window.log.length = 0;
        const el = window.mount(type, { ...cfg, title_path: PATH }, width);
        await new Promise((r) => setTimeout(r, 800));
        const R = el.shadowRoot, link = R.querySelector("[data-tlink]"), card = R.querySelector("ha-card").getBoundingClientRect();
        if (!link) return { none: true };
        const b = link.getBoundingClientRect();
        return { role: link.getAttribute("role"), tab: link.getAttribute("tabindex"), isTitle: link.matches(sel) || !!link.closest(sel), w: Math.round(b.width), cw: Math.round(card.width),
          x: b.x + b.width / 2, y: b.y + b.height / 2, text: link.textContent.trim(), cardRight: card.right, cardBottom: card.bottom, only: R.querySelectorAll("[data-tlink]").length };
      }, { type, cfg, sel, width, PATH });
      check(`${tag}: title_path makes the title a link`, !on.none && on.role === "link" && on.tab === "0" && on.only === 1 && on.isTitle, JSON.stringify(on));
      if (on.none) continue;
      check(`${tag}: the link is the words, not the row (${on.w}px of ${on.cw}px)`, on.w < on.cw - 40, JSON.stringify(on));

      // pressing the card anywhere else does not navigate
      await page.mouse.click(on.cardRight - 6, on.cardBottom - 6);
      await page.waitForTimeout(450);
      const body = await page.evaluate(() => ({ nav: [...window.nav] }));
      check(`${tag}: pressing the card away from the title goes nowhere`, body.nav.length === 0, JSON.stringify(body));

      // pressing the words goes to the page, and does not also do the card's own thing
      await page.evaluate(() => { window.log.length = 0; });
      await page.mouse.click(on.x, on.y);
      await page.waitForTimeout(600);
      const hit = await page.evaluate(() => ({ nav: [...window.nav], calls: [...window.log], sheet: !!window.__savvy.portalRoot().querySelector(".sv-sheet") }));
      check(`${tag}: pressing the title goes to the page`, hit.nav.at(-1) === PATH && hit.nav.length === 1, JSON.stringify(hit));
      check(`${tag}: ...and does nothing else (no service call, no popup)`, hit.calls.length === 0 && !hit.sheet, JSON.stringify(hit));

      // already on that page: nothing happens
      await page.evaluate(() => { history.replaceState({}, "", "/lovelace/start"); window.nav.length = 0; });
      const same = await page.evaluate(async ({ type, cfg, width }) => {
        document.getElementById("stage").replaceChildren(); window.cards.length = 0;
        const el = window.mount(type, { ...cfg, title_path: location.pathname }, width);
        await new Promise((r) => setTimeout(r, 700));
        const b = el.shadowRoot.querySelector("[data-tlink]").getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }, { type, cfg, width });
      await page.mouse.click(same.x, same.y);
      await page.waitForTimeout(500);
      check(`${tag}: the page already open is a no-op`, (await page.evaluate(() => window.nav.length)) === 0);

      // keyboard
      await page.evaluate(async ({ type, cfg, width, PATH }) => {
        document.getElementById("stage").replaceChildren(); window.cards.length = 0; window.nav.length = 0;
        const el = window.mount(type, { ...cfg, title_path: PATH }, width);
        await new Promise((r) => setTimeout(r, 700));
        el.shadowRoot.querySelector("[data-tlink]").focus();
      }, { type, cfg, width, PATH });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      check(`${tag}: Enter on the focused title goes to the page`, (await page.evaluate(() => window.nav.at(-1))) === PATH);
      await page.evaluate(() => { history.replaceState({}, "", "/lovelace/start"); });
    }

    // ---- the settings card takes a title, with no link
    const st = await page.evaluate(async (width) => {
      document.getElementById("stage").replaceChildren(); window.cards.length = 0;
      const a = window.mount("savvy-settings-card", {}, width), b = window.mount("savvy-settings-card", { title: "Defaults" }, width);
      await new Promise((r) => setTimeout(r, 400));
      return [a.shadowRoot.getElementById("name").textContent, b.shadowRoot.getElementById("name").textContent, b.shadowRoot.querySelectorAll("[data-tlink]").length];
    }, width);
    check(`[${theme} ${width}] settings card: its name by default, a title when set, never a link`, st[0] === "Savvy settings" && st[1] === "Defaults" && st[2] === 0, JSON.stringify(st));

    // ---- the section title already links its name: title_path is another way to say navigation_path
    const sec = await page.evaluate(async ({ width, PATH }) => {
      window.nav.length = 0; document.getElementById("stage").replaceChildren(); window.cards.length = 0;
      const el = window.mount("savvy-section-title-card", { area: "living_room", title_path: PATH }, width);
      await new Promise((r) => setTimeout(r, 700));
      const t = el.shadowRoot.getElementById("title"), b = t.getBoundingClientRect();
      return { role: t.getAttribute("role"), x: b.x + 6, y: b.y + b.height / 2 };
    }, { width, PATH });
    await page.mouse.click(sec.x, sec.y);
    await page.waitForTimeout(500);
    check(`[${theme} ${width}] section title: title_path links the name`, sec.role === "button" && (await page.evaluate(() => window.nav.at(-1))) === PATH, JSON.stringify(sec));

    check(`[${theme} ${width}] springs idle`, await idle(page));
    check(`[${theme} ${width}] no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- editors: a title link on every card; a title where the card has no name of its own
  const { page, errors } = await openPage(browser, base, {});
  const NEEDS_TITLE = ["savvy-camera-card", "savvy-home-header-card", "savvy-room-header-card", "savvy-settings-card"];
  const EDIT = [...CARDS.map(([t, c]) => [t, c]), ["savvy-settings-card", {}]];
  for (const [type, cfg] of EDIT) {
    const got = await page.evaluate(async ({ type, cfg }) => {
      const tag = type === "savvy-settings-card" ? "savvy-settings-card-editor" : `${type}-editor`;
      const ed = document.createElement(tag);
      document.body.appendChild(ed);
      ed.setConfig({ type: `custom:${type}`, ...cfg });
      ed.hass = window.hass;
      await new Promise((r) => setTimeout(r, 80));
      const fields = [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => ({ name: f.dataset.name, sel: f.dataset.selector }));
      ed.remove();
      return fields;
    }, { type, cfg });
    const names = got.map((f) => f.name);
    if (type !== "savvy-settings-card") check(`${type} editor: "Title link" is there, with HA's page picker`, got.some((f) => f.name === "title_path" && f.sel === "navigation"), JSON.stringify(names));
    if (NEEDS_TITLE.includes(type)) check(`${type} editor: a Title field`, names.includes("title"), JSON.stringify(names));
  }
  check("editors: no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
