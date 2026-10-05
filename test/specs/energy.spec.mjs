// savvy-energy-card: statistics in, kWh, cost (hour by hour), the comparison, the bars and the ranking out.
// Home Assistant's statistics are faked: every hour has a known amount and a known price.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  // the clock is set to half past two in the afternoon, so no test straddles an hour
  const RealDate = Date, fixed = new RealDate(); fixed.setHours(14, 30, 0, 0);
  const offset = fixed - RealDate.now();
  window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } };
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => {
    house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
    h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  const energy = { device_class: "energy", state_class: "total_increasing", unit_of_measurement: "kWh" };
  add("sensor.house_energy", "1200", { ...energy, friendly_name: "House Energy" }, null);
  add("sensor.kitchen_oven_energy", "300", { ...energy, friendly_name: "Oven" }, "kitchen");
  add("sensor.kitchen_washer_energy", "80", { ...energy, friendly_name: "Washer" }, "kitchen");
  add("sensor.bedroom_heater_energy", "90000", { ...energy, unit_of_measurement: "Wh", friendly_name: "Heater" }, "bedroom");
  add("sensor.house_power", "1500", { device_class: "power", unit_of_measurement: "W", friendly_name: "House Power" }, null);
  add("sensor.tariff", "0.3", { unit_of_measurement: "EUR/kWh", friendly_name: "Tariff" }, null);
  window.hass = { ...h, states: { ...house.states } };
  // the faked statistics: the house uses 0.5 + 0.05 per hour of the day; the oven 0.2 in the evening, 0.02 otherwise;
  // the heater 100 Wh an hour; the washer 0.05; the tariff is 0.2 until noon and 0.3 after
  window.__ws = [];
  const amount = { "sensor.house_energy": (hr) => 0.5 + hr * 0.05, "sensor.kitchen_oven_energy": (hr) => (hr >= 17 && hr <= 19 ? 0.2 : 0.02), "sensor.kitchen_washer_energy": () => 0.05, "sensor.bedroom_heater_energy": () => 100 };
  window.__amount = amount;
  window.__price = (hr) => (hr < 12 ? 0.2 : 0.3);
  window.hass.callWS = async (m) => {
    window.__ws.push(m);
    if (m.type !== "recorder/statistics_during_period") throw new Error("unmocked " + m.type);
    if (window.__fail) throw new Error("no recorder");
    const out = {};
    for (const id of m.statistic_ids) {
      out[id] = [];
      for (let t = Date.parse(m.start_time); t < Date.parse(m.end_time) && t <= Date.now(); t += 3600000) {
        const d = new Date(t);
        if (id === "sensor.tariff") out[id].push({ start: t, end: t + 3600000, mean: window.__price(d.getHours()) });
        else out[id].push({ start: t, end: t + 3600000, change: amount[id](d.getHours()) });
      }
    }
    return out;
  };
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP);
    await page.evaluate((width) => {
      window.mount("savvy-energy-card", { total: "sensor.house_energy", power: "sensor.house_power", tariff: "sensor.tariff", currency: "EUR" }, width);   // 0
      window.mount("savvy-energy-card", { consumers: ["sensor.kitchen_oven_energy", "sensor.kitchen_washer_energy", "sensor.bedroom_heater_energy"], price: 0.25, currency: "EUR", by: "room" }, width);   // 1  no total: the consumers' sum
      window.mount("savvy-energy-card", { total: "sensor.house_energy", layout: "compact", range: "week" }, width);  // 2  no price
      window.mount("savvy-energy-card", { area: "office" }, width);                                                 // 3  nothing there
    }, width);
    await page.waitForTimeout(1200);
    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot, q = (id) => R.getElementById(id);
      return { title: q("title").textContent, kwh: q("kwh").textContent, cost: q("cost").textContent, delta: q("delta").hidden ? "" : q("delta").textContent, dir: q("delta").dataset.dir || "",
        when: q("when").textContent, live: q("live").hidden ? "" : q("liveTx").textContent, bars: R.querySelectorAll(".bar").length, chart: !q("chart").hidden,
        now: [...R.querySelectorAll(".bar")].findIndex((b) => b.hasAttribute("data-now")), future: R.querySelectorAll(".bar[data-future]").length,
        rank: [...R.querySelectorAll(".row")].map((r) => [r.querySelector(".nm").textContent, r.querySelector(".num b").textContent, r.querySelector(".num span").textContent]), empty: q("empty").hidden ? "" : q("empty").textContent,
        axis: q("axis").textContent, ranges: [...R.querySelectorAll(".rg")].map((b) => b.textContent + (b.hasAttribute("data-on") ? "*" : "")) };
    }, i);
    const num = (s) => parseFloat(String(s).replace(/[^0-9.,-]/g, "").replace(",", "."));

    // what the numbers should be, worked out here on its own
    const exp = await page.evaluate(() => {
      const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
      const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 1);
      const elapsed = now - start, prevEnd = Math.min(prevStart.getTime() + elapsed, start.getTime());
      let kwh = 0, cost = 0, pk = 0, byId = {};
      for (let t = prevStart.getTime(); t < now.getTime() + 3600000; t += 3600000) {
        const hr = new Date(t).getHours();
        if (t >= start.getTime() && t <= now.getTime()) {
          const a = window.__amount["sensor.house_energy"](hr);
          kwh += a; cost += a * window.__price(hr);
          for (const id of ["sensor.kitchen_oven_energy", "sensor.kitchen_washer_energy", "sensor.bedroom_heater_energy"]) byId[id] = (byId[id] || 0) + window.__amount[id](hr) / (id.includes("heater") ? 1000 : 1);
        } else if (t >= prevStart.getTime() && t < prevEnd) pk += window.__amount["sensor.house_energy"](hr);
      }
      const hrNow = now.getHours();
      const consSum = Object.values(byId).reduce((a, b) => a + b, 0);
      return { kwh, cost, pk, byId, hrNow, consSum, consCost25: consSum * 0.25 };
    });
    const a = await read(0), b = await read(1), c = await read(2), d = await read(3);
    check(`${tag} today's kWh from the statistics`, Math.abs(num(a.kwh) - exp.kwh) < 0.01 + exp.kwh * 0.005, JSON.stringify([a.kwh, exp.kwh]));
    check(`${tag} the cost is each hour's energy times that hour's price`, Math.abs(num(a.cost) - exp.cost) < 0.02, JSON.stringify([a.cost, exp.cost]));
    const pct = exp.pk > 0.05 ? Math.round(((exp.kwh - exp.pk) / exp.pk) * 100) : null;
    check(`${tag} the comparison with the same hours of yesterday`, pct == null ? a.delta === "" : Math.abs(num(a.delta) - Math.abs(pct)) <= 1 && /vs yesterday/.test(a.delta), JSON.stringify([a.delta, pct]));
    check(`${tag} the live power`, a.live === "1.50 kW", a.live);
    check(`${tag} 24 hourly bars, the current hour marked, later ones dimmed`, a.bars === 24 && a.now === exp.hrNow && a.future === 23 - exp.hrNow && a.chart, JSON.stringify([a.bars, a.now, a.future, exp.hrNow]));
    const kw = a.rank.map((r) => num(r[1]));
    check(`${tag} the ranking: biggest first, watt-hours turned into kWh, area under the name`, a.rank.length === 3 && kw.every((v, i) => i === 0 || kw[i - 1] >= v) && a.rank.some((r) => r[0] === "Heater" && Math.abs(num(r[1]) - exp.byId["sensor.bedroom_heater_energy"]) < 0.01), JSON.stringify(a.rank));

    // no total: the consumers' sum; a fixed price; by room
    check(`${tag} with no total the consumers add up`, Math.abs(num(b.kwh) - exp.consSum) < 0.01 + exp.consSum * 0.005, JSON.stringify([b.kwh, exp.consSum]));
    check(`${tag} a fixed price`, Math.abs(num(b.cost) - exp.consCost25) < 0.02, JSON.stringify([b.cost, exp.consCost25]));
    check(`${tag} by room: Kitchen adds the oven and the washer`, b.rank.some((r) => r[0] === "Kitchen" && Math.abs(num(r[1]) - (exp.byId["sensor.kitchen_oven_energy"] + exp.byId["sensor.kitchen_washer_energy"])) < 0.01) && b.rank.some((r) => r[0] === "Bedroom"), JSON.stringify(b.rank));
    check(`${tag} compact, no price: the numbers only`, !c.chart && c.cost === "" && c.rank.length === 0 && c.ranges.includes("Week*") && /week/.test(c.when), JSON.stringify(c));
    check(`${tag} nothing to read says how to fix it`, /state class total_increasing/.test(d.empty), d.empty);

    // the range chips
    const tap = async (i, sel, idx = 0) => { const p = await page.evaluate(({ i, sel, idx }) => { const e = [...window.cards[i].shadowRoot.querySelectorAll(sel)][idx]; e.scrollIntoView({ block: "center", inline: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { i, sel, idx }); await page.mouse.click(p.x, p.y); await page.waitForTimeout(600); };
    await tap(0, ".rg", 1);
    const wk = await read(0);
    const req = await page.evaluate(() => window.__ws.filter((m) => m.statistic_ids?.includes("sensor.house_energy")).pop());
    const wstart = await page.evaluate((s) => { const n = new Date(); const d = new Date(n); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() - 1 + 7) % 7)); d.setDate(d.getDate() - 7); return Math.abs(Date.parse(s) - d.getTime()) < 3600000 * 2; }, req.start_time);
    check(`${tag} Week: seven bars, a week of statistics from the start of last week`, wk.bars === 7 && /week/.test(wk.when) && wstart && wk.ranges.includes("Week*"), JSON.stringify([wk.bars, wk.when, req.start_time]));
    await tap(0, ".rg", 2);
    const mo = await read(0);
    check(`${tag} Month: a bar for every day of the month`, mo.bars >= 28 && mo.bars <= 31 && /month/.test(mo.when), JSON.stringify([mo.bars, mo.when]));
    await tap(0, ".rg", 0);

    // pick a bar
    const before = (await read(0)).kwh;
    await tap(0, ".bar", 0);
    const picked = await read(0);
    check(`${tag} a tap on a bar shows that hour; a second tap lets go`, /\d:\d\d/.test(picked.when) && Math.abs(num(picked.kwh) - 0.5) < 0.01, JSON.stringify([picked.kwh, picked.when]));
    await tap(0, ".bar", 0);
    check(`${tag} and the total is back`, (await read(0)).kwh === before, (await read(0)).kwh);

    // a tariff that is not there falls back to the fixed price; the older `price: sensor.x` still names a tariff
    await page.evaluate((width) => {
      window.mount("savvy-energy-card", { total: "sensor.house_energy", tariff: "sensor.not_there", price: 0.5, currency: "EUR" }, width);   // 4
      window.mount("savvy-energy-card", { total: "sensor.house_energy", price: "sensor.tariff", currency: "EUR" }, width);                   // 5
    }, width);
    await page.waitForTimeout(900);
    const fb = await read(4), old = await read(5);
    check(`${tag} no tariff entity: the fixed price counts`, Math.abs(num(fb.cost) - exp.kwh * 0.5) < 0.02, JSON.stringify([fb.cost, exp.kwh * 0.5]));
    check(`${tag} the older price: sensor.x is still a tariff`, Math.abs(num(old.cost) - exp.cost) < 0.02, JSON.stringify([old.cost, exp.cost]));

    // the statistics are not there
    await page.evaluate(() => { window.__fail = true; });
    await page.evaluate((width) => window.mount("savvy-energy-card", { total: "sensor.house_energy" }, width), width);
    await page.waitForTimeout(800);
    check(`${tag} when Home Assistant can't answer it says so`, /Couldn't read/.test((await read(6)).empty), (await read(6)).empty);

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
