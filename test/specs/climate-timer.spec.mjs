// The climate card's timer: tap lists durations and starts the timer helper; running, tap offers +15 min,
// pause / resume and cancel; the old `select` still steps its list when no durations are given.
import { openPage, idle } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const setTimer = (state, extra = {}) => page.evaluate(({ state, extra }) => {
      const st = { entity_id: "timer.ac_off", state, attributes: { friendly_name: "AC off", duration: "0:30:00", ...extra }, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
      window.hass = { ...window.hass, states: { ...window.hass.states, "timer.ac_off": st } };
      window.cards.forEach((c) => { c.hass = window.hass; });
    }, { state, extra });
    await page.evaluate((width) => {
      window.hass = { ...window.hass, states: { ...window.hass.states,
        "timer.ac_off": { entity_id: "timer.ac_off", state: "idle", attributes: { friendly_name: "AC off", duration: "0:30:00" }, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() },
        "input_select.ac_timer": { entity_id: "input_select.ac_timer", state: "30 min", attributes: { options: ["15 min", "30 min"], friendly_name: "AC timer" }, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() } } };
      window.mount("savvy-climate-card", { entity: "climate.bedroom_ac", timer: { entity: "timer.ac_off" } }, width);
      window.mount("savvy-climate-card", { entity: "climate.bedroom_ac", timer: { entity: "timer.ac_off", presets: [10, 90, 240] } }, width);
      window.mount("savvy-climate-card", { entity: "climate.bedroom_ac", timer: { entity: "timer.ac_off", select: "input_select.ac_timer" } }, width);
    }, width);
    await page.waitForTimeout(700);
    const calls = async (fn) => { await page.evaluate(() => { window.log.length = 0; }); await fn(); await page.waitForTimeout(500); return page.evaluate(() => [...window.log]); };
    const chip = (i) => page.evaluate((i) => { const a = window.cards[i].shadowRoot.querySelector('.act[data-key="timer"], .actions .act:not([hidden])'); const r = [...window.cards[i].shadowRoot.querySelectorAll(".act:not([hidden])")].find((x) => /AC off|Timer|off in|Paused|30 min/i.test(x.textContent))?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i);
    const click = async (i) => { const p = await chip(i); await page.mouse.click(p.x, p.y); await page.waitForTimeout(450); };
    const options = () => page.evaluate(() => [...(document.querySelector(".savvy-portal")?.shadowRoot || document).querySelectorAll(".sv-pick .sv-opt, .sv-pick .cap")].map((o) => o.textContent.trim()));
    const choose = async (label) => {
      const p = await page.evaluate((label) => { const o = [...(document.querySelector(".savvy-portal")?.shadowRoot || document).querySelectorAll(".sv-pick .sv-opt")].find((x) => x.textContent.trim() === label)?.getBoundingClientRect(); return o && { x: o.x + o.width / 2, y: o.y + o.height / 2 }; }, label);
      await page.mouse.click(p.x, p.y);
    };

    // idle: the default durations, then a pick starts the helper
    await click(0);
    const def = await options();
    check(`${tag} idle: a tap lists 15, 30, 1 hour and 2 hours`, JSON.stringify(def.slice(1)) === JSON.stringify(["15 min", "30 min", "1 hour", "2 hours"]), JSON.stringify(def));
    const start = await calls(() => choose("1 hour"));
    check(`${tag} a pick starts the timer helper with that duration`, start.length === 1 && start[0] === 'timer.start {"duration":"01:00:00"} timer.ac_off', JSON.stringify(start));
    check(`${tag} picking closes the list`, (await options()).length === 0 || (await page.waitForTimeout(500), (await options()).length === 0));

    // your own durations
    await click(1);
    const own = await options();
    check(`${tag} presets set the list`, JSON.stringify(own.slice(1)) === JSON.stringify(["10 min", "1 h 30 min", "4 hours"]), JSON.stringify(own));
    const s2 = await calls(() => choose("1 h 30 min"));
    check(`${tag} 90 minutes is 01:30:00`, s2[0] === 'timer.start {"duration":"01:30:00"} timer.ac_off', JSON.stringify(s2));

    // running: +15, pause, cancel
    await setTimer("active", { finishes_at: new Date(Date.now() + 29 * 60000 + 30000).toISOString(), remaining: "0:29:30" });
    await page.waitForTimeout(500);
    const running = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".act:not([hidden])")].map((x) => x.textContent.trim()));
    check(`${tag} running: the chip is the countdown`, running.some((t) => /off in 29m/.test(t)), JSON.stringify(running));
    await click(0);
    const menu = await options();
    check(`${tag} running: +15 min, Pause, Cancel`, JSON.stringify(menu.slice(1)) === JSON.stringify(["+15 min", "Pause", "Cancel"]), JSON.stringify(menu));
    const add = await calls(() => choose("+15 min"));
    check(`${tag} +15 min changes the timer by 15 minutes`, add[0] === 'timer.change {"duration":"00:15:00"} timer.ac_off', JSON.stringify(add));
    await click(0);
    const pause = await calls(() => choose("Pause"));
    check(`${tag} Pause pauses the timer`, pause[0] === "timer.pause {} timer.ac_off", JSON.stringify(pause));
    await click(0);
    const cancel = await calls(() => choose("Cancel"));
    check(`${tag} Cancel cancels the timer`, cancel[0] === "timer.cancel {} timer.ac_off", JSON.stringify(cancel));

    // paused: Resume restarts it
    await setTimer("paused", { remaining: "0:20:00" });
    await page.waitForTimeout(500);
    await click(0);
    const pm = await options();
    check(`${tag} paused: Resume replaces Pause`, JSON.stringify(pm.slice(1)) === JSON.stringify(["+15 min", "Resume", "Cancel"]), JSON.stringify(pm));
    const resume = await calls(() => choose("Resume"));
    check(`${tag} Resume starts it again`, resume[0] === "timer.start {} timer.ac_off", JSON.stringify(resume));

    // the old duration list still works when no durations are given
    await setTimer("idle");
    const legacy = await calls(() => click(2));
    check(`${tag} the old select still steps its list`, legacy.length === 1 && /^input_select\.select_next/.test(legacy[0]), JSON.stringify(legacy));

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
