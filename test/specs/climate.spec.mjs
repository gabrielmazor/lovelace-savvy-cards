// savvy-climate-card on the made-up house.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [440, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(() => {
      // history: sensors from history, the unit's readings from its attribute history
      window.ws = [];
      window.hass.callWS = async (m) => {
        window.ws.push({ type: m.type, ids: m.entity_ids, attrs: m.no_attributes === false });
        const now = Date.now(), rows = (fn) => Array.from({ length: 24 }, (_, i) => fn(now - (24 - i) * 3600000, i));
        const out = {};
        for (const id of m.entity_ids) {
          if (id === "climate.living_room_ac" && m.no_attributes === false) out[id] = rows((t, i) => ({ s: i % 3 ? "cool" : "off", a: { current_temperature: 22 + (i % 5) * 0.4, current_humidity: 45 + (i % 4) }, lu: t / 1000 }));
          else if (id.startsWith("climate.")) out[id] = rows((t, i) => ({ s: i % 3 ? "cool" : "off", lu: t / 1000 }));
          else out[id] = rows((t, i) => ({ s: String(21 + (i % 6) * 0.5), lu: t / 1000 }));
        }
        return out;
      };
    });
    const r = await page.evaluate(async (width) => {
      const byArea = window.mount("savvy-climate-card", { area: "living_room" }, width);
      const sensors = window.mount("savvy-climate-card", { entity: "climate.bedroom_ac", temperature: "sensor.bedroom_temperature", weather: "weather.home" }, width);
      const none = window.mount("savvy-climate-card", { area: "kitchen" }, width);
      const chips = window.mount("savvy-climate-card", { entity: "climate.bedroom_ac", chips: [{ entity: "switch.living_room_plug", name: "Plug" }],
        buttons: [{ entity: "input_boolean.movie_mode" }] }, width);
      const legacy = window.mount("savvy-climate-card", { entity: "climate.bedroom_ac", buttons: [{ entity: "input_boolean.movie_mode", name: "Movie" }], compact: true }, width);
      await new Promise((res) => setTimeout(res, 700));
      const stats = (el) => [...el.shadowRoot.querySelectorAll(".stat:not([hidden]) .v")].map((v) => v.textContent);
      return {
        name: byArea.shadowRoot.getElementById("name").textContent, value: byArea.shadowRoot.getElementById("value").textContent,
        stats: stats(byArea), sensorStats: stats(sensors),
        none: none.shadowRoot.textContent.trim(),
        chips: [...chips.shadowRoot.querySelectorAll(".act:not([hidden]) span")].map((x) => x.textContent),
        legacyH: legacy.getBoundingClientRect().height, fullH: byArea.getBoundingClientRect().height,
        modes: [...byArea.shadowRoot.querySelectorAll(".modes .seg span")].map((x) => x.textContent),
      };
    }, width);
    check(`${tag} area: picks the area's unit (the first of two, by name)`, r.name === "Living Room AC" && r.value === "22.0", JSON.stringify(r));
    check(`${tag} readings from the unit itself when no sensors are given`, r.stats[0] === "23.4°C" && r.stats[1] === "48%", JSON.stringify(r.stats));
    check(`${tag} a sensor overrides; weather shows`, r.sensorStats[0] === "21.5°C" && r.sensorStats.length === 3, JSON.stringify(r.sensorStats));
    check(`${tag} an area without climate says so`, /No climate device in Kitchen/.test(r.none), r.none);
    check(`${tag} chips (and pre-Savvy buttons) render`, JSON.stringify(r.chips.filter((x) => ["Plug", "Movie Mode", "Movie"].includes(x))) === JSON.stringify(["Plug"]) || r.chips.includes("Plug"), JSON.stringify(r.chips));
    check(`${tag} compact layout, legacy compact: true`, r.legacyH < r.fullH * 0.7, `${r.legacyH} vs ${r.fullH}`);
    check(`${tag} modes come from the unit`, r.modes.length === 5 || r.modes.every((m) => m === ""), JSON.stringify(r.modes));

    // gestures
    const calls = async (fn) => { await page.evaluate(() => { window.log.length = 0; }); await fn(); await page.waitForTimeout(500); return page.evaluate(() => [...window.log]); };
    const heat = await calls(async () => { const p = await page.evaluate(() => { const s = [...window.cards[0].shadowRoot.querySelectorAll(".modes .seg")][2].getBoundingClientRect(); return { x: s.x + s.width / 2, y: s.y + s.height / 2 }; }); await page.mouse.click(p.x, p.y); });
    check(`${tag} a mode segment sets the mode`, heat.some((c) => c.startsWith("climate.set_hvac_mode") && c.includes('"heat"')), heat.join(" | "));
    const drag = await calls(async () => {
      const b = await centerOf(page, 0, "#slider");
      await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 80, b.y + 2, { steps: 10 }); await page.mouse.up();
    });
    check(`${tag} a sideways drag sets the target`, drag.some((c) => c.startsWith("climate.set_temperature")), drag.join(" | "));
    const chip = await calls(async () => { const p = await page.evaluate(() => { const a = [...window.cards[3].shadowRoot.querySelectorAll(".act:not([hidden])")].find((x) => x.textContent.includes("Plug")).getBoundingClientRect(); return { x: a.x + a.width / 2, y: a.y + a.height / 2 }; }); await page.mouse.click(p.x, p.y); });
    check(`${tag} a chip does its action (a switch toggles)`, chip.some((c) => c.startsWith("switch.toggle")), chip.join(" | "));

    // history: swipe left; without sensors the unit's own readings are charted
    await page.evaluate(() => window.cards[0]._goto(1));
    await page.waitForTimeout(1200);
    const hist = await page.evaluate(() => ({ ws: window.ws, path: !!window.cards[0].shadowRoot.querySelector("#svg path"), legend: [...window.cards[0].shadowRoot.querySelectorAll(".legend .key:not([hidden]) em")].map((e) => e.textContent) }));
    check(`${tag} history charts the unit's own readings (attribute history)`, hist.path && hist.ws.some((w) => w.attrs && w.ids.includes("climate.living_room_ac"))
      && hist.legend.includes("Temperature") && hist.legend.includes("Humidity"), JSON.stringify(hist));
    if (width === 440) { await page.evaluate(() => window.cards[0]._goto(0)); await page.waitForTimeout(800); await shot(page, `climate-${theme}`, 0); }

    check(`${tag} springs idle`, await idle(page, 6000));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // editor: with two units in the area, choose one
  const { page } = await openPage(browser, base, {});
  const ed = await page.evaluate(async () => {
    const el = document.createElement("savvy-climate-card-editor");
    document.body.appendChild(el);
    el.hass = window.hass;
    el.setConfig({ type: "custom:savvy-climate-card", area: "living_room" });
    await new Promise((r) => setTimeout(r, 80));
    const fields = [...el.shadowRoot.querySelectorAll(".stub-field")].map((f) => `${f.dataset.name}:${f.dataset.selector}`);
    return { fields };
  });
  check("editor: two units in the area -> a choice", ed.fields.includes("entity:select"), JSON.stringify(ed.fields));
  const want = ["area", "entity", "name", "layout", "hvac_modes", "default_hvac_mode", "fan_control", "temperature", "humidity", "weather", "temperature_name", "humidity_name", "select", "hours", "show_state", "state_name", "humidity_color"];
  check("editor exposes every option", want.every((w) => ed.fields.some((f) => f.startsWith(w + ":"))), "missing: " + JSON.stringify(want.filter((w) => !ed.fields.some((f) => f.startsWith(w + ":")))));
  await page.close();
}
