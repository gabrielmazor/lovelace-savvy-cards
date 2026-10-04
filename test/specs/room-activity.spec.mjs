// savvy-room-activity-card on the made-up house, with a faked recorder for the history page.
import { openPage, idle, shot } from "./_util.mjs";

const RECORDER = `window.hass.callWS = async (m) => {
  const now = Date.now(), H = 3600000, out = {};
  for (const id of m.entity_ids) {
    if (id.startsWith("binary_sensor.")) out[id] = [{ s: "off", lu: (now - 20 * H) / 1000 }, { s: "on", lu: (now - 6 * H) / 1000 }, { s: "off", lu: (now - 5 * H) / 1000 }, { s: "on", lu: (now - 2 * H) / 1000 }];
    else out[id] = Array.from({ length: 24 }, (_, i) => ({ s: String(22 + Math.sin(i / 4)), lu: (now - (24 - i) * H) / 1000 }));
  }
  return out;
};`;

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [460, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(RECORDER);
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-room-activity-card", { area: "living_room", navigation_path: "/lovelace/living-room",
        chips: [{ entity: "input_boolean.movie_mode", name: "Movie", icon: "mdi:movie-open" }, { entity: "switch.living_room_plug", name: "Plug", tap_action: "more-info" }] }, width);
      window.mount("savvy-room-activity-card", { area: "bedroom", alarm: "auto" }, width);
      window.mount("savvy-room-activity-card", { area: "hallway", layout: "compact" }, width);
      // the pre-Savvy shape: a hand-picked Home overview, no area
      window.mount("savvy-room-activity-card", { name: "Home", icon: "mdi:home", alarm: "alarm_control_panel.home_alarm",
        entities: [{ entity: "sensor.energy_cost", name: "Energy" }, { entity: "lock.back_door", name: "Back door", tap_action: "more-info" }] }, width);
      await new Promise((res) => setTimeout(res, 600));
      const read = (el) => {
        const R = el.shadowRoot;
        return { title: R.getElementById("title").textContent, status: R.getElementById("status").textContent, level: R.getElementById("status").dataset.level || "",
          armed: R.getElementById("armed").hidden ? "" : R.getElementById("armedText").textContent,
          events: [...R.querySelectorAll(".ev")].map((e) => `${e.querySelector(".st").textContent}|${e.querySelector(".when").textContent}`),
          reads: [...R.querySelectorAll(".rd")].map((e) => `${e.querySelector(".c").textContent}:${e.querySelector(".n").textContent}`),
          pills: [...R.querySelectorAll(".pill .cn")].map((e) => e.textContent), glyphs: R.querySelectorAll(".gl").length,
          warn: [...R.querySelectorAll(".ev")].map((e) => e.style.getPropertyValue("--warn")) };
      };
      return window.cards.map(read);
    }, width);
    const [lr, bed, hall, home] = r;
    check(`${tag} presence and door with how long; readouts from the area`, lr.title === "Living Room" && lr.status === "Occupied"
      && JSON.stringify(lr.events) === JSON.stringify(["Occupied|for 12 min", "Closed|47 min ago"])
      && JSON.stringify(lr.reads) === JSON.stringify(["Temperature:23.6°C", "Humidity:47%", "Dim:140 lx"]), JSON.stringify(lr));
    check(`${tag} your chips`, JSON.stringify(lr.pills) === JSON.stringify(["Movie", "Plug"]), JSON.stringify(lr.pills));
    check(`${tag} alarm: auto finds the house panel: an open window while armed escalates to red`, bed.armed === "Home" && bed.level === "alert" && bed.status === "Window open" && Number(bed.warn[0]) > 0.99, JSON.stringify(bed));
    check(`${tag} compact: one row of glyphs and the temperature`, hall.glyphs >= 0 && hall.events.length === 0, JSON.stringify(hall));
    check(`${tag} the pre-Savvy hand-picked overview still works`, home.title === "Home" && home.reads.includes("Energy:3.45 $") && JSON.stringify(home.pills) === JSON.stringify(["Back door"]), JSON.stringify(home));

    // a leak: the banner, the red wash, the status
    await page.evaluate(() => window.setStates({ "binary_sensor.hallway_leak": "on" }));
    await page.waitForTimeout(700);
    const hallAlert = await page.evaluate(() => ({ status: window.cards[2].shadowRoot.getElementById("status").textContent, wash: window.cards[2].shadowRoot.getElementById("wash").style.opacity,
      glyphs: [...window.cards[2].shadowRoot.querySelectorAll(".gl[data-alert]")].length }));
    check(`${tag} a leak: the status says so, the card washes, the glyph shows`, hallAlert.status.startsWith("Leak detected") && Number(hallAlert.wash) > 0.5 && hallAlert.glyphs === 1, JSON.stringify(hallAlert));
    await page.evaluate(() => window.setStates({ "binary_sensor.hallway_leak": "off" }));

    // gestures: a chip toggles at once; a tile opens more-info; the name navigates
    await page.evaluate(() => { window.info = []; window.nav = []; document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
      window.addEventListener("location-changed", () => window.nav.push(location.pathname)); window.log.length = 0; });
    const at = (sel, i = 0) => page.evaluate(({ sel, i }) => { const b = window.cards[0].shadowRoot.querySelectorAll(sel)[i].getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, { sel, i });
    await page.mouse.click(...await at(".pill"));
    await page.mouse.click(...await at(".pill", 1));
    await page.mouse.click(...await at(".ev"));
    await page.mouse.click(...await at(".title"));
    await page.waitForTimeout(200);
    const g = await page.evaluate(() => ({ log: [...window.log], info: [...window.info], nav: [...window.nav] }));
    check(`${tag} chips: a toggle toggles, a more-info chip opens it; a tile opens more-info; the name navigates`,
      g.log[0] === "input_boolean.toggle {} input_boolean.movie_mode" && g.info[0] === "switch.living_room_plug" && g.info[1] === "binary_sensor.living_room_presence" && g.nav[0] === "/lovelace/living-room", JSON.stringify(g));

    // swipe to the history page
    const box = await page.evaluate(() => { const b = window.cards[0].shadowRoot.getElementById("pager").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; });
    await page.mouse.move(box.x + box.w * 0.8, box.y + 30);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + box.w * (0.8 - i * 0.08), box.y + 30); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const hist = await page.evaluate(() => { const c = window.cards[0]; return { page: c._page, sum: c.shadowRoot.getElementById("hsum").textContent,
      lanes: c.shadowRoot.querySelectorAll(".trk").length, segs: c.shadowRoot.querySelectorAll(".segs i").length, path: !!c.shadowRoot.querySelector("#svg path"), navAfter: [...window.nav] }; });
    check(`${tag} a swipe opens the history: lanes, the temperature line, a summary`, hist.page === 1 && hist.lanes === 2 && hist.segs >= 2 && hist.path
      && /Door opened|Occupied/.test(hist.sum) && hist.navAfter.length === 1, JSON.stringify(hist));

    if (width === 460) { await page.evaluate(() => window.cards[0]._goto(0, true)); await idle(page); await shot(page, `snapshot-${theme}`, 0); }
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
