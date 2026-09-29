// savvy-entity-card on the made-up house.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [320, 220]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-entity-card", { entity: "person.alex", chips: [
        { entity: "switch.living_room_plug", name: "Plug", icon: "mdi:power-plug", color: "blue" },
        { entity: "sensor.alex_phone_battery", name: "Phone" },
        { entity: "button.robot_vacuum", name: "Vacuum" },
        { navigation_path: "/lovelace/people", name: "More" }] }, width);
      window.mount("savvy-entity-card", { entity: "person.sam" }, width);
      // the pre-Savvy shape: `entities`, and the string shorthands
      window.mount("savvy-entity-card", { entity: "script.good_night", tap_action: "turn_on", entities: [{ entity: "switch.living_room_plug", tap_action: "more-info" }] }, width);
      await new Promise((res) => setTimeout(res, 500));
      const read = (el) => {
        const R = el.shadowRoot;
        return { name: R.getElementById("name").textContent, st: R.getElementById("st").textContent, since: R.getElementById("since").textContent,
          ini: R.querySelector(".ini")?.textContent || null, zone: R.querySelector(".zone ha-icon")?.getAttribute("icon") || null,
          pills: [...R.querySelectorAll(".pill")].map((p) => `${p.dataset.kind}:${p.querySelector(".cn").textContent}|${p.querySelector(".cv").textContent}`) };
      };
      return window.cards.map(read);
    }, width);
    const [alex, sam, script] = r;
    check(`${tag} a person: initials, zone, "Home · for 3 h"`, alex.name === "Alex" && alex.ini === "A" && alex.zone === "mdi:home" && alex.st === "Home" && alex.since === "for 3 h", JSON.stringify(alex));
    check(`${tag} in a zone: its name and icon`, sam.st === "Work" && sam.zone === "mdi:briefcase" && sam.ini === "SR", JSON.stringify(sam));
    check(`${tag} chips by what they are: toggle, value, press, navigation`, JSON.stringify(alex.pills) === JSON.stringify(
      ["toggle:Plug|On", "value:Phone|64", "press:|Vacuum", "nav:|More"]), JSON.stringify(alex.pills));
    check(`${tag} the pre-Savvy shape: entities and string actions`, script.st === "Never run" || script.st === "Last run", JSON.stringify(script));
    check(`${tag} ...a chip set to more-info shows its value`, script.pills[0] === "value:|On", JSON.stringify(script.pills));

    // gestures: the toggle flips at once; the button presses; nav navigates; hold opens more-info
    await page.evaluate(() => { window.info = []; window.nav = []; document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
      window.addEventListener("location-changed", () => window.nav.push(location.pathname)); window.log.length = 0; });
    const pill = (i, k) => page.evaluate(({ i, k }) => { const n = window.cards[i].shadowRoot.querySelectorAll(".pill")[k]; n.scrollIntoView({ block: "nearest", inline: "nearest" }); const b = n.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, { i, k });
    await page.mouse.click(...await pill(0, 0));
    await page.waitForTimeout(100);
    const optimistic = await page.evaluate(() => window.cards[0].shadowRoot.querySelectorAll(".pill .cv")[0].textContent);
    await page.mouse.click(...await pill(0, 2));
    await page.mouse.click(...await pill(0, 3));
    await page.mouse.click(...Object.values(await centerOf(page, 0, "#name")));
    const p1 = await pill(0, 1);
    await page.mouse.move(...p1); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
    await page.mouse.click(...Object.values(await centerOf(page, 2, "#name")));
    await page.waitForTimeout(300);
    const g = await page.evaluate(() => ({ log: [...window.log], info: [...window.info], nav: [...window.nav],
      fired: window.cards[2].shadowRoot.getElementById("st").textContent }));
    check(`${tag} the toggle flips at once, before HA answers`, optimistic === "Off" && g.log[0] === "switch.toggle {} switch.living_room_plug", JSON.stringify([optimistic, g.log]));
    check(`${tag} a button presses, a navigation chip navigates`, g.log[1] === "button.press {} button.robot_vacuum" && g.nav[0] === "/lovelace/people", JSON.stringify(g));
    check(`${tag} the main entity opens more-info; hold on a chip too`, g.info[0] === "person.alex" && g.info[1] === "sensor.alex_phone_battery", JSON.stringify(g.info));
    check(`${tag} a script run from the card says "Running" for a moment`, g.log[2] === "script.turn_on {} script.good_night" && g.fired === "Running", JSON.stringify(g));

    if (width === 320) await shot(page, `entity-${theme}`, 0);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
