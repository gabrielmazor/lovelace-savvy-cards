// 0.9.1: `aggregate`: a room's sensors of a kind shown once. Occupied if any one is, since the first of
// those that are on came on; the sensors behind it listed read-only; pins and ignore lists are never merged.
import { openPage, idle } from "./_util.mjs";

const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(450); };

// a den with three presence sensors (the best-ranked, the desk, is clear; the other two are on) and two doors, a nook with one sensor, a hall with a presence + a door
const SETUP = () => {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.house.areas.den = { area_id: "den", name: "Den" };
  window.house.areas.nook = { area_id: "nook", name: "Nook" };
  const patch = {};
  const add = (id, state, dc, area, name, mins) => {
    window.house.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
    patch[id] = { entity_id: id, state, attributes: { friendly_name: name, device_class: dc }, last_changed: ago(mins), last_updated: ago(mins) };
  };
  add("binary_sensor.den_p1", "on", "occupancy", "den", "Den Radar Occupancy", 30);
  add("binary_sensor.den_p2", "on", "motion", "den", "Den Camera Motion", 10);
  add("binary_sensor.den_p3", "off", "presence", "den", "Den Desk Presence", 3);
  add("binary_sensor.den_d1", "on", "door", "den", "Den Patio Door", 5);
  add("binary_sensor.den_d2", "off", "door", "den", "Den Garden Door", 60);
  add("binary_sensor.nook_p1", "off", "occupancy", "nook", "Nook Presence", 7);
  window.setStates(patch);
  window.info = [];
  document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
};

