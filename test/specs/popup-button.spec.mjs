// The home header's popups: a pinned page button under the list, taken from the chip's
// navigation_path or from the page its tap or hold action navigates to. navigation_path never
// changes what a tap does: tap and hold open the list unless tap_action / hold_action say otherwise.
import { openPage, idle, centerOf } from "./_util.mjs";

const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };
const GO = `(() => { const g = window.__savvy.portalRoot().querySelector(".sv-sheet .sv-go"); return g ? { text: g.querySelector("span").textContent, parent: g.parentElement.className, sheetParent: g.closest(".sv-sheet") !== null } : null; })()`;

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 560], ["light", 360]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate((width) => {
      window.nav = [];
      window.addEventListener("location-changed", () => window.nav.push(location.pathname));
      window.mount("savvy-home-header-card", {
        health: { navigation_path: "/lovelace/admin" },
        lights: { navigation_path: "/lovelace/lights" },
        climate: { tap_action: { action: "navigate", navigation_path: "/lovelace/climate" }, popup_label: "Go to climate" },
        media: { hold_action: { action: "navigate", navigation_path: "/lovelace/media" } },
        security: { name: "Doors" },
      }, width);
      window.mount("savvy-home-header-card", { lights: { navigation_path: "/lovelace/lights", popup_button: false }, health: false }, width);
      // an explicit tap_action replaces the tap; the button still follows navigation_path
      window.mount("savvy-home-header-card", {
        health: { navigation_path: "/lovelace/admin", popup_button: true, tap_action: { action: "navigate", navigation_path: "/lovelace/admin-tap" } },
        lights: { navigation_path: "/lovelace/lights", tap_action: { action: "navigate", navigation_path: "/lovelace/lights-tap" } },
      }, width);
      // the cog's page button is off unless asked for
      window.mount("savvy-home-header-card", { health: { navigation_path: "/lovelace/admin", popup_button: true }, lights: false, climate: false, media: false, security: false }, width);
    }, width);
    await page.waitForTimeout(500);
    const chip = (card, i) => page.evaluate(({ card, i }) => { const r = window.cards[card].shadowRoot.querySelectorAll("#chips .chip")[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { card, i });
    const close = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(450); };

    // lights: navigation_path is the target of the button; hold lists
    await hold(page, await chip(0, 0));
    await page.waitForTimeout(500);
    const lights = await page.evaluate(GO);
    check(`${tag} the popup has a page button: "Open lights", pinned outside the scrolling list`, lights?.text === "Open lights" && lights.parent === "sv-foot" && lights.sheetParent, JSON.stringify(lights));
    const geo = await page.evaluate(() => { const r = window.__savvy.portalRoot(); const sh = r.querySelector(".sv-sheet").getBoundingClientRect(), g = r.querySelector(".sv-go").getBoundingClientRect(), b = r.querySelector(".sv-body").getBoundingClientRect();
      return { gap: Math.round(sh.bottom - g.bottom), below: g.top >= b.bottom - 1, wide: Math.round(g.width / sh.width * 100) }; });
    check(`${tag} the button sits under the list, near the bottom, nearly full width`, geo.below && geo.gap >= 0 && geo.gap <= 34 && geo.wide >= 88, JSON.stringify(geo));
    const go = await page.evaluate(() => { const g = window.__savvy.portalRoot().querySelector(".sv-go").getBoundingClientRect(); return { x: g.x + g.width / 2, y: g.y + g.height / 2 }; });
    await page.mouse.click(go.x, go.y);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ nav: [...window.nav], open: window.__savvy.portalRoot().querySelectorAll(".sv-sheet").length }));
    check(`${tag} tapping it navigates and closes the popup`, after.nav.at(-1) === "/lovelace/lights" && after.open === 0, JSON.stringify(after));

    // a tap on the chip opens the list too: a target page does not make it navigate
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(...Object.values(await chip(0, 0)));
    await page.waitForTimeout(500);
    const tapped = await page.evaluate((GO) => ({ nav: [...window.nav], go: eval(GO)?.text ?? null }), GO);
    check(`${tag} a tap on a chip with a target page still opens the list; it does not navigate`, tapped.nav.length === 0 && tapped.go === "Open lights", JSON.stringify(tapped));
    await close();

    // climate: the target comes from its tap_action; the label is its own
    await hold(page, await chip(0, 1));
    await page.waitForTimeout(500);
    const climate = await page.evaluate(GO);
    check(`${tag} the target can be the page its tap action navigates to; the label can be set`, climate?.text === "Go to climate", JSON.stringify(climate));
    await close();

    // media: hold navigates, so the popup is the tap's, and the button leads where hold goes
    await page.mouse.click(...Object.values(await chip(0, 2)));
    await page.waitForTimeout(500);
    const media = await page.evaluate(GO);
    check(`${tag} the target can be the page its hold action navigates to`, media?.text === "Open media", JSON.stringify(media));
    const mgo = await page.evaluate(() => { const g = window.__savvy.portalRoot().querySelector(".sv-go").getBoundingClientRect(); return { x: g.x + g.width / 2, y: g.y + g.height / 2 }; });
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(mgo.x, mgo.y);
    await page.waitForTimeout(500);
    check(`${tag} that button navigates there`, (await page.evaluate(() => [...window.nav])).at(-1) === "/lovelace/media");

    // security has no target page: no button
    await hold(page, await chip(0, 3));
    await page.waitForTimeout(500);
    check(`${tag} no target page, no button`, (await page.evaluate(GO)) === null);
    await close();

    // popup_button: false hides it
    await hold(page, await chip(1, 0));
    await page.waitForTimeout(500);
    check(`${tag} popup_button: false hides it`, (await page.evaluate(GO)) === null);
    await close();

    // the cog: a tap opens the health popup too, whatever its navigation_path
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(...Object.values(await centerOf(page, 0, "#health")));
    await page.waitForTimeout(600);
    const cogTap = await page.evaluate((GO) => ({ nav: [...window.nav], go: eval(GO)?.text ?? null, title: window.__savvy.portalRoot().querySelector(".sv-sheet .sv-title")?.textContent }), GO);
    check(`${tag} a tap on the cog opens the health popup; navigation_path does not navigate`, cogTap.nav.length === 0 && cogTap.go === null && cogTap.title === "System health", JSON.stringify(cogTap));
    await close();

    // explicit tap_action: the tap navigates, hold still lists, and the button follows navigation_path
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(...Object.values(await chip(2, 0)));
    await page.waitForTimeout(300);
    check(`${tag} an explicit tap_action navigates on tap`, (await page.evaluate(() => [...window.nav]))[0] === "/lovelace/lights-tap" && (await page.evaluate(GO)) === null);
    await hold(page, await chip(2, 0));
    await page.waitForTimeout(500);
    const ex = await page.evaluate(GO);
    check(`${tag} ...hold still opens the list, whose button leads to navigation_path (not the tap's page)`, ex?.text === "Open lights", JSON.stringify(ex));
    await page.evaluate(() => { window.nav.length = 0; });
    await page.evaluate(() => window.__savvy.portalRoot().querySelector(".sv-go").click());
    await page.waitForTimeout(500);
    check(`${tag} ...and that button goes to navigation_path`, (await page.evaluate(() => [...window.nav])).at(-1) === "/lovelace/lights");
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(...Object.values(await centerOf(page, 2, "#health")));
    await page.waitForTimeout(300);
    check(`${tag} the cog's explicit tap_action navigates on tap`, (await page.evaluate(() => [...window.nav]))[0] === "/lovelace/admin-tap");
    await hold(page, await centerOf(page, 2, "#health"));
    await page.waitForTimeout(600);
    check(`${tag} ...and its hold opens the health popup, button to navigation_path`, (await page.evaluate(GO))?.text === "Open system health");
    await page.evaluate(() => { window.nav.length = 0; });
    await page.evaluate(() => window.__savvy.portalRoot().querySelector(".sv-go").click());
    await page.waitForTimeout(500);
    check(`${tag} ...which goes to /lovelace/admin`, (await page.evaluate(() => [...window.nav])).at(-1) === "/lovelace/admin");

    // the cog's popup: no page button by default, one when popup_button is on
    await hold(page, await centerOf(page, 0, "#health"));
    await page.waitForTimeout(600);
    check(`${tag} the cog's popup has no page button by default, target page or not`, (await page.evaluate(GO)) === null);
    await close();
    await hold(page, await centerOf(page, 3, "#health"));
    await page.waitForTimeout(600);
    const cog = await page.evaluate(GO);
    check(`${tag} popup_button: true gives the cog's popup its button`, cog?.text === "Open system health", JSON.stringify(cog));
    // reachable by keyboard: Tab from the close button reaches it; Enter presses it
    await page.evaluate(() => { window.nav.length = 0; });
    await page.evaluate(() => window.__savvy.portalRoot().querySelector(".sv-go").focus());
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const kb = await page.evaluate(() => ({ nav: [...window.nav], open: window.__savvy.portalRoot().querySelectorAll(".sv-sheet").length }));
    check(`${tag} the button works from the keyboard`, kb.nav.at(-1) === "/lovelace/admin" && kb.open === 0, JSON.stringify(kb));
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
