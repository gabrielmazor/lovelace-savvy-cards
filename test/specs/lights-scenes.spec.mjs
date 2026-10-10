// Scenes on the lights card, opt-in: `scenes: auto` puts a small button beside the pill that lists the room's
// scenes, and a pick runs one. Without the option, or in a room with no scenes, there is no button.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  await page.evaluate(() => {
    window.mount("savvy-lights-card", { area: "living_room", scenes: "auto" }, 460);
    window.mount("savvy-lights-card", { area: "living_room" }, 460);
    window.mount("savvy-lights-card", { area: "living_room", scenes: [{ entity: "scene.living_room_movie", name: "Film" }] }, 460);
  });
  await page.waitForTimeout(900);
  const shown = await page.evaluate(() => window.cards.map((c) => !c.shadowRoot.getElementById("scenes").hidden));
  check("scenes: auto shows the button; without the option there is none", shown[0] === true && shown[1] === false && shown[2] === true, JSON.stringify(shown));

  const open = async (i) => {
    const at = await page.evaluate((i) => { const b = window.cards[i].shadowRoot.getElementById("scenes"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, i);
    await page.mouse.click(...at);
    await page.waitForTimeout(600);
    return page.evaluate(() => [...document.querySelectorAll("*")].map((n) => n.shadowRoot).filter(Boolean).flatMap((r) => [...r.querySelectorAll(".sv-opt")])
      .filter((o) => o.getBoundingClientRect().width > 0).map((o) => { const q = o.getBoundingClientRect(); return { t: o.textContent.trim(), xy: [q.x + q.width / 2, q.y + q.height / 2] }; }));
  };
  const opts = await open(0);
  check("the button lists the room's scenes", opts.length >= 2 && opts.some((o) => /Movie/.test(o.t)), JSON.stringify(opts.map((o) => o.t)));
  await page.evaluate(() => { window.log.length = 0; });
  const movie = opts.find((o) => /Movie/.test(o.t));
  if (movie) await page.mouse.click(...movie.xy);
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => [...window.log]);
  check("a pick runs the scene", calls.some((l) => l.startsWith("scene.turn_on") && l.includes("scene.living_room_movie")), JSON.stringify(calls));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const own = await open(2);
  check("a list of its own: only those, by the names given", own.length === 1 && own[0].t === "Film", JSON.stringify(own.map((o) => o.t)));

  // scene names written "Room // Name": the menu shows the name only
  const names = await page.evaluate(() => {
    const n = { "scene.t1": "Living Room // Movie", "scene.t2": "living room // movie night", "scene.t3": "Kitchen // Cooking", "scene.t4": "Living Room - Reading" };
    window.setStates(Object.fromEntries(Object.entries(n).map(([id, f]) => [id, { entity_id: id, state: "2026-10-10T10:00:00Z", attributes: { friendly_name: f } }])));
    return Object.keys(n).map((id) => window.__savvy.itemName(window.hass, id, "living_room"));
  });
  check("scene names lose the room and the separator", JSON.stringify(names) === JSON.stringify(["Movie", "Movie night", "Cooking", "Reading"]), JSON.stringify(names));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
