// A light's row is its control: a tap switches the lamp, a hold opens more-info, a sideways drag dims it
// relative to the level it had (a press alone never jumps the level to the finger), a vertical drag is the
// page's scroll and changes nothing, and the keyboard reaches all of it.
import { openPage, idle, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) {
    const tag = `[light row ${theme}]`;
    const { page, errors } = await openPage(browser, base, { theme, width: 360 });
    await page.evaluate(() => {
      window.mount("savvy-lights-card", { area: "living_room", order: ["light.living_room_ceiling", "light.living_room_floor_lamp", "light.living_room_strip"] }, 360);
      window.moreInfo = [];
      document.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId));
    });
    await page.waitForTimeout(600);
    const row = (i) => `.light:not([hidden]):nth-child(${i + 1})`;
    const box = (i) => page.evaluate((sel) => { const r = window.cards[0].shadowRoot.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, row(i));
    const calls = async (fn, wait = 600) => { await page.evaluate(() => { window.log.length = 0; }); await fn(); await page.waitForTimeout(wait); return page.evaluate(() => [...window.log]); };

    // tap anywhere on the row (not just the icon) switches the lamp
    const b0 = await box(0);
    const tap = await calls(() => page.mouse.click(b0.x + b0.w * 0.45, b0.y + b0.h / 2));
    check(`${tag} a tap on the row switches the lamp`, tap.length === 1 && tap[0].startsWith("light.toggle") && tap[0].includes("ceiling"), tap.join(" | "));

    // a press that does not move never changes the level, even at the far end of the row
    const press = await calls(async () => { await page.mouse.move(b0.x + b0.w * 0.62, b0.y + b0.h / 2); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up(); });
    const sheetOpen = await page.evaluate(() => window.cards[0].shadowRoot.getElementById("sheet").hasAttribute("data-open"));
    check(`${tag} a press alone never sets the level where the finger is`, !sheetOpen && press.length === 1 && press[0].startsWith("light.toggle"), press.join(" | "));

    // a sideways drag dims, relative to the level it had: the floor lamp is at 35%, drag right by a quarter of the row
    await page.evaluate(() => window.setStates({ "light.living_room_floor_lamp": { state: "on", attributes: { ...window.hass.states["light.living_room_floor_lamp"].attributes, brightness: 89 } } }));
    await page.waitForTimeout(400);
    const b1 = await box(1);
    const drag = await calls(async () => {
      const y = b1.y + b1.h / 2, x = b1.x + b1.w * 0.5;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let k = 1; k <= 10; k++) { await page.mouse.move(x + 20 + (b1.w * 0.25) * k / 10, y); await page.waitForTimeout(16); }
      await page.mouse.up();
    });
    const last = drag.filter((c) => c.includes("brightness_pct")).at(-1) || "";
    const pct = Number((last.match(/brightness_pct"?:\s*(\d+)/) || [])[1]);
    check(`${tag} a sideways drag dims, relative to where the lamp was (35% + a quarter = about 60%)`, pct >= 52 && pct <= 68, `${pct} | ${drag.join(" | ")}`);
    check(`${tag} a drag is not also a tap`, !drag.some((c) => c.startsWith("light.toggle")), drag.join(" | "));
    const shown = await page.evaluate((sel) => window.cards[0].shadowRoot.querySelector(`${sel} .d`).textContent, row(1));
    check(`${tag} the number follows the drag`, Math.abs(parseInt(shown, 10) - pct) <= 2, `${shown} vs ${pct}`);

    // a vertical drag is the page's scroll: nothing is called
    const b2 = await box(0);
    const vert = await calls(async () => {
      const x = b2.x + b2.w / 2, y = b2.y + b2.h / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let k = 1; k <= 8; k++) { await page.mouse.move(x + 2, y + 6 * k); await page.waitForTimeout(16); }
      await page.mouse.up();
    });
    check(`${tag} a vertical drag changes nothing`, vert.length === 0, vert.join(" | "));

    // hold opens more-info and does not switch the lamp
    const hold = await calls(async () => { await page.mouse.move(b2.x + 60, b2.y + b2.h / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); });
    const info = await page.evaluate(() => window.moreInfo);
    check(`${tag} a hold opens more-info, and does not switch`, info.includes("light.living_room_ceiling") && hold.length === 0, JSON.stringify({ info, hold }));

    // the colour dot opens the sheet, not the row's tap
    const dot = await calls(async () => { const p = await centerOf(page, 0, `${row(1)} .swatch`); await page.mouse.click(p.x, p.y); }, 500);
    const open = await page.evaluate(() => window.cards[0].shadowRoot.getElementById("sheet").hasAttribute("data-open"));
    check(`${tag} the colour dot opens warmth and colour, and does not switch`, open && dot.length === 0, JSON.stringify({ open, dot }));
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);

    // keyboard: Enter switches, arrows dim
    await page.evaluate((sel) => window.cards[0].shadowRoot.querySelector(sel).focus(), row(1));
    const kEnter = await calls(() => page.keyboard.press("Enter"));
    const kArrow = await calls(() => page.keyboard.press("ArrowLeft"));
    check(`${tag} keyboard: Enter switches, an arrow dims`, kEnter[0]?.startsWith("light.toggle") && kArrow.some((c) => c.includes("brightness_pct")), JSON.stringify({ kEnter, kArrow }));

    // a lamp that can only switch has no drag: a sideways move is just a cancelled tap
    const roles = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".light")].map((n) => n.getAttribute("role")));
    check(`${tag} dimmable lamps are sliders, the rest switches`, roles.every((r) => r === "slider" || r === "switch"), JSON.stringify(roles));

    check(`${tag} springs idle`, await idle(page, 6000));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
