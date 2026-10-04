// savvy-graph-card colours beyond good / warn / bad: threshold colours (HA names, hex), smooth blending,
// the temperature / humidity / battery presets (Fahrenheit converted), one colour per entity, the colour
// scale editor, reduced motion. Assertions read channels, not exact strings, and nothing depends on fonts.
import { openPage, idle } from "./_util.mjs";

const RECORDER = `window.hass.callWS = async (m) => {
  const now = Date.now(), H = 3600000, out = {};
  for (const id of m.entity_ids || m.statistic_ids) out[id] = Array.from({ length: 48 }, (_, i) => ({ s: String(20 + 5 * Math.sin(i / 6)), lu: (now - (48 - i) * H / 2) / 1000 }));
  return out;
};
window.rgb = (css) => {
  const d = document.createElement("div");
  document.body.appendChild(d);
  d.style.color = css;
  const c = getComputedStyle(d).color;
  d.remove();
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const x = cv.getContext("2d", { willReadFrequently: true });
  x.fillStyle = c;
  x.fillRect(0, 0, 1, 1);
  return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
};
window.readTile = (el, i = 0) => {
  const R = el.shadowRoot, t = R.querySelectorAll("#graphs .tile")[i];
  const stops = [...t.querySelectorAll("linearGradient[id^='g-'] stop")].map((s) => s.style.stopColor);
  return { tile: t.style.getPropertyValue("--tile-lvl"), stops, dot: t.querySelector(".dot")?.style.fill || "" };
};`;

