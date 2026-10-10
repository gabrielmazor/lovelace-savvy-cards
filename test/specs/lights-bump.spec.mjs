// A compact lights card has no slider: a quick drag changes nothing. A deliberate hold arms the row, and a swipe
// then bumps the lamp one step (right brighter, left dimmer, never to off); held and let go, it opens more-info.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  const ID = "light.living_room_ceiling";
  await page.evaluate((ID) => {
    window.setStates({ [ID]: { state: "on", attributes: { ...window.hass.states[ID].attributes, brightness: 200 } } });   // 78%
    window.mount("savvy-lights-card", { area: "living_room", layout: "compact" }, 460);
    window.info = [];
    document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
  }, ID);
  await page.waitForTimeout(900);
  const at = () => page.evaluate((ID) => { const n = [...window.cards.at(-1).shadowRoot.querySelectorAll(".light")].find((x) => x.__entity === ID); n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, ID);
  const gesture = async (holdMs, dx) => {
    await page.evaluate(() => { window.log.length = 0; window.info.length = 0; });
    const [x, y] = await at();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(holdMs);
    if (dx) for (let i = 1; i <= 8; i++) { await page.mouse.move(x + (dx * i) / 8, y + 1); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(400);
    return page.evaluate(() => ({ calls: window.log.filter((l) => l.startsWith("light.")), info: [...window.info] }));
  };

  const quick = await gesture(60, 120);
  check("compact: a quick sideways drag changes nothing (no slider)", quick.calls.length === 0 && quick.info.length === 0, JSON.stringify(quick));
  const up = await gesture(650, 120);
  check("compact: hold, then swipe right brightens one step (78% to 88%)", up.calls.length === 1 && up.calls[0].includes('"brightness_pct":88') && up.info.length === 0, JSON.stringify(up));
  const down = await gesture(650, -120);
  check("compact: hold, then swipe left dims one step (78% to 68%)", down.calls.length === 1 && down.calls[0].includes('"brightness_pct":68'), JSON.stringify(down));
  const held = await gesture(650, 0);
  check("compact: hold and let go opens more-info, nothing else", held.calls.length === 0 && held.info[0] === ID, JSON.stringify(held));

  // never to off: a dim lamp bumped down stops at the lowest level
  await page.evaluate((ID) => window.setStates({ [ID]: { state: "on", attributes: { ...window.hass.states[ID].attributes, brightness: 13 } } }), ID);   // 5%
  await page.waitForTimeout(500);
  const floor = await gesture(650, -120);
  check("compact: a bump down never switches the lamp off", floor.calls.length === 1 && floor.calls[0].includes('"brightness_pct":1') && !floor.calls[0].includes("turn_off"), JSON.stringify(floor));

  // last: a tap switches the lamp (and the card then holds its guess that it is off for a moment)
  const tap = await gesture(40, 0);
  check("compact: a tap still switches the lamp", tap.calls.length === 1 && tap.calls[0].startsWith("light.toggle"), JSON.stringify(tap));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
