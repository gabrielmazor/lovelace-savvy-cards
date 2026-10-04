// savvy-story-card: the logbook in plain sentences. The logbook and the people's history are faked.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  const h = window.hass, house = window.house;
  const now = Date.now();
  const add = (id, state, attributes, area) => {
    house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
    h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  add("binary_sensor.kitchen_motion", "off", { friendly_name: "Kitchen Motion", device_class: "motion" }, "kitchen");
  add("person.gabriel", "not_home", { friendly_name: "Gabriel", user_id: "u1" }, null);
  add("person.sam", "not_home", { friendly_name: "Sam", user_id: "u2" }, null);
  add("person.alex", "not_home", { friendly_name: "Alex", user_id: "u3" }, null);
  window.hass = { ...h, states: { ...house.states } };
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const at = (hh, mm = 0) => (day.getTime() + (hh * 60 + mm) * 60000) / 1000;
  const ev = (entity_id, state, when, extra = {}) => ({ entity_id, state, when, ...extra });
  const events = [
    ...[0, 5, 10, 15, 20, 25, 30].map((m) => ev("binary_sensor.kitchen_motion", "on", at(7, 10 + m))),
    ev("binary_sensor.kitchen_motion", "off", at(7, 41)),
    ev("person.gabriel", "not_home", at(8)),
    ev("binary_sensor.living_room_door", "on", at(12)),
    ev("binary_sensor.living_room_door", "off", at(12, 1)),
    ev("person.gabriel", "home", at(17, 55)),
    ev("lock.front_door", "unlocked", at(18, 2), { context_user_id: "u1" }),
    ev("light.living_room_ceiling", "on", at(18, 2)),
    ev("light.living_room_floor_lamp", "on", at(18, 10)),
    ev("light.living_room_ceiling", "off", at(23, 10)),
    ev("light.living_room_floor_lamp", "off", at(23, 20)),
    ev("sensor.living_room_temperature", "21", at(9)),
  ];
  window.__reqs = [];
  const awayStart = now - 3 * 3600000;
  window.hass.callWS = async (msg) => {
    window.__reqs.push(msg);
    if (msg.type === "logbook/get_events") return events;
    if (msg.type === "history/history_during_period") return {
      "person.gabriel": [{ s: "home", lu: (now - 9 * 3600000) / 1000 }, { s: "not_home", lu: awayStart / 1000 }],
      "person.sam": [{ s: "not_home", lu: (now - 8 * 3600000) / 1000 }],
      "person.alex": [{ s: "not_home", lu: (now - 10 * 3600000) / 1000 }],
    };
    throw new Error("unmocked " + msg.type);
  };
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP);
    await page.evaluate((width) => {
      window.mount("savvy-story-card", {}, width);                                                         // 0
      window.mount("savvy-story-card", { max_events: 3 }, width);                                          // 1
      window.mount("savvy-story-card", { area: ["kitchen"], exclude: ["light.living_room_ceiling"] }, width);  // 2
      window.mount("savvy-story-card", { range: "away", layout: "compact" }, width);                       // 3
    }, width);
    await page.waitForTimeout(900);
    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return { parts: [...R.querySelectorAll(".part")].map((p) => p.textContent),
        lines: [...R.querySelectorAll(".ev")].map((e) => ({ t: e.querySelector(".nm").textContent, d: e.querySelector(".dt").textContent, time: e.querySelector(".tm").textContent, tone: e.dataset.tone || "" })),
        sub: R.getElementById("sub").hidden ? "" : R.getElementById("sub").textContent, more: R.getElementById("more").hidden ? "" : R.getElementById("more").textContent,
        empty: R.getElementById("empty").hidden ? "" : R.getElementById("empty").textContent, title: R.getElementById("title").textContent };
    }, i);
    const s0 = await read(0);
    const texts = s0.lines.map((l) => l.t);
    check(`${tag} newest first, by part of the day`, JSON.stringify(s0.parts) === JSON.stringify(["Evening", "Afternoon", "Morning"]) && s0.lines[s0.lines.length - 1].t.startsWith("Motion"), JSON.stringify([s0.parts, texts]));
    const motion = s0.lines.find((l) => /^Motion in Kitchen/.test(l.t));
    check(`${tag} seven motion events are one line`, motion && /7 times, 0?7:10.*0?7:40/.test(motion.d) && s0.lines.filter((l) => /Motion/.test(l.t)).length === 1, JSON.stringify(motion));
    const lights = s0.lines.find((l) => /lights were on/.test(l.t));
    check(`${tag} a room's lights are one span with its hours and length`, lights && /(18:02|0?6:02)/.test(lights.d) && /(23:20|11:20)/.test(lights.d) && /5 h/.test(lights.d) && s0.lines.filter((l) => /lights/.test(l.t)).length === 1, JSON.stringify(lights));
    const lock = s0.lines.find((l) => /unlocked/.test(l.t));
    check(`${tag} an unlock says who did it`, lock && /by Gabriel/.test(lock.d) && lock.tone === "warn", JSON.stringify(lock));
    check(`${tag} people arrive and leave in words`, texts.includes("Gabriel arrived home") && texts.includes("Gabriel left home"), JSON.stringify(texts));
    check(`${tag} doors open and close; sensors and motion clearing are left out`, texts.includes("Living Room Door opened") && texts.includes("Living Room Door closed") && !texts.some((t) => /temperature|clear/i.test(t)), JSON.stringify(texts));
    const req = await page.evaluate(() => window.__reqs.find((r) => r.type === "logbook/get_events"));
    check(`${tag} it asks for the shown kinds only`, req.entity_ids.every((i) => /^(light|lock|cover|binary_sensor|person|media_player|alarm_control_panel|vacuum|switch|fan|siren)\./.test(i)) && req.entity_ids.includes("lock.front_door"), JSON.stringify(req.entity_ids.slice(0, 5)));

    // filters
    const pill = async (i, label) => { const p = await page.evaluate(({ i, label }) => { const b = [...window.cards[i].shadowRoot.querySelectorAll(".f")].find((x) => x.textContent === label); b.scrollIntoView({ block: "center", inline: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { i, label }); await page.mouse.click(p.x, p.y); await page.waitForTimeout(500); };
    await pill(0, "People");
    const people = (await read(0)).lines.map((l) => l.t);
    check(`${tag} the People chip keeps only people`, people.length === 2 && people.every((t) => /Gabriel/.test(t)), JSON.stringify(people));
    await pill(0, "Security");
    const sec = (await read(0)).lines.map((l) => l.t);
    check(`${tag} Security: locks and doors`, sec.length === 3 && sec.some((t) => /unlocked/.test(t)) && sec.some((t) => /Door opened/.test(t)), JSON.stringify(sec));
    await pill(0, "Rooms");
    const rooms = (await read(0)).lines.map((l) => l.t);
    check(`${tag} Rooms: motion and lights`, rooms.length === 2, JSON.stringify(rooms));
    await pill(0, "All");

    // show more
    const s1 = await read(1);
    check(`${tag} max_events then Show more`, s1.lines.length === 3 && /Show more/.test(s1.more), JSON.stringify([s1.lines.length, s1.more]));
    const mp = await page.evaluate(() => { const b = window.cards[1].shadowRoot.getElementById("more"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(mp.x, mp.y);
    await page.waitForTimeout(500);
    check(`${tag} Show more shows the rest`, (await read(1)).lines.length > 3, "");

    // an area keeps the people, and the ignore list is honoured
    const reqArea = await page.evaluate(() => window.__reqs.filter((r) => r.type === "logbook/get_events")[2]);
    check(`${tag} an area still asks for people; exclude is left out`, reqArea.entity_ids.includes("person.gabriel") && reqArea.entity_ids.includes("binary_sensor.kitchen_motion") && !reqArea.entity_ids.includes("light.living_room_ceiling") && !reqArea.entity_ids.includes("lock.front_door"), JSON.stringify(reqArea.entity_ids));

    // while you were away: the window starts when the last person left
    const s3 = await read(3);
    const away = await page.evaluate(() => window.__reqs.filter((r) => r.type === "logbook/get_events").pop());
    const window_reqs = (await page.evaluate(() => window.__reqs.map((r) => r.type))).join(",");
    check(`${tag} away starts when the last person left`, Math.abs(Date.parse(away.start_time) - (Date.now() - 3 * 3600000)) < 120000 && s3.title === "While you were away" && /^Since /.test(s3.sub), JSON.stringify([away.start_time, s3.sub, s3.title, window_reqs]));

    // the range chip cycles
    await pill(0, "Today");
    await page.waitForTimeout(400);
    const r24 = await page.evaluate(() => { const q = window.__reqs.filter((r) => r.type === "logbook/get_events"); return q.length; });
    const label = await page.evaluate(() => window.cards[0].shadowRoot.querySelector(".f.range").textContent);
    check(`${tag} the range chip goes today, 24 hours, while away`, label === "24 hours", label);

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
