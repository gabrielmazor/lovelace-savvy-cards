// One badge order for the room tile, the room header and the section title: what is relevant comes
// first. The room tile's lights toggle leads; then everything active (a tripped alarm, presence, an open
// door, the rest); then everything idle (presence, door, the rest). The order follows the states live.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
  const order = (opts) => page.evaluate((opts) => window.__savvy.roomBadges(window.hass, opts.area, opts.cfg || {}, opts.o || {}).map((b) => `${b.key}:${b.on ? 1 : 0}`), opts);

  // the living room: presence and the door idle, the TV playing and the AC cooling
  await page.evaluate(() => window.setStates({ "binary_sensor.living_room_presence": "off", "binary_sensor.living_room_door": "off" }));
  await page.waitForTimeout(200);
  const quiet = await order({ area: "living_room" });
  check("nobody home and the door shut: what is playing leads, presence and the door follow", quiet[0] === "media:1" && quiet.indexOf("presence:0") > quiet.indexOf("climate:1") && quiet.at(-1) === "door:0", JSON.stringify(quiet));

  await page.evaluate(() => window.setStates({ "binary_sensor.living_room_door": "on" }));
  await page.waitForTimeout(200);
  const door = await order({ area: "living_room" });
  check("the door opens: it moves up with the active ones, ahead of the media", door[0] === "door:1" && door.indexOf("media:1") > 0 && door.at(-1) === "presence:0", JSON.stringify(door));

  await page.evaluate(() => window.setStates({ "binary_sensor.living_room_presence": "on" }));
  await page.waitForTimeout(200);
  const busy = await order({ area: "living_room" });
  check("someone comes in: presence first, then the open door, then the rest", busy[0] === "presence:1" && busy[1] === "door:1", JSON.stringify(busy));

  // the tile's lights toggle always leads, on or off
  const lead = await order({ area: "living_room", cfg: { entities: [{ entity: "input_boolean.movie_mode", name: "Light" }] }, o: { lead: "input_boolean.movie_mode" } });
  check("the room tile's lights toggle is first even while off", lead[0] === "pin:input_boolean.movie_mode:0" && lead[1] === "presence:1", JSON.stringify(lead));
  const noLead = await order({ area: "living_room", cfg: { entities: [{ entity: "input_boolean.movie_mode", name: "Light" }] } });
  check("without the tile's lead it takes its place by the rule (idle: after the active ones)", noLead.indexOf("pin:input_boolean.movie_mode:0") > noLead.indexOf("media:1"), JSON.stringify(noLead));

  // a tripped leak goes ahead of everything else that is active
  await page.evaluate(() => window.setStates({ "binary_sensor.hallway_leak": "on" }));
  await page.waitForTimeout(200);
  const leak = await order({ area: "hallway" });
  check("a tripped leak sensor is the first badge", leak[0] === "leak:1", JSON.stringify(leak));

  // the tile shows it the same way
  await page.evaluate(() => window.setStates({ "binary_sensor.living_room_presence": "off", "binary_sensor.living_room_door": "off" }));
  await page.evaluate(() => window.mount("savvy-room-tile", { area: "living_room", toggle: "input_boolean.movie_mode", entities: [{ entity: "input_boolean.movie_mode", name: "Light" }] }, 260));
  await page.waitForTimeout(900);
  const tile = await page.evaluate(() => [...window.cards.at(-1).shadowRoot.querySelectorAll(".badge")].filter((b) => b.getAttribute("aria-hidden") === "false").map((b) => b.getAttribute("aria-label").split(",")[0]));
  check("room tile: lights toggle, then what is playing, then presence and the door", tile[0] === "Light" && tile[1] === "TV" && tile.at(-1) === "Door", JSON.stringify(tile));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
