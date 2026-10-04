// System health: `categories` picks which sections show and in what order (Dismissed last unless placed),
// and each section's summary line sits under its title, in full.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 420, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
      window.__savvy.resetDismissed();
      const mk = (cfg) => window.mount("savvy-system-health-card", { watchman: W, columns: 1, ...cfg }, width);
      const def = mk({}), custom = mk({ categories: ["battery", "watchman"] }), withDismissed = mk({ categories: ["dismissed", "battery"] });
      await new Promise((res) => setTimeout(res, 600));
      // dismiss one battery row so the Dismissed category exists
      const bat = [...window.cards[0].shadowRoot.querySelectorAll(".row .x:not([hidden])")].find((b) => /Battery/.test(b.getAttribute("aria-label")));
      bat?.click();
      await new Promise((res) => setTimeout(res, 700));
      const titles = (c) => [...c.shadowRoot.querySelectorAll(".group .gt")].map((g) => g.textContent);
      const lines = [...def.shadowRoot.querySelectorAll(".group")].map((g) => {
        const t = g.querySelector(".gt").getBoundingClientRect(), w = g.querySelector(".gw");
        const b = w.getBoundingClientRect();
        return { below: b.top >= t.bottom - 1, full: w.scrollWidth <= w.clientWidth + 1, text: w.textContent };
      });
      return { def: titles(def), custom: titles(custom), placed: titles(withDismissed), lines };
    }, width);
    check(`${tag} the default order, Dismissed last`, JSON.stringify(r.def) === JSON.stringify(["Watchman", "Offline devices", "Low batteries", "Dismissed"]), JSON.stringify(r.def));
    check(`${tag} categories picks and orders`, JSON.stringify(r.custom) === JSON.stringify(["Low batteries", "Watchman", "Dismissed"]), JSON.stringify(r.custom));
    check(`${tag} Dismissed can be placed first`, JSON.stringify(r.placed) === JSON.stringify(["Dismissed", "Low batteries"]), JSON.stringify(r.placed));
    check(`${tag} each summary line is under its title and fully readable`, r.lines.length >= 3 && r.lines.filter((l) => l.text).every((l) => l.below && l.full), JSON.stringify(r.lines));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
