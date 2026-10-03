// The lights tile changes colour as one move: its orb box, its icon and the tile follow the same
// clock (the icon used to stay on the old colour until the last frame), it settles in about a third
// of a second, and a tap shows its result at once, moving back if Home Assistant never follows.
import { openPage, idle, afterChange, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [520, 340]) {
    const tag = `[lights tint ${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate((width) => { window.mount("savvy-lights-card", { area: "living_room" }, width); }, width);
    await page.waitForTimeout(800);
    const read = () => {
      const R = window.cards[0].shadowRoot, o = [...R.querySelectorAll(".light:not([hidden]) .orb")][0], ic = o.querySelector("ha-icon");
      const c = (e) => getComputedStyle(e).color;
      return { t: performance.now(), orb: c(o), icon: c(ic), bg: getComputedStyle(o).backgroundColor };
    };
    const run = await afterChange(page, () => {
      window.setStates(Object.fromEntries(Object.keys(window.hass.states).filter((k) => k.startsWith("light.living_room")).map((k) => [k, "off"])));
    }, read, 1000);
    const t0 = run[0].t;
    const startOrb = run[0].orb, startIcon = run[0].icon;
    const moved = (key, start) => run.findIndex((s) => s[key] !== start);
    const iMoved = moved("icon", startIcon), oMoved = moved("orb", startOrb);
    check(`${tag} the icon starts moving with the orb (not at the end)`, iMoved >= 0 && oMoved >= 0 && Math.abs(run[iMoved].t - run[oMoved].t) < 60, `${iMoved} ${oMoved}`);
    const endT = run.findIndex((s, i) => i && run.slice(i).every((x) => x.orb === run.at(-1).orb && x.icon === run.at(-1).icon && x.bg === run.at(-1).bg));
    check(`${tag} orb, icon and tile settle together in about a third of a second`, endT > 0 && run[endT].t - t0 < 520, `${endT >= 0 ? Math.round(run[endT].t - t0) : "never"} ms`);
    check(`${tag} the icon is not parked on the old colour while the orb moves`, run.filter((s) => s.icon === startIcon).length < run.length * 0.2, `${run.filter((s) => s.icon === startIcon).length}/${run.length}`);
    check(`${tag} settles, no errors`, (await idle(page)) && errors.length === 0, errors.join(" | "));

    // a tap shows its result at once, and moves back when the house never follows
    await page.evaluate((width) => {
      window.setStates(Object.fromEntries(Object.keys(window.hass.states).filter((k) => k.startsWith("light.living_room")).map((k) => [k, "on"])));
      window.mount("savvy-lights-card", { area: "living_room" }, width);
    }, width);
    await page.waitForTimeout(800);
    const idx = await page.evaluate(() => window.cards.length - 1);
    const lit = () => page.evaluate((i) => window.cards[i].shadowRoot.querySelectorAll(".light:not([hidden]) .orb[data-on]").length, idx);
    const before = await lit();
    const p = await centerOf(page, idx, ".light:not([hidden]) .orb");
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    const soon = await lit();
    check(`${tag} a tap flips the tile at once, before Home Assistant answers`, before > 0 && soon === before - 1, `${before} -> ${soon}`);
    await page.waitForTimeout(2300);
    const later = await lit();
    check(`${tag} with no answer from the house, the tile moves back after two seconds`, later === before, `${before} -> ${later}`);
    check(`${tag} springs idle, no errors`, (await idle(page)) && errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
