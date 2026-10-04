// savvy-fan-card: fans, air purifiers and humidifiers as the popup's rows, inline, with All off.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => {
    house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
    h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  add("fan.bedroom_fan", "on", { friendly_name: "Bedroom Fan", percentage: 50, percentage_step: 10, preset_modes: ["auto", "sleep", "turbo"], preset_mode: "auto", oscillating: false, supported_features: 1 | 2 | 8 }, "bedroom");
  add("fan.bedroom_purifier", "off", { friendly_name: "Bedroom Purifier", preset_modes: ["auto", "sleep"], supported_features: 8 }, "bedroom");
  add("humidifier.bedroom_humidifier", "on", { friendly_name: "Bedroom Humidifier", humidity: 50, current_humidity: 38, min_humidity: 30, max_humidity: 80, available_modes: ["normal", "eco", "sleep"], mode: "normal" }, "bedroom");
  window.hass = { ...h, states: { ...house.states } };
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP);
    await page.evaluate((width) => {
      window.mount("savvy-fan-card", { area: "bedroom" }, width);                       // 0
      window.mount("savvy-fan-card", { kinds: ["fan"], exclude: ["fan.bedroom_purifier"] }, width);   // 1
      window.mount("savvy-fan-card", { layout: "compact" }, width);                     // 2
    }, width);
    await page.waitForTimeout(1200);
    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return { title: R.getElementById("title").textContent, pill: R.getElementById("pill").textContent, names: [...R.querySelectorAll(".sv-row .sv-name")].map((n) => n.textContent),
        off: R.getElementById("off").hidden ? "hidden" : R.getElementById("off").hasAttribute("disabled") ? "disabled" : "on", rows: !R.getElementById("rows").hidden };
    }, i);
    const a = await read(0), b = await read(1), c = await read(2);
    check(`${tag} fans, purifiers and humidifiers of the area; the title says Air with a humidifier`, a.names.length === 3 && a.title === "Bedroom air" && a.pill === "2 on", JSON.stringify(a));
    check(`${tag} kinds and exclude; only fans reads Fans`, JSON.stringify(b.names) === JSON.stringify(["Fan"]) && b.title === "Fans", JSON.stringify(b));
    check(`${tag} compact: no rows`, !c.rows && c.off === "on", JSON.stringify(c));
    const spin = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".sv-row")].map((r) => [r.querySelector(".sv-name").textContent, (r.querySelector(".sv-ic > *").style.transform || "").includes("rotate")]));
    check(`${tag} a running fan's icon turns, an idle one's does not`, spin.find((x) => x[0] === "Fan")[1] && !spin.find((x) => x[0] === "Purifier")[1], JSON.stringify(spin));

    const calls = async (fn) => { await page.evaluate(() => { window.log.length = 0; }); await fn(); await page.waitForTimeout(500); return page.evaluate(() => [...window.log]); };
    const click = async (sel, i = 0, card = 0, filter) => {
      const p = await page.evaluate(({ sel, i, card, filter }) => { let all = [...window.cards[card].shadowRoot.querySelectorAll(sel)]; if (filter) all = all.filter((e) => new RegExp(filter).test(e.textContent)); const e = all[i]; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { sel, i, card, filter });
      await page.mouse.click(p.x, p.y);
    };
    const rowIdx = (name) => page.evaluate((name) => [...window.cards[0].shadowRoot.querySelectorAll(".sv-row")].findIndex((r) => r.querySelector(".sv-name").textContent === name), name);

    // the fan: speed, preset mode, oscillation behind the chevron
    const fi = await rowIdx("Fan");
    await click(`.sv-row:nth-of-type(${fi + 1}) .sv-chev`);
    await page.waitForTimeout(500);
    const ctl = await page.evaluate((n) => { const r = window.cards[0].shadowRoot.querySelectorAll(".sv-row")[n]; return { bar: r.querySelector(".sv-bar").getAttribute("aria-valuenow"), seg: [...r.querySelectorAll(".sv-seg-b")].map((b) => b.textContent), osc: !!r.querySelector('.sv-btn[aria-label="Oscillate"]:not([hidden])') }; }, fi);
    check(`${tag} the fan has its speed, its modes and oscillation`, ctl.bar === "50" && JSON.stringify(ctl.seg) === JSON.stringify(["Auto", "Sleep", "Turbo"]) && ctl.osc, JSON.stringify(ctl));
    const speed = await calls(async () => { await page.evaluate((n) => window.cards[0].shadowRoot.querySelectorAll(".sv-row")[n].querySelector(".sv-bar").focus(), fi); await page.keyboard.press("ArrowRight"); });
    check(`${tag} the speed bar sets the percentage`, speed.some((x) => /^fan\.set_percentage \{"percentage":60\} fan\.bedroom_fan$/.test(x)), JSON.stringify(speed));
    const preset = await calls(() => click(`.sv-row:nth-of-type(${fi + 1}) .sv-seg-b`, 1, 0));
    check(`${tag} a mode sets the preset`, preset.some((x) => /^fan\.set_preset_mode \{"preset_mode":"sleep"\} fan\.bedroom_fan$/.test(x)), JSON.stringify(preset));
    const osc = await calls(() => click(`.sv-row:nth-of-type(${fi + 1}) .sv-btn[aria-label="Oscillate"]`));
    check(`${tag} oscillation toggles`, osc.some((x) => /^fan\.oscillate \{"oscillating":true\} fan\.bedroom_fan$/.test(x)), JSON.stringify(osc));

    // the humidifier: target humidity and modes
    const hi = await rowIdx("Humidifier");
    await click(`.sv-row:nth-of-type(${hi + 1}) .sv-chev`);
    await page.waitForTimeout(500);
    const hum = await calls(async () => { await page.evaluate((n) => window.cards[0].shadowRoot.querySelectorAll(".sv-row")[n].querySelector(".sv-bar").focus(), hi); await page.keyboard.press("ArrowRight"); });
    check(`${tag} the target humidity bar sets a humidity inside its range`, hum.some((x) => /^humidifier\.set_humidity \{"humidity":5[23]\} humidifier\.bedroom_humidifier$/.test(x)), JSON.stringify(hum));
    const mode = await calls(() => click(`.sv-row:nth-of-type(${hi + 1}) .sv-seg-b`, 1, 0));
    check(`${tag} a humidifier mode`, mode.some((x) => /^humidifier\.set_mode \{"mode":"eco"\} humidifier\.bedroom_humidifier$/.test(x)), JSON.stringify(mode));
    const sub = await page.evaluate((n) => window.cards[0].shadowRoot.querySelectorAll(".sv-row")[n].querySelector(".sv-sub").textContent, hi);
    check(`${tag} the humidifier says its humidity now and its target`, /38% now · target 50%/.test(sub), sub);

    // all off
    const off = await calls(() => click("#off"));
    check(`${tag} All off turns off what is on, per kind`, off.length === 2 && off.some((x) => /^fan\.turn_off \{\} 1 entities$/.test(x)) && off.some((x) => /^humidifier\.turn_off \{\} 1 entities$/.test(x)), JSON.stringify(off));

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
