// The home header's lights chip: "N on" while some are on, "All off" when none is (not a bare "Off").
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 520], ["light", 340]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const read = () => page.evaluate(() => {
      const el = window.cards[0].shadowRoot.querySelector("#chips .chip");
      return { text: el.textContent.replace(/\s+/g, " ").trim(), label: el.getAttribute("aria-label") || "" };
    });
    await page.evaluate((width) => window.mount("savvy-home-header-card", { health: false }, width), width);
    await page.waitForTimeout(400);
    const some = await read();
    check(`${tag} some lights on: "N on"`, /^\d+ on\b/.test(some.text.replace(/^Lights\s*/i, "")) || /\d+ on/.test(some.text), JSON.stringify(some));
    await page.evaluate(() => {
      const patch = {};
      for (const id of Object.keys(window.hass.states)) if (id.startsWith("light.")) patch[id] = "off";
      window.setStates(patch);
    });
    await page.waitForTimeout(500);
    const none = await read();
    check(`${tag} no light on: "All off", in the chip and its label`, /All off/.test(none.text) && /All off/.test(none.label) && !/\bOff\b/.test(none.text.replace(/All off/, "")), JSON.stringify(none));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
