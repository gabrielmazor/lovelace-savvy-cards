// The popups (entity lists, the health list, the mode picker), in a dashboard that wraps
// cards in a transformed, contained box the way Home Assistant's does: the backdrop must
// still cover the page, a tap on it closes and goes no further, a scroll on it closes
// without scrolling the page, and the A/C list's fans turn while a unit runs.
import { openPage, idle } from "./_util.mjs";

const at = (page, i, sel) => page.evaluate(({ i, sel }) => { const b = window.cards[i].shadowRoot.querySelector(sel).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, { i, sel });
const hold = async (page, p) => { await page.mouse.move(...p); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); await page.waitForTimeout(500); };
const openCount = (page) => page.evaluate(() => window.__savvy.portalRoot().querySelectorAll(".sv-sheet, .sv-pick").length);

export default async function ({ browser, base, check }) {
  for (const width of [900, 390]) {
    const tag = `[${width}]`;
    const { page, errors } = await openPage(browser, base, { width: width - 80 });
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((w) => {
      // HA-like: each card in a transformed, contained wrapper; a tall page that scrolls
      const stage = document.getElementById("stage");
      stage.style.cssText = "display:block;padding-bottom:2000px";
      const wrap = (type, cfg) => { const box = document.createElement("div"); box.style.cssText = "transform:translateZ(0);contain:layout;margin-bottom:12px"; stage.appendChild(box); const el = window.mount(type, cfg, w - 60); box.appendChild(el); return el; };
      wrap("savvy-home-card", { mode: "input_select.house_mode", health: { navigation_path: "/lovelace/admin" }, lights: { tap_action: { action: "navigate", navigation_path: "/lovelace/lights" } } });
      wrap("savvy-room-card", { area: "living_room", room_path: "/lovelace/{slug}" });
      window.nav = []; window.addEventListener("location-changed", () => window.nav.push(location.pathname));
      window.scrollTo(0, 40);
    }, width);
    await page.waitForTimeout(400);

    // the lights list: the backdrop covers the whole screen, not just the card
    await hold(page, await at(page, 0, "#chips .chip"));
    const cover = await page.evaluate(() => { const r = window.__savvy.portalRoot().querySelector(".sv-scrim").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), innerWidth, innerHeight]; });
    check(`${tag} the backdrop covers the whole screen, even in a transformed dashboard`, cover[0] === cover[2] && cover[1] === cover[3], JSON.stringify(cover));

    // a tap outside, right on the room card's room chip: closes, and the chip never gets it
    const roomChip = await at(page, 1, "#rooms .chip");
    await page.mouse.click(...roomChip);
    await page.waitForTimeout(600);
    const tap = await page.evaluate(() => ({ nav: [...window.nav] }));
    check(`${tag} a tap outside closes the popup and presses nothing underneath`, (await openCount(page)) === 0 && tap.nav.length === 0, JSON.stringify(tap));

    // a scroll on the backdrop: closes it, and the page doesn't move
    await hold(page, await at(page, 0, "#chips .chip"));
    const y0 = await page.evaluate(() => scrollY);
    await page.mouse.move(...roomChip);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(600);
    const y1 = await page.evaluate(() => scrollY);
    check(`${tag} a scroll on the backdrop closes the popup without scrolling the page`, (await openCount(page)) === 0 && y0 === y1, `${y0} -> ${y1}`);

    // a scroll inside a short list doesn't reach the page either
    await hold(page, await at(page, 0, "#chips .chip"));
    const inside = await page.evaluate(() => { const r = window.__savvy.portalRoot().querySelector(".sv-body").getBoundingClientRect(); return [r.x + r.width / 2, r.y + 20]; });
    await page.mouse.move(...inside);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    const y2 = await page.evaluate(() => scrollY);
    check(`${tag} scrolling inside the popup never scrolls the page`, y2 === y0 && (await openCount(page)) === 1, `${y0} -> ${y2}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // the climate list: the running unit's fan turns, the idle one's doesn't
    await hold(page, await at(page, 0, "#chips .chip:nth-child(2)"));
    const angles = async () => page.evaluate(() => Object.fromEntries([...window.__savvy.portalRoot().querySelectorAll(".sv-row")].map((r) => [`${r.querySelector(".sv-sub").textContent} ${r.querySelector(".sv-name").textContent}`, r.querySelector(".sv-ic > *").style.transform || "none"])));
    const a1 = await angles();
    await page.waitForTimeout(400);
    const a2 = await angles();
    const icons = await page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-row .sv-ic ha-icon")].map((i) => i.getAttribute("icon")));
    check(`${tag} climate list: fan icons; the running unit's fan turns`, icons.length === 3 && icons.every((i) => i === "mdi:fan") && a1["Living Room AC"] !== a2["Living Room AC"] && a2["Living Room AC"] !== "none", JSON.stringify([a1, a2]));
    check(`${tag} ...and a unit that's off stays still`, a2["Living Room Heater"] === "none" && a2["Bedroom AC"] === "none", JSON.stringify(a2));
    await page.evaluate(() => window.setStates({ "climate.living_room_ac": { state: "off", attributes: { ...window.house.states["climate.living_room_ac"].attributes, hvac_action: "off" } } }));
    await page.waitForTimeout(4500);
    const a3 = await angles(); await page.waitForTimeout(300); const a4 = await angles();
    check(`${tag} ...and winds down when it's switched off, stopping where it is`, a3["Living Room AC"] === a4["Living Room AC"] && a4["Living Room AC"] !== "none", JSON.stringify([a3, a4]));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // the mode picker: a tap outside closes it and presses nothing underneath
    await page.mouse.click(...await at(page, 0, "#pill"));
    await page.waitForTimeout(500);
    const opened = await openCount(page);
    await page.mouse.click(...await at(page, 1, "#rooms .chip"));
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({ nav: [...window.nav], log: [...window.log] }));
    check(`${tag} mode picker: a tap outside closes it, presses nothing underneath`, opened === 1 && (await openCount(page)) === 0 && !after.nav.length && !after.log.length, JSON.stringify(after));

    // a card that leaves the page takes its popup with it
    await hold(page, await at(page, 0, "#chips .chip"));
    await page.evaluate(() => window.cards[0].remove());
    await page.waitForTimeout(100);
    check(`${tag} a popup goes when its card does`, (await openCount(page)) === 0);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
