// savvy-lights-card on the made-up house.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [520, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const room = window.mount("savvy-lights-card", { area: "living_room", featured: ["light.living_room_ceiling"] }, width);
      const two = window.mount("savvy-lights-card", { area: ["living_room", "kitchen"], title: "Downstairs", show_toggle: false }, width);
      const withEntity = window.mount("savvy-lights-card", { area: "living_room", order: ["light.living_room_strip"],
        toggle: { entity: "input_boolean.movie_mode", name: "Movie" }, chips: [{ entity: "switch.living_room_plug", name: "Plug" }, { name: "Rooms", icon: "mdi:home", navigation_path: "/rooms" }] }, width);
      const legacy = window.mount("savvy-lights-card", { area: "living_room", master: "input_boolean.movie_mode", main: "light.living_room_strip",
        buttons: [{ entity: "switch.living_room_plug" }] }, width);
      const compact = window.mount("savvy-lights-card", { area: "living_room", layout: "compact" }, width);
      await new Promise((res) => setTimeout(res, 500));
      const names = (el) => [...el.shadowRoot.querySelectorAll(".light:not([hidden]) .n, .light:not([hidden]) .name")].map((n) => n.textContent.trim()).filter(Boolean);
      const wide = (el) => [...el.shadowRoot.querySelectorAll(".light[data-wide]")].map((n) => n.__entity);
      return {
        room: { names: names(room), wide: wide(room), title: room.shadowRoot.getElementById("title").textContent, pill: room.shadowRoot.getElementById("masterText").textContent },
        two: { count: two.shadowRoot.querySelectorAll(".light:not([hidden])").length, title: two.shadowRoot.getElementById("title").textContent, pillHidden: two.shadowRoot.getElementById("master").hidden },
        ent: { first: names(withEntity)[0], pill: withEntity.shadowRoot.getElementById("masterText").textContent, chips: [...withEntity.shadowRoot.querySelectorAll(".chip:not([hidden]) span")].map((s) => s.textContent) },
        legacy: { first: names(legacy)[0], wide: wide(legacy), chips: legacy.shadowRoot.querySelectorAll(".chip:not([hidden])").length, pill: legacy.shadowRoot.getElementById("masterText").textContent },
        compactH: compact.getBoundingClientRect().height, roomH: room.getBoundingClientRect().height,
      };
    }, width);
    check(`${tag} discovers the area's lights (device-area ones too), prefix stripped, by name`,
      JSON.stringify(r.room.names) === JSON.stringify(["Ceiling", "Floor Lamp", "Strip"]) && r.room.title === "Living Room", JSON.stringify(r.room));
    check(`${tag} featured light gets the wide tile`, JSON.stringify(r.room.wide) === JSON.stringify(["light.living_room_ceiling"]), JSON.stringify(r.room.wide));
    check(`${tag} built-in pill says what the lights are doing`, r.room.pill === "Lights on");
    check(`${tag} several areas, one card; the pill can be hidden`, r.two.count === 4 && r.two.title === "Downstairs" && r.two.pillHidden, JSON.stringify(r.two));
    check(`${tag} order leads; an entity in the pill; chips`, r.ent.first === "Strip" && r.ent.pill === "Movie" && JSON.stringify(r.ent.chips) === JSON.stringify(["Plug", "Rooms"]), JSON.stringify(r.ent));
    check(`${tag} pre-Savvy master / main / buttons still work`, r.legacy.first === "Strip" && JSON.stringify(r.legacy.wide) === JSON.stringify(["light.living_room_strip"]) && r.legacy.chips === 1 && r.legacy.pill === "Lights off", JSON.stringify(r.legacy));
    check(`${tag} layout: compact is shorter`, r.compactH < r.roomH, `${r.compactH} vs ${r.roomH}`);

    // gestures: the built-in pill turns everything off (some are on)
    const calls = async (fn) => { await page.evaluate(() => { window.log.length = 0; }); await fn(); await page.waitForTimeout(400); return page.evaluate(() => [...window.log]); };
    const tap = async (i, sel) => { const p = await centerOf(page, i, sel); await page.mouse.click(p.x, p.y); };
    const c1 = await calls(() => tap(0, "#master"));
    check(`${tag} built-in pill: a tap turns the card's lights off`, c1.length === 1 && c1[0].startsWith("light.turn_off") && c1[0].includes("3 entities"), c1.join(" | "));
    // an entity in the pill: tap toggles it (after the double-tap window), double tap forces all off
    const c2 = await calls(() => tap(2, "#master"));
    check(`${tag} pill entity: a tap toggles it`, c2.length === 1 && c2[0].startsWith("input_boolean.toggle") && c2[0].includes("input_boolean.movie_mode"), c2.join(" | "));
    const c3 = await calls(async () => { const p = await centerOf(page, 2, "#master"); await page.mouse.click(p.x, p.y); await page.waitForTimeout(60); await page.mouse.click(p.x, p.y); });
    check(`${tag} pill entity: a double tap forces every light off`, c3.length === 1 && c3[0].startsWith("light.turn_off"), c3.join(" | "));
    // chips: a switch toggles; a navigation chip navigates; hold opens more-info
    await page.evaluate(() => { window.moreInfo = []; document.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId)); window.__nav = []; window.addEventListener("location-changed", () => window.__nav.push(location.pathname)); });
    const c4 = await calls(() => tap(2, ".chip"));
    check(`${tag} chip: tap toggles the switch`, c4[0]?.startsWith("switch.toggle"), c4.join(" | "));
    const nav = await page.evaluate(async () => { const chip = [...window.cards[2].shadowRoot.querySelectorAll(".chip")][1]; const r = chip.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(nav.x, nav.y); await page.waitForTimeout(100);
    const p0 = await centerOf(page, 2, ".chip");
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(100);
    const navd = await page.evaluate(() => ({ nav: window.__nav, info: window.moreInfo }));
    check(`${tag} chip: navigation, and hold opens more-info`, navd.nav.includes("/rooms") && navd.info.includes("switch.living_room_plug"), JSON.stringify(navd));
    await page.evaluate(() => history.replaceState(null, "", "/test/page.html"));
    // hold the built-in pill: the list of the card's lights
    const pp = await centerOf(page, 0, "#master");
    await page.mouse.move(pp.x, pp.y); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(500);
    const listed = await page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-row .sv-name")].map((n) => n.textContent));
    check(`${tag} hold the pill: the list of its lights`, listed.length === 3, JSON.stringify(listed));
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);

    if (width === 520) await shot(page, `lights-${theme}`, 2);
    check(`${tag} springs idle`, await idle(page, 6000));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // editor: every option; the order list starts as the discovered order
  const { page } = await openPage(browser, base, {});
  const ed = await page.evaluate(async () => {
    const el = document.createElement("savvy-lights-card-editor");
    document.body.appendChild(el);
    el.hass = window.hass;
    el.setConfig({ type: "custom:savvy-lights-card", area: "living_room" });
    await new Promise((r) => setTimeout(r, 80));
    const fields = [...el.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
    const lists = [...el.shadowRoot.querySelectorAll("savvy-list-editor")];
    const order = lists[0].shadowRoot.querySelectorAll(".sv-item .t");
    const shown = [...el.shadowRoot.querySelectorAll("ha-form")][0].data;
    const changes = [];
    el.addEventListener("config-changed", (e) => changes.push(e.detail.config));
    lists[0].shadowRoot.querySelectorAll('[data-a="down"]')[0].click();
    return { fields, order: [...order].map((t) => t.firstChild.textContent), shown: { show_header: shown.show_header, state_detail: shown.state_detail }, change: changes[0] };
  });
  const want = ["area", "title", "layout", "show_header", "show_toggle", "entity", "name", "icon", "tap_action", "double_tap_action", "hold_action", "featured", "exclude", "columns", "power_button", "state_detail", "color_background"];
  check("editor exposes every option", want.every((w) => ed.fields.includes(w)), "missing: " + JSON.stringify(want.filter((w) => !ed.fields.includes(w))));
  check("editor shows defaults (header and brightness detail on)", ed.shown.show_header === true && ed.shown.state_detail === true, JSON.stringify(ed.shown));
  check("editor: order starts as the discovered lights; reordering writes order", ed.order.length === 3
    && JSON.stringify(ed.change?.order) === JSON.stringify(["light.living_room_floor_lamp", "light.living_room_ceiling", "light.living_room_strip"])
    && !("show_header" in ed.change), JSON.stringify(ed));
  await page.close();
}
