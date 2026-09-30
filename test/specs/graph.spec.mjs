// savvy-graph-card on the made-up house, with a faked recorder.
import { openPage, idle, shot } from "./_util.mjs";

// History for a day (a wave), and statistics for a month; records what was asked for.
const RECORDER = `window.asked = [];
window.hass.callWS = async (m) => {
  window.asked.push(m.type + ":" + (m.entity_ids || m.statistic_ids).join(",") + (m.period ? ":" + m.period : ""));
  const now = Date.now(), H = 3600000, out = {};
  for (const id of m.entity_ids || m.statistic_ids) {
    if (m.type === "history/history_during_period") out[id] = Array.from({ length: 48 }, (_, i) => ({ s: String(20 + 5 * Math.sin(i / 6)), lu: (now - (48 - i) * H / 2) / 1000 }));
    else out[id] = Array.from({ length: 30 }, (_, i) => ({ mean: 3 + (i % 7), start: now - (30 - i) * 24 * H }));
  }
  return out;
};`;

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [520, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(RECORDER);
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-graph-card", { title: "House", entities: [
        { entity: "sensor.living_room_temperature", name: "Living", thresholds: [{ value: 0, level: "good" }, { value: 23, level: "warn" }, { value: 26, level: "bad" }] },
        { entity: "sensor.energy_cost", name: "Energy", hours_to_show: 720 },
        { entity: "binary_sensor.living_room_door", name: "Door", state_color: true },
        { entity: "sensor.watchman_last_parse", name: "Checked" },
        { entity: "sensor.not_there" }] }, width);
      window.mount("savvy-graph-card", { entities: ["sensor.kitchen_temperature"], ranges: [24, 168] }, width);
      await new Promise((res) => setTimeout(res, 1400));
      const read = (el) => {
        const R = el.shadowRoot;
        return { graphs: [...R.querySelectorAll("#graphs .tile")].map((t) => `${t.querySelector(".cap").textContent}|${t.querySelector(".val .n").textContent}${t.querySelector(".val .u").textContent}|${t.querySelector("svg path") ? "chart" : t.querySelector(".cnote").textContent}`),
          small: [...R.querySelectorAll("#grid .tile")].map((t) => `${t.querySelector(".cap").textContent}|${t.querySelector(".note").hidden ? t.querySelector(".val .n").textContent : t.querySelector(".note").textContent}`),
          lvl: [...R.querySelectorAll(".tile")].map((t) => t.style.getPropertyValue("--tile-lvl")),
          ranges: [...R.querySelectorAll(".rseg")].map((s) => `${s.textContent}${s.hasAttribute("data-sel") ? "*" : ""}`), head: !R.getElementById("head").hidden };
      };
      return { cards: window.cards.map(read), asked: [...window.asked] };
    }, width);
    const [a, b] = r.cards;
    check(`${tag} numbers get graphs; the rest small tiles`, JSON.stringify(a.graphs) === JSON.stringify(["Living|23.6°C|chart", "Energy|3.45$|chart"])
      && JSON.stringify(a.small) === JSON.stringify(["Door|Off", "Checked|2 hours ago", "Not There|Not found"]), JSON.stringify(a));
    check(`${tag} thresholds colour a graph; state_color an on/off tile`, a.lvl[0] === "var(--lvl-warn)" && a.lvl[2] === "var(--lvl-bad)", JSON.stringify(a.lvl));
    check(`${tag} a day reads history; 30 days reads hourly long-term statistics, each range one call`,
      r.asked.includes("history/history_during_period:sensor.living_room_temperature") && r.asked.includes("recorder/statistics_during_period:sensor.energy_cost:hour"), JSON.stringify(r.asked));
    check(`${tag} the hours selector is opt-in`, !a.ranges.length && JSON.stringify(b.ranges) === JSON.stringify(["24h*", "7d"]) && b.head, JSON.stringify([a.ranges, b.ranges]));

    // the selector switches range; a tap opens more-info; a mouse over the chart scrubs
    await page.evaluate(() => { window.asked.length = 0; window.info = []; document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId)); });
    const seg = await page.evaluate(() => { const s = window.cards[1].shadowRoot.querySelectorAll(".rseg")[1].getBoundingClientRect(); return [s.x + s.width / 2, s.y + s.height / 2]; });
    await page.mouse.click(...seg);
    await page.waitForTimeout(800);
    const tile = await page.evaluate(() => { const s = window.cards[0].shadowRoot.querySelector("#grid .tile").getBoundingClientRect(); return [s.x + s.width / 2, s.y + s.height / 2]; });
    await page.mouse.click(...tile);
    const chart = await page.evaluate(() => { const s = window.cards[0].shadowRoot.querySelector(".chart").getBoundingClientRect(); return [s.x + s.width * 0.6, s.y + s.height / 2]; });
    await page.mouse.move(...chart);
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => ({ asked: [...window.asked], info: [...window.info], sel: [...window.cards[1].shadowRoot.querySelectorAll(".rseg")].map((s) => s.hasAttribute("data-sel")),
      bubble: window.cards[0].shadowRoot.querySelector(".bubble").textContent, op: window.cards[0].shadowRoot.querySelector(".bubble").style.opacity }));
    check(`${tag} the selector switches range and refetches`, g.sel[1] && g.asked.some((x) => x.startsWith("history/history_during_period:sensor.kitchen_temperature")), JSON.stringify(g));
    check(`${tag} a tap opens more-info; hovering the chart scrubs`, g.info[0] === "binary_sensor.living_room_door" && /\d/.test(g.bubble) && Number(g.op) > 0.5, JSON.stringify(g));
    await page.mouse.move(5, 5);
    check(`${tag} springs idle`, await idle(page));
    if (width === 520) await shot(page, `graph-${theme}`, 0);
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // a tile can chart one attribute (a weather entity's humidity): its value, unit and history
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    const r = await page.evaluate(async () => {
      window.asked = [];
      window.hass.callWS = async (m) => {
        window.asked.push(`${m.type}:${m.entity_ids.join(",")}:${m.minimal_response}`);
        const now = Date.now(), H = 3600000;
        return { [m.entity_ids[0]]: Array.from({ length: 24 }, (_, i) => ({ s: "sunny", lu: (now - (24 - i) * H) / 1000, a: { humidity: 30 + i, temperature: 20 } })) };
      };
      window.mount("savvy-graph-card", { entities: [{ entity: "weather.home", attribute: "humidity", unit: "%", name: "Humidity" }, { entity: "weather.home", attribute: "temperature", unit: "°" }] }, 420);
      await new Promise((res) => setTimeout(res, 1200));
      const R = window.cards[0].shadowRoot;
      return { tiles: [...R.querySelectorAll("#graphs .tile")].map((t) => `${t.querySelector(".cap").textContent}|${t.querySelector(".val .n").textContent}${t.querySelector(".val .u").textContent}|${t.querySelector("svg path") ? "chart" : t.querySelector(".cnote").textContent}`), asked: window.asked };
    });
    check("an attribute is charted with its own value, unit and history", r.tiles.length === 2 && r.tiles[0] === "Humidity|40%|chart" && r.tiles[1].startsWith("Temperature|26") && r.asked.some((x) => x.endsWith(":false")), JSON.stringify(r));
    check("attribute tile: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