const near = (a, b, tol = 14) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) {
    const tag = `[${theme}]`;
    const { page, errors } = await openPage(browser, base, { theme, width: 520 });
    await page.evaluate(RECORDER);
    const r = await page.evaluate(async () => {
      const mount = (item) => window.mount("savvy-graph-card", { entities: [{ entity: "sensor.living_room_temperature", ...item }] }, 520);
      const cases = {
        level: { thresholds: [{ value: 0, level: "good" }, { value: 23, level: "warn" }, { value: 26, level: "bad" }] },
        names: { thresholds: [{ value: 0, color: "blue" }, { value: 20, color: "orange" }, { value: 30, color: "#ff0000" }] },
        hex: { thresholds: [{ value: 0, color: "#00ff00" }] },
        smooth: { smooth: true, thresholds: [{ value: 10, color: "#0000ff" }, { value: 30, color: "#ff0000" }] },
        single: { color: "teal" },
        temperature: { thresholds: "temperature" },
        hard: { thresholds: "temperature", smooth: false },
        humidity: { thresholds: "humidity" },
        battery: { thresholds: "battery" },
        plain: {},
      };
      const els = {};
      for (const [k, v] of Object.entries(cases)) els[k] = mount(v);
      // a Fahrenheit sensor reading the same temperature as the Celsius one
      window.setStates({ "sensor.kitchen_temperature": { state: "74.48", attributes: { friendly_name: "Kitchen Temperature", device_class: "temperature", unit_of_measurement: "°F", state_class: "measurement" } } });
      els.fahrenheit = window.mount("savvy-graph-card", { entities: [{ entity: "sensor.kitchen_temperature", thresholds: "temperature" }] }, 520);
      await new Promise((res) => setTimeout(res, 1600));
      const out = {};
      for (const [k, el] of Object.entries(els)) {
        const t = window.readTile(el);
        out[k] = { tile: t.tile, stops: t.stops, tileRgb: t.tile ? window.rgb(t.tile) : null, stopRgb: t.stops.map(window.rgb), dot: t.dot };
      }
      return out;
    });

    check(`${tag} level thresholds are unchanged (the tile and the line use the level colours)`,
      r.level.tile === "var(--lvl-warn)" && r.level.stops.some((s) => s === "var(--lvl-warn)") && r.level.stops.every((s) => /^var\(--lvl-(good|warn|bad)\)$/.test(s)), JSON.stringify(r.level));
    check(`${tag} HA colour names work on a threshold (orange up, blue below, a hard step between)`,
      near(r.names.stopRgb[0], [255, 152, 0]) && near(r.names.stopRgb.at(-1), [33, 150, 243]) && r.names.stops.length > 2, JSON.stringify(r.names.stopRgb));
    check(`${tag} the tile takes the colour of its value`, near(r.names.tileRgb, [255, 152, 0]), JSON.stringify(r.names.tileRgb));
    check(`${tag} a hex colour works on a threshold`, r.hex.stopRgb.every((c) => near(c, [0, 255, 0])) && near(r.hex.tileRgb, [0, 255, 0]), JSON.stringify(r.hex.stopRgb));
    check(`${tag} smooth blends: many stops, blue at the low end, red at the high end, a blend between`,
      r.smooth.stops.length >= 12 && r.smooth.stopRgb[0][0] > 150 && r.smooth.stopRgb[0][2] < 110 && r.smooth.stopRgb.at(-1)[2] > 150 && r.smooth.stopRgb.at(-1)[0] < 110, JSON.stringify([r.smooth.stopRgb[0], r.smooth.stopRgb.at(-1)]));
    const mid = r.smooth.tileRgb;
    check(`${tag} smooth: the tile colour is between the two stops (neither end)`, mid[0] > 60 && mid[0] < 235 && mid[2] > 20 && mid[2] < 200 && /color-mix/.test(r.smooth.tile), JSON.stringify([r.smooth.tile, mid]));
    // the red channel falls steadily from the top of the line to the bottom
    const reds = r.smooth.stopRgb.map((c) => c[0]);
    check(`${tag} smooth: the gradient moves one way (no muddy middle)`, reds.every((v, i) => !i || v <= reds[i - 1] + 3), JSON.stringify(reds));
    check(`${tag} one colour per entity: the whole line and the tile`, r.single.stopRgb.every((c) => near(c, [0, 150, 136])) && near(r.single.tileRgb, [0, 150, 136]), JSON.stringify(r.single));
    check(`${tag} no thresholds and no colour: the accent as before`, r.plain.tile === "" && r.plain.stops.every((s) => /accent/.test(s)), JSON.stringify(r.plain));
    check(`${tag} the temperature preset is smooth and runs blue to red (cold below, warm above)`,
      /color-mix/.test(r.temperature.tile) && r.temperature.stopRgb.length >= 12 && r.temperature.stopRgb[0][0] > r.temperature.stopRgb.at(-1)[0], JSON.stringify([r.temperature.tile, r.temperature.stopRgb.length]));
    check(`${tag} smooth: false on a preset gives hard steps in the preset's colours`, !/color-mix/.test(r.hard.tile) && /--(green|amber)-color/.test(r.hard.tile), r.hard.tile);
    check(`${tag} the temperature preset in °F lands on the same colour as °C`, near(r.fahrenheit.tileRgb, r.temperature.tileRgb, 10), JSON.stringify([r.fahrenheit.tileRgb, r.temperature.tileRgb]));
    check(`${tag} the humidity preset is stepped and the battery preset too`, !/color-mix/.test(r.humidity.tile) && !/color-mix/.test(r.battery.tile) && /--[a-z-]+-color/.test(r.battery.tile), JSON.stringify([r.humidity.tile, r.battery.tile]));

    // a reading that crosses a threshold: colour slides, reduced motion snaps
    const slide = await page.evaluate(async () => {
      const el = window.mount("savvy-graph-card", { entities: [{ entity: "sensor.living_room_temperature", thresholds: [{ value: 0, color: "blue" }, { value: 25, color: "red" }] }] }, 520);
      await new Promise((res) => setTimeout(res, 1400));
      const before = window.readTile(el).tile;
      window.setStates({ "sensor.living_room_temperature": { state: "27", attributes: { friendly_name: "Living Room Temperature", device_class: "temperature", unit_of_measurement: "°C", state_class: "measurement" } } });
      const seen = new Set();
      for (let i = 0; i < 40; i++) { await new Promise((res) => requestAnimationFrame(res)); seen.add(window.readTile(el).tile); }
      await new Promise((res) => setTimeout(res, 900));
      return { before, seen: seen.size, after: window.readTile(el).tile };
    });
    check(`${tag} a colour change slides (in-between colours show) and settles on the new one`, slide.seen >= 3 && /red/.test(slide.after) && /blue/.test(slide.before), JSON.stringify(slide));
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // reduced motion: the colour is the new one at once
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 520 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(RECORDER);
    const snap = await page.evaluate(async () => {
      const el = window.mount("savvy-graph-card", { entities: [{ entity: "sensor.living_room_temperature", thresholds: [{ value: 0, color: "blue" }, { value: 25, color: "red" }] }] }, 520);
      await new Promise((res) => setTimeout(res, 1400));
      window.setStates({ "sensor.living_room_temperature": { state: "27", attributes: { friendly_name: "Living Room Temperature", device_class: "temperature", unit_of_measurement: "°C", state_class: "measurement" } } });
      await new Promise((res) => requestAnimationFrame(res));
      await new Promise((res) => requestAnimationFrame(res));
      return window.readTile(el).tile;
    });
    check("[reduced motion] the colour snaps to the new one", /red/.test(snap) && !/color-mix/.test(snap), snap);
    check("[reduced motion] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // the editor: a colour scale list with a preset select, an add button and one row per threshold
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 520 });
    const ed = await page.evaluate(async () => {
      const el = document.createElement("savvy-graph-card-editor");
      document.getElementById("stage").appendChild(el);
      el.hass = window.hass;
      const sent = [];
      el.addEventListener("config-changed", (e) => sent.push(JSON.parse(JSON.stringify(e.detail.config))));
      el.setConfig({ type: "custom:savvy-graph-card", entities: [{ entity: "sensor.living_room_temperature", thresholds: [{ value: 0, color: "blue" }] }] });
      await new Promise((res) => setTimeout(res, 300));
      const tiles = el.shadowRoot.querySelector('savvy-list-editor[data-key="list:entities"]');
      tiles._openIdx = 0; tiles._render();
      await new Promise((res) => setTimeout(res, 200));
      const scale = tiles.shadowRoot.querySelector("savvy-list-editor");
      const out = { hasScale: !!scale, rows: scale?._items.length, label: scale?._spec.label, presets: scale?._spec.presets };
      scale.shadowRoot.querySelector(".sv-add button").click();
      await new Promise((res) => setTimeout(res, 200));
      out.afterAdd = sent.at(-1)?.entities?.[0]?.thresholds;
      // pick a preset: the config holds its name; picking none again returns to a list
      const pf = scale.shadowRoot.querySelector("ha-form");
      pf.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { preset: "temperature" } } }));
      await new Promise((res) => setTimeout(res, 200));
      out.afterPreset = sent.at(-1)?.entities?.[0]?.thresholds;
      out.listHidden = scale.shadowRoot.querySelector(".sv-list")?.hidden;
      return out;
    });
    check("[editor] the colour scale is a list with a preset select", ed.hasScale && ed.rows === 1 && ed.label === "Colour scale" && ed.presets?.length === 3, JSON.stringify(ed));
    check("[editor] Add threshold adds a row and writes it to the config", Array.isArray(ed.afterAdd) && ed.afterAdd.length === 2 && ed.afterAdd[1].value === 10, JSON.stringify(ed.afterAdd));
    check("[editor] a preset is written as its name and hides the rows", ed.afterPreset === "temperature" && ed.listHidden === true, JSON.stringify([ed.afterPreset, ed.listHidden]));
    check("[editor] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
