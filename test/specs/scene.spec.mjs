// savvy-scene-card on the made-up house: what it finds, how it names, what a tap and a hold do.
import { openPage, idle, shot } from "./_util.mjs";

const TILES = (i) => `[...window.cards[${i}].shadowRoot.querySelectorAll(".tile")]`;

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 220]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const cfgs = [
        { area: "office" },                                                            // 0
        { area: "office", strip: "^.*//\\s*|\\s*-\\s*on$" },                             // 1
        { area: "office", entities: ["scene.party", { entity: "scene.office_work", name: "Deep work", icon: "mdi:brain", color: "amber" }] },   // 2
        { area: "office", auto_discover: false, entities: ["scene.party"] },           // 3
        { area: "office", exclude: ["scene.office_focus"] },                           // 4
        { area: ["office", "living_room"] },                                           // 5
        { area: "empty_room" },                                                        // 6
        {},                                                                            // 7
        { area: "office", layout: "compact" },                                         // 8
        { area: "office", columns: 2 },                                                // 9
        { area: "office", title: "Scenes", navigation_path: "/lovelace/office" },      // 10
        { area: "office", show_icon: false, strip: false },                            // 11
      ];
      cfgs.forEach((c) => window.mount("savvy-scene-card", c, width));
      await new Promise((res) => setTimeout(res, 500));
      const read = (el) => {
        const R = el.shadowRoot, tiles = [...R.querySelectorAll(".tile")];
        return {
          labels: tiles.map((t) => t.querySelector(".nm").textContent),
          icons: tiles.map((t) => t.querySelector("ha-icon")?.getAttribute("icon") || (t.querySelector("ha-state-icon") ? "state" : null)),
          colors: tiles.map((t) => t.style.getPropertyValue("--tc")),
          lefts: [...new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().left)))].length,
          tops: [...new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top)))].length,
          h: tiles[0] ? Math.round(tiles[0].getBoundingClientRect().height) : 0,
          empty: R.getElementById("empty").hidden ? "" : R.getElementById("empty").textContent,
          gridHidden: R.getElementById("grid").hidden,
          compact: R.getElementById("grid").hasAttribute("data-compact"),
          overflow: R.getElementById("grid").hasAttribute("data-overflow"),
          head: R.getElementById("head").hidden ? null : R.getElementById("title").textContent,
          noicon: tiles[0] ? getComputedStyle(tiles[0].querySelector(".ic")).display === "none" : null,
        };
      };
      return window.cards.map(read);
    }, width);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check(`${tag} the area's scenes, the area's name off the front, by name; hidden ones left out`,
      same(r[0].labels, ["Focus - On", "Relax", "Work - On"]), JSON.stringify(r[0].labels));
    check(`${tag} a scene with its own icon shows it; the rest their state icon`, r[0].icons.every((i) => i === "state"), JSON.stringify(r[0].icons));
    check(`${tag} strip: the regex is taken out (any case, every match), then the area's name`,
      same(r[1].labels, ["Focus", "Relax", "Work"]), JSON.stringify(r[1].labels));
    check(`${tag} pinned first and in order, named as written, with their own icon and colour; the area's after`,
      same(r[2].labels, ["Party", "Deep work", "Focus - On", "Relax"]) && r[2].icons[1] === "mdi:brain" && r[2].colors[1].length > 0 && r[2].colors[0] === "",
      JSON.stringify(r[2]));
    check(`${tag} auto_discover: false leaves only the pinned`, same(r[3].labels, ["Party"]), JSON.stringify(r[3].labels));
    check(`${tag} exclude`, same(r[4].labels, ["Relax", "Work - On"]), JSON.stringify(r[4].labels));
    check(`${tag} several areas in one card, each named against its own`,
      same(r[5].labels, ["Evening", "Focus - On", "Movie", "Reading", "Relax", "Work - On"]), JSON.stringify(r[5].labels));
    check(`${tag} an area with no scenes says so`, r[6].empty === "No scenes found in this area." && r[6].gridHidden, JSON.stringify(r[6]));
    check(`${tag} no area chosen: asks for one, no error`, r[7].empty === "Pick an area to list its scenes.", JSON.stringify(r[7]));
    check(`${tag} compact: one row of small pills`, r[8].compact && r[8].tops === 1 && r[8].h === 34, JSON.stringify(r[8]));
    if (width === 220) check(`${tag} compact: a row that doesn't fit scrolls (fades at the edge)`, r[8].overflow, JSON.stringify(r[8]));
    const auto = width >= 300 ? 3 : 2;
    check(`${tag} columns: 2 to 4 by the width (${auto} here); \`columns\` sets it`, r[5].lefts === auto && r[9].lefts === 2, JSON.stringify([r[5].lefts, r[9].lefts]));
    check(`${tag} a title only when asked for`, r[0].head === null && r[10].head === "Scenes", JSON.stringify([r[0].head, r[10].head]));
    check(`${tag} show_icon: false, and strip: false keeps the names whole`,
      r[11].noicon === true && same(r[11].labels, ["Office // Focus - On", "Office // Work - On", "Office Relax"]), JSON.stringify(r[11]));

    // gestures: a tap runs the scene and lights it; hold opens more-info; a title tap navigates
    await page.evaluate(() => { window.info = []; window.nav = []; document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
      window.addEventListener("location-changed", () => window.nav.push(location.pathname)); window.log.length = 0; });
    const at = (i, k) => page.evaluate(({ i, k }) => { const n = window.cards[i].shadowRoot.querySelectorAll(".tile")[k]; n.scrollIntoView({ block: "nearest", inline: "nearest" }); const b = n.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, { i, k });
    await page.mouse.click(...await at(0, 2));                      // Work - On
    await page.waitForTimeout(150);
    const lit = await page.evaluate(() => window.cards[0].shadowRoot.querySelectorAll(".tile")[2].hasAttribute("data-lit"));
    const other = await page.evaluate(() => window.cards[0].shadowRoot.querySelectorAll(".tile")[0].hasAttribute("data-lit"));
    const f = await at(0, 0);                                        // Focus - On: hold
    await page.mouse.move(...f); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
    await page.mouse.click(...await page.evaluate(() => { const b = window.cards[10].shadowRoot.getElementById("head").getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }));
    await page.waitForTimeout(250);
    const g = await page.evaluate(() => ({ log: [...window.log], info: [...window.info], nav: [...window.nav] }));
    check(`${tag} a tap runs the scene, exactly`, g.log[0] === "scene.turn_on {} scene.office_work", JSON.stringify(g.log));
    check(`${tag} ...and lights it (only it) for a moment`, lit && !other, JSON.stringify([lit, other]));
    check(`${tag} hold opens its more-info and runs nothing`, g.info[0] === "scene.office_focus" && g.log.filter((l) => /focus/.test(l)).length === 0, JSON.stringify(g));
    check(`${tag} tapping the title goes to navigation_path`, g.nav.includes("/lovelace/office"), JSON.stringify(g.nav));

    // an unavailable scene is dimmed and does nothing on tap; one that just ran lit by itself
    await page.evaluate(() => { window.log.length = 0; window.setStates({ "scene.office_focus": "unavailable", "scene.office_relax": new Date().toISOString() }); });
    await page.waitForTimeout(200);
    await page.mouse.click(...await at(0, 0));
    const u = await page.evaluate(() => { const t = window.cards[0].shadowRoot.querySelectorAll(".tile"); return { off: t[0].hasAttribute("data-off"), relaxLit: t[1].hasAttribute("data-lit"), log: [...window.log] }; });
    check(`${tag} unavailable: dimmed, and a tap does nothing`, u.off && u.log.length === 0, JSON.stringify(u));
    check(`${tag} a scene run from elsewhere lights up too`, u.relaxLit, JSON.stringify(u));
    if (theme === "dark" && width === 420) {
      await page.waitForTimeout(4400);
      const done = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".tile")].some((t) => t.hasAttribute("data-lit")));
      check(`${tag} the light fades after a few seconds`, !done);
    }
    if (width === 420) {
      await page.evaluate(() => window.setStates({ "scene.office_focus": new Date(Date.now() - 172800000).toISOString() }));
      await shot(page, `scene-${theme}`, 2);
    }
    check(`${tag} springs idle`, await idle(page));
    const real = errors.filter((e) => !/Failed to load resource/.test(e));
    check(`${tag} no errors`, real.length === 0, real.join(" | "));
    await page.close();
  }

  // ---- the editor, and the stub the card picker mounts
  const { page, errors } = await openPage(browser, base, {});
  const ed = await page.evaluate(async () => {
    const el = document.createElement("savvy-scene-card-editor");
    document.body.appendChild(el);
    const changes = [];
    // behave like HA: every config-changed comes straight back as setConfig
    el.addEventListener("config-changed", (e) => { changes.push(e.detail.config); el.setConfig(e.detail.config); });
    el.setConfig({ type: "custom:savvy-scene-card", area: "office" });
    el.hass = window.hass;
    await new Promise((r) => setTimeout(r, 60));
    const fields = [...el.shadowRoot.querySelectorAll(".stub-field")].map((f) => ({ name: f.dataset.name, sel: f.dataset.selector }));
    const lists = [...el.shadowRoot.querySelectorAll("savvy-list-editor")].map((l) => l.dataset.key.replace(/^list:/, ""));
    const forms = el.shadowRoot.querySelectorAll("ha-form");
    forms[0].set("strip", "^.*//\\s*");
    forms[0].set("columns", 2);
    const list = el.shadowRoot.querySelector("savvy-list-editor");
    list.shadowRoot.querySelector("ha-selector").pick("scene.party");
    await new Promise((r) => setTimeout(r, 30));
    list.shadowRoot.querySelector("ha-selector").pick("scene.evening");
    list.shadowRoot.querySelectorAll('[data-a="down"]')[0].click();
    list.shadowRoot.querySelectorAll('[data-a="remove"]')[1].click();
    return { fields, lists, last: changes[changes.length - 1], n: changes.length };
  });
  const names = ed.fields.map((f) => f.name);
  const want = ["area", "title", "layout", "columns", "color", "show_icon", "strip", "navigation_path", "auto_discover", "exclude"];
  const missing = want.filter((w) => !names.includes(w));
  check("editor: every option is there", !missing.length && ed.lists.includes("entities"), `missing ${missing.join(", ")} / ${JSON.stringify(ed.lists)}`);
  check("editor: navigation uses HA's page picker; scenes are picked from scenes",
    ed.fields.find((f) => f.name === "navigation_path")?.sel === "navigation" && ed.fields.find((f) => f.name === "area")?.sel === "area", JSON.stringify(ed.fields));
  check("editor: edits round-trip into config (strip, columns, pinned add / reorder / remove)",
    ed.last.area === "office" && ed.last.strip === "^.*//\\s*" && ed.last.columns === 2
    && JSON.stringify(ed.last.entities) === JSON.stringify([{ entity: "scene.evening" }]), JSON.stringify(ed.last));

  const stub = await page.evaluate(async () => {
    const cfg = customElements.get("savvy-scene-card").getStubConfig(window.hass);
    const el = window.mount("savvy-scene-card", cfg, 400);
    await new Promise((r) => setTimeout(r, 150));
    const none = customElements.get("savvy-scene-card").getStubConfig({ states: {}, entities: {}, devices: {}, areas: {} });
    return { cfg, h: Math.round(el.getBoundingClientRect().height), tiles: el.shadowRoot.querySelectorAll(".tile").length, none };
  });
  check("the card picker's stub: the first area with scenes, and it shows them", stub.cfg.area === "living_room" && stub.tiles === 3 && stub.h > 20, JSON.stringify(stub));
  check("the stub on a house with no scenes is empty (and mounts without an error)", JSON.stringify(stub.none) === "{}");
  const real = errors.filter((e) => !/Failed to load resource/.test(e));
  check("editor and stub: no errors", real.length === 0, real.join(" | "));
  await page.close();
}
