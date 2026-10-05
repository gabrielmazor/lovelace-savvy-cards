// savvy-entity-card: the main tap does what the entity does; navigation_path still wins; hold is more-info.
import { openPage, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 320 });
  await page.evaluate(() => {
    window.mount("savvy-entity-card", { entity: "switch.living_room_plug" }, 320);
    window.mount("savvy-entity-card", { entity: "switch.living_room_plug", navigation_path: "/lovelace/x" }, 320);
    window.mount("savvy-entity-card", { entity: "person.alex" }, 320);
    window.mount("savvy-entity-card", { entity: "switch.living_room_plug", tap_action: { action: "more-info" } }, 320);
    window.info = []; window.nav = [];
    document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
    window.addEventListener("location-changed", () => window.nav.push(location.pathname));
  });
  await page.waitForTimeout(400);
  const tap = async (i) => { await page.mouse.click(...Object.values(await centerOf(page, i, "#name"))); await page.waitForTimeout(250); };
  await page.evaluate(() => { window.log.length = 0; });
  await tap(0);
  const l0 = await page.evaluate(() => [...window.log]);
  check("a tap toggles a switch", l0[0] === "switch.toggle {} switch.living_room_plug", JSON.stringify(l0));
  await page.evaluate(() => { window.log.length = 0; });
  await tap(1);
  const g1 = await page.evaluate(() => ({ log: [...window.log], nav: [...window.nav] }));
  check("navigation_path still navigates instead", g1.nav[0] === "/lovelace/x" && !g1.log.length, JSON.stringify(g1));
  await tap(2);
  await tap(3);
  const info = await page.evaluate(() => [...window.info]);
  check("a person and an explicit more-info open the details", info[0] === "person.alex" && info[1] === "switch.living_room_plug", JSON.stringify(info));
  const p = await centerOf(page, 0, "#name");
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); await page.waitForTimeout(250);
  check("hold opens more-info", (await page.evaluate(() => window.info)).length === 3);
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
