// What a row says at its end: an unreachable lamp shows a small offline mark, not a word (its label still says
// "Unavailable"), and a lamp with no level (one that only switches, its brightness empty) says On, never 0%.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const layout of ["full", "compact"]) {
    const tag = `[${layout}]`;
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
    await page.evaluate(() => {
      const A = (id) => window.hass.states[id].attributes;
      window.setStates({
        "light.living_room_floor_lamp": { state: "unavailable", attributes: A("light.living_room_floor_lamp") },
        // an on/off lamp just switched on after being off: Home Assistant leaves brightness null
        "light.living_room_strip": { state: "on", attributes: { ...A("light.living_room_strip"), supported_color_modes: ["onoff"], color_mode: "onoff", brightness: null } },
      });
    });
    await page.evaluate((layout) => window.mount("savvy-lights-card", { area: "living_room", layout }, 460), layout);
    await page.waitForTimeout(900);
    const rows = await page.evaluate(() => Object.fromEntries([...window.cards[0].shadowRoot.querySelectorAll(".light")].map((n) => {
      const g = n.querySelector(".gone"), d = n.querySelector(".d");
      return [n.__entity, { icon: !g.hidden && g.getBoundingClientRect().width > 0, word: d.hidden ? "" : d.textContent, label: n.getAttribute("aria-label") }];
    })));
    const off = rows["light.living_room_floor_lamp"], strip = rows["light.living_room_strip"];
    check(`${tag} an unavailable lamp shows the offline mark and no word`, off.icon && off.word === "", JSON.stringify(off));
    check(`${tag} its label still says it is unavailable`, /Unavailable/.test(off.label), off.label);
    check(`${tag} a lamp with no brightness says On, not 0%`, strip.word === "On" && !strip.icon, JSON.stringify(strip));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