export default async function ({ browser, base, check }) {
  // ---------- the merge itself ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    await page.evaluate(SETUP);
    const r = await page.evaluate(() => {
      const S = window.__savvy, h = window.hass;
      const SID = "binary_sensor.savvy_agg_presence_den";
      const d = S.aggregateHass(h, { kinds: true });
      const out = {};
      const st = d.states[SID];
      out.state = [st?.state, st?.attributes.friendly_name, st?.attributes.device_class, st?.attributes.savvy_members];
      out.since = Math.round((Date.now() - Date.parse(st.last_changed)) / 60000);              // the earliest of the two that are on: 30 min
      out.hidden = ["binary_sensor.den_p1", "binary_sensor.den_p2", "binary_sensor.den_p3"].map((id) => d.entities[id].hidden_by);
      out.regStandIn = [d.entities[SID]?.area_id, d.entities[SID]?.platform];
      out.alone = d.entities["binary_sensor.nook_p1"].hidden_by == null && !d.states["binary_sensor.savvy_agg_presence_nook"];
      out.doorsLeft = !d.states["binary_sensor.savvy_agg_door_den"];
      // doors too, when asked
      const dd = S.aggregateHass(h, { kinds: ["presence", "door"] });
      out.doors = [dd.states["binary_sensor.savvy_agg_door_den"]?.state, dd.states["binary_sensor.savvy_agg_door_den"]?.attributes.friendly_name];
      // off by default / empty / unknown
      out.same = [S.aggregateHass(h, {}) === h, S.aggregateHass(h, { kinds: [] }) === h, S.aggregateHass(h, { kinds: false }) === h, S.aggregateHass(h, { kinds: ["nope"] }) === h];
      // the ignore list keeps a sensor out: two left, still merged; one left, nothing to merge
      const ex1 = S.aggregateHass(h, { kinds: true, exclude: ["binary_sensor.den_p1"] });
      const ex2 = S.aggregateHass(h, { kinds: true, exclude: ["binary_sensor.den_p1", "binary_sensor.den_p2"] });
      out.exclude = [ex1.states[SID].attributes.savvy_members.length, ex1.entities["binary_sensor.den_p1"].hidden_by == null, !ex2.states[SID]];
      out.areaOut = !S.aggregateHass(h, { kinds: true, excludeAreas: ["den"] }).states[SID];
      // when all are clear it is the last change; all dead: unavailable
      window.setStates({ "binary_sensor.den_p1": "off", "binary_sensor.den_p2": "off" });
      const clear = S.aggregateHass(window.hass, { kinds: true }).states[SID];
      out.clear = [clear.state, Math.round((Date.now() - Date.parse(clear.last_changed)) / 60000)];     // the latest change: just now
      window.setStates({ "binary_sensor.den_p1": "unavailable", "binary_sensor.den_p2": "unavailable", "binary_sensor.den_p3": "unavailable" });
      out.dead = S.aggregateHass(window.hass, { kinds: true }).states[SID].state;
      window.setStates({ "binary_sensor.den_p1": "off", "binary_sensor.den_p2": "unavailable", "binary_sensor.den_p3": "off" });
      out.partlyDead = S.aggregateHass(window.hass, { kinds: true }).states[SID].state;
      // the derived registry keeps its identity while nothing about the rooms changes
      const a = S.aggregateHass(window.hass, { kinds: true }), b = S.aggregateHass({ ...window.hass, states: { ...window.hass.states } }, { kinds: true });
      out.stable = a.entities === b.entities;
      // normalised in the settings: true is presence
      out.norm = [S.normalizeSettings({ aggregate: true }).aggregate, S.normalizeSettings({ aggregate: ["door", "bogus", "window"] }).aggregate, S.normalizeSettings({ aggregate: false })];
      return out;
    });
    check("three presence sensors in a room become one: on, named for the room, the three listed behind it", r.state[0] === "on" && r.state[1] === "Den Presence" && r.state[2] === "occupancy" && r.state[3].length === 3, JSON.stringify(r.state));
    check("it has been occupied since the first of those that are on came on (30 min, not 10)", r.since === 30, String(r.since));
    check("the sensors behind it are hidden from discovery; the stand-in sits in their room", r.hidden.every((x) => x === "savvy") && r.regStandIn.join() === "den,savvy", JSON.stringify([r.hidden, r.regStandIn]));
    check("a room with one sensor is left alone, and doors are not merged unless asked", r.alone && r.doorsLeft);
    check("aggregate: [presence, door] merges doors too: open if any is, \"Den doors\"", r.doors[0] === "on" && r.doors[1] === "Den Doors", JSON.stringify(r.doors));
    check("off, empty and unknown kinds change nothing", r.same.every(Boolean), JSON.stringify(r.same));
    check("the ignore list keeps a sensor out of the merge; one left means nothing to merge", r.exclude[0] === 2 && r.exclude[1] && r.exclude[2], JSON.stringify(r.exclude));
    check("an ignored room is not merged", r.areaOut);
    check("all clear: clear since the last change; all unavailable: unavailable; some dead and the rest clear: clear", r.clear[0] === "off" && r.clear[1] <= 1 && r.dead === "unavailable" && r.partlyDead === "off", JSON.stringify([r.clear, r.dead, r.partlyDead]));
    check("the derived registry keeps its identity while the rooms do not change", r.stable);
    check("in the settings, true is presence and unknown kinds are dropped", JSON.stringify(r.norm) === JSON.stringify([["presence"], ["door", "window"], undefined]), JSON.stringify(r.norm));
    check("aggregate: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- in the cards ----------
  for (const theme of ["dark", "light"]) for (const width of [420, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width: width + 80, height: 1300 });
    await page.evaluate(SETUP);
    const ids = await page.evaluate((width) => {
      const m = (t, c) => window.cards.indexOf(window.mount(t, c, width));
      return {
        off: m("savvy-room-activity-card", { area: "den", history: false }),
        on: m("savvy-room-activity-card", { area: "den", history: false, aggregate: true }),
        pin: m("savvy-room-activity-card", { area: "den", history: false, aggregate: true, presence: "binary_sensor.den_p3" }),
        hdrOff: m("savvy-room-header-card", { area: "den" }),
        hdrOn: m("savvy-room-header-card", { area: "den", aggregate: true }),
        home: m("savvy-home-header-card", { health: false, aggregate: true }),
        homeOff: m("savvy-home-header-card", { health: false }),
      };
    }, width);
    await page.waitForTimeout(900);
    // room activity: the best sensor says clear (the radar), another is on: merged, the room is occupied
    const act = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return [...R.querySelectorAll(".ev, .read, .pill, [data-slot]")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
    }, i);
    const aOff = await act(ids.off), aOn = await act(ids.on), aPin = await act(ids.pin);
    check(`${tag} room activity without aggregate keeps the one best sensor: clear, while the room is occupied`, /Clear/.test(aOff) && !/Occupied/.test(aOff), aOff);
    check(`${tag} with aggregate the room says Occupied`, /Occupied/.test(aOn) && !/Clear/.test(aOn.split("|")[0] || ""), aOn);
    check(`${tag} a sensor the user names is never merged`, /Clear/.test(aPin), aPin);

    // room header badge: one presence badge, on
    const badge = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return [...R.querySelectorAll("#chips .chip, .chips .chip")].map((c) => ({ text: c.textContent.replace(/\s+/g, " ").trim(), on: !c.hasAttribute("data-idle") }));
    }, i);
    const hOn = await badge(ids.hdrOn);
    check(`${tag} the room header shows the merged presence once`, hOn.filter((b) => /presence|Occupied|Den/i.test(b.text)).length <= 1, JSON.stringify(hOn));

    // the security popup: one presence row for the den with a chevron listing the three
    const SEC = 3;
    const chipAt = (i) => page.evaluate(({ i, SEC }) => { const el = window.cards[i].shadowRoot.querySelectorAll("#chips .chip")[SEC]; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { i, SEC });
    const rowsOf = () => page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-row")].map((r) => ({ id: r.dataset.id, name: r.querySelector(".sv-name").textContent, sub: r.querySelector(".sv-sub").textContent,
      val: r.querySelector(".sv-val").textContent, chev: !r.querySelector(".sv-chev").hasAttribute("data-none") })));
    await hold(page, await chipAt(ids.homeOff));
    const plain = (await rowsOf()).filter((r) => /den_p/.test(r.id));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await hold(page, await chipAt(ids.home));
    const merged = await rowsOf();
    const den = merged.find((r) => r.id === "binary_sensor.savvy_agg_presence_den");
    check(`${tag} without aggregate the popup lists the three sensors; with it, one row`, plain.length === 3 && !!den && !merged.some((r) => /den_p\d/.test(r.id)), JSON.stringify([plain.map((r) => r.id), merged.map((r) => r.id)]));
    check(`${tag} the merged row says how many sensors and since when, and has a chevron`, den && /3 sensors/.test(den.sub) && /30 min/.test(den.sub) && den.chev && /Presence/.test(den.name), JSON.stringify(den));
    // open it: the three, read only; tap one: more-info of that sensor
    await page.evaluate(() => window.__savvy.portalRoot().querySelector('.sv-row[data-id="binary_sensor.savvy_agg_presence_den"] .sv-chev').click());
    await page.waitForTimeout(600);
    const members = await page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll('.sv-row[data-id="binary_sensor.savvy_agg_presence_den"] .sv-agg-l')].map((l) => `${l.querySelector(".n").textContent}|${l.hasAttribute("data-on")}`));
    check(`${tag} the chevron lists the sensors behind it, the ones that are on marked`, members.length === 3 && members.filter((m) => m.endsWith("true")).length === 2, JSON.stringify(members));
    await page.evaluate(() => { window.info.length = 0; window.__savvy.portalRoot().querySelector('.sv-row[data-id="binary_sensor.savvy_agg_presence_den"] .sv-agg-l').click(); });
    await page.waitForTimeout(150);
    check(`${tag} tapping a sensor in it opens that sensor`, /^binary_sensor\.den_p\d$/.test((await page.evaluate(() => window.info))[0] || ""), JSON.stringify(await page.evaluate(() => window.info)));
    await page.evaluate(() => { window.info.length = 0; window.__savvy.portalRoot().querySelector('.sv-row[data-id="binary_sensor.savvy_agg_presence_den"] .sv-main .sv-name').click(); });
    await page.waitForTimeout(150);
    const opened = (await page.evaluate(() => window.info))[0];
    check(`${tag} tapping the merged row opens a sensor that is on, never the stand-in`, /^binary_sensor\.den_p[12]$/.test(opened || ""), String(opened));
    // it stays live
    await page.evaluate(() => window.setStates({ "binary_sensor.den_p1": "off", "binary_sensor.den_p2": "off" }));
    await page.waitForTimeout(500);
    const after = (await rowsOf()).find((r) => r.id === "binary_sensor.savvy_agg_presence_den");
    check(`${tag} when the last one clears the row says so (Clear in Home Assistant's words, Off in the stub's)`, /^(Clear|Off)$/.test(after?.val || ""), JSON.stringify(after));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- the settings turn it on for every card ----------
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    await page.evaluate(SETUP);
    const r = await page.evaluate(() => {
      history.replaceState({}, "", "/lovelace/home");
      const SS = window.__savvy.SettingsStore;
      SS._sync();
      SS.set({ aggregate: ["presence"] });
      const e = window.mount("savvy-room-activity-card", { area: "den", history: false }, 420);
      const own = window.mount("savvy-room-activity-card", { area: "den", history: false, aggregate: false }, 420);
      return { on: window.cards.indexOf(e), off: window.cards.indexOf(own) };
    });
    await page.waitForTimeout(900);
    const txt = (i) => page.evaluate((i) => window.cards[i].shadowRoot.textContent.replace(/\s+/g, " "), i);
    check("the settings' aggregate reaches a card that sets nothing", /Occupied/.test(await txt(r.on)));
    check("a card's own aggregate: false wins", /Clear/.test(await txt(r.off)) && !/Occupied/.test(await txt(r.off)));
    check("settings: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
