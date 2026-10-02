// What a popup row controls, by kind: a media player's transport and volume, a climate unit's
// target and modes, a light's brightness, a cover's buttons, an alarm panel's arm modes, a fan's
// speed. Exact service payloads, and what each hides when the entity can't do it.
import { openPage } from "./_util.mjs";

const SETUP = () => {
  const add = (id, state, attributes, area, minutesAgo = 30) => {
    window.house.states[id] = { entity_id: id, state, attributes, last_changed: new Date(Date.now() - minutesAgo * 60000).toISOString(), last_updated: new Date().toISOString() };
    window.house.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  // media: a TV that does everything, an idle speaker, one that's off, one that only plays and pauses
  add("media_player.pr_tv", "playing", { friendly_name: "PR TV", supported_features: 21437, volume_level: 0.3, is_volume_muted: false, media_title: "A Show", media_artist: "Someone" }, "living_room");
  add("media_player.pr_speaker", "idle", { friendly_name: "PR Speaker", supported_features: 21437, volume_level: 0.4 }, "kitchen");
  add("media_player.pr_off", "off", { friendly_name: "PR Off", supported_features: 21437 }, "bedroom");
  add("media_player.pr_basic", "playing", { friendly_name: "PR Basic", supported_features: 16385 }, "office");
  // climate
  add("climate.pr_ac", "cool", { friendly_name: "PR AC", hvac_modes: ["off", "cool", "heat", "fan_only", "dry", "auto"], min_temp: 16, max_temp: 30, target_temp_step: 0.5, temperature: 22, current_temperature: 23.4, hvac_action: "cooling", fan_mode: "low" }, "living_room");
  add("climate.pr_heater", "off", { friendly_name: "PR Heater", hvac_modes: ["off", "heat"], min_temp: 10, max_temp: 28, temperature: 20, current_temperature: 19.2 }, "bedroom");
  add("climate.pr_range", "heat_cool", { friendly_name: "PR Range", hvac_modes: ["off", "heat_cool"], target_temp_low: 19, target_temp_high: 24, current_temperature: 21 }, "office");
  // lights
  add("light.pr_dim", "on", { friendly_name: "PR Dim", brightness: 128, supported_color_modes: ["brightness"] }, "living_room");
  add("light.pr_off", "off", { friendly_name: "PR Off Light", supported_color_modes: ["brightness"] }, "kitchen");
  add("light.pr_plain", "on", { friendly_name: "PR Plain", supported_color_modes: ["onoff"] }, "bedroom");
  // covers
  add("cover.pr_blind", "open", { friendly_name: "PR Blind", supported_features: 15, current_position: 70 }, "living_room");
  add("cover.pr_garage", "closed", { friendly_name: "PR Garage", supported_features: 3 }, "kitchen");
  // alarm
  add("alarm_control_panel.pr_alarm", "armed_home", { friendly_name: "PR Alarm", supported_features: 7, code_format: null }, null);
  add("alarm_control_panel.pr_coded", "disarmed", { friendly_name: "PR Coded", supported_features: 3, code_format: "number", code_arm_required: true }, null);
  // fans, switches, a sensor
  add("fan.pr_fan", "on", { friendly_name: "PR Fan", supported_features: 1, percentage: 40 }, "bedroom");
  add("fan.pr_fan_off", "off", { friendly_name: "PR Fan Off", supported_features: 1, percentage: 0 }, "bedroom");
  add("switch.pr_plug", "on", { friendly_name: "PR Plug" }, "office");
  add("sensor.pr_temp", "21.5", { friendly_name: "PR Temp", unit_of_measurement: "°C", device_class: "temperature" }, "office");
  window.hass = { ...window.hass, states: { ...window.house.states } };
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).innerHTML = "<button id=o>open</button>";
  document.body.appendChild(host);
  window.list = new window.__savvy.EntityListSheet(host, { title: "Popup" });
  window.list.show(window.hass, Object.keys(window.house.states).filter((id) => id.includes(".pr_")), host.shadowRoot.getElementById("o"));
  window.info = [];
  document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
  window.push = (id, state, extra) => {
    window.setStates({ [id]: { entity_id: id, state, attributes: { ...window.house.states[id].attributes, ...(extra || {}) } } });
    window.list.render(window.hass);
  };
};

const row = (id) => `.sv-row[data-id="${id}"]`;
const q = (page, id, sel, fn) => page.evaluate(([id, sel, fn]) => {
  const root = window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"]`);
  const els = [...root.querySelectorAll(sel)];
  return new Function("els", "root", `return (${fn})(els, root)`)(els, root);
}, [id, sel, fn.toString()]);
const clear = (page) => page.evaluate(() => { window.log.length = 0; window.info.length = 0; });
const log = (page) => page.evaluate(() => [...window.log]);
const center = (page, id, sel, i = 0) => page.evaluate(([id, sel, i]) => {
  const el = window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"]`).querySelectorAll(sel)[i];
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height];
}, [id, sel, i]);
const click = async (page, id, sel, i = 0) => { const [x, y] = await center(page, id, sel, i); await page.mouse.click(x, y); await page.waitForTimeout(120); };
const visible = (page, id, sel) => q(page, id, sel, (els) => els.filter((e) => !e.hidden && e.offsetParent !== null).length);
// a sideways drag of a bar from where its level is to `to`
async function dragBar(page, id, sel, to, { release = true } = {}) {
  const [x, y, w] = await center(page, id, sel);
  const from = Number(await q(page, id, sel, (els) => els[0].getAttribute("aria-valuenow"))) / 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (((to - from) * w + 10 * Math.sign(to - from)) * i) / 10, y);   // 10px: the bar follows from where the drag became clear
  if (release) await page.mouse.up();
  await page.waitForTimeout(300);
}

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width, height: 1400 });
    await page.evaluate(SETUP);
    await page.waitForTimeout(800);

    // ---- media
    const tvBtns = await q(page, "media_player.pr_tv", ".sv-btn", (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("aria-label")));
    check(`${tag} a playing TV: power, previous, pause, next, mute; a volume bar with - and +`,
      JSON.stringify(tvBtns) === JSON.stringify(["Power", "Previous", "Pause", "Next", "Mute", "Volume down", "Volume up"]), JSON.stringify(tvBtns));
    check(`${tag} the row says what is playing`, /A Show · Someone/.test(await q(page, "media_player.pr_tv", ".sv-sub", (e) => e[0].textContent)));
    await clear(page);
    await click(page, "media_player.pr_tv", ".sv-btn[aria-label=Power]");
    await click(page, "media_player.pr_tv", ".sv-btn[aria-label=Previous]");
    await click(page, "media_player.pr_tv", ".sv-btn[aria-label=Pause]");
    await click(page, "media_player.pr_tv", ".sv-btn[aria-label=Next]");
    await click(page, "media_player.pr_tv", ".sv-btn[aria-label=Mute]");
    check(`${tag} each transport button calls its own service`, JSON.stringify(await log(page)) === JSON.stringify([
      "media_player.turn_off {} media_player.pr_tv", "media_player.media_previous_track {} media_player.pr_tv", "media_player.media_play_pause {} media_player.pr_tv",
      "media_player.media_next_track {} media_player.pr_tv", 'media_player.volume_mute {"is_volume_muted":true} media_player.pr_tv']), JSON.stringify(await log(page)));
    await clear(page);
    await click(page, "media_player.pr_tv", ".sv-btn[aria-label='Volume up']");
    await page.waitForTimeout(250);
    await click(page, "media_player.pr_tv", ".sv-btn[aria-label='Volume down']");
    await page.waitForTimeout(250);
    check(`${tag} - and + step the volume by 5%`, JSON.stringify(await log(page)) === JSON.stringify(['media_player.volume_set {"volume_level":0.35} media_player.pr_tv', 'media_player.volume_set {"volume_level":0.3} media_player.pr_tv']), JSON.stringify(await log(page)));
    // the bar moves on a sideways drag only
    await clear(page);
    const [bx, by] = await center(page, "media_player.pr_tv", ".sv-bar");
    await page.mouse.click(bx + 40, by);
    await page.waitForTimeout(250);
    const tapped = await log(page);
    await dragBar(page, "media_player.pr_tv", ".sv-bar", 0.7);
    const vs = (await log(page)).filter((l) => l.startsWith("media_player.volume_set"));
    const last = Number(/"volume_level":([\d.]+)/.exec(vs[vs.length - 1] || "")?.[1]);
    check(`${tag} a tap on the volume bar does nothing; a sideways drag sets it`, tapped.length === 0 && vs.length >= 1 && Math.abs(last - 0.7) < 0.06, JSON.stringify([tapped, vs]));
    const spk = await q(page, "media_player.pr_speaker", ".sv-btn", (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("aria-label")));
    check(`${tag} an idle player shows power and play, nothing else`, JSON.stringify(spk) === JSON.stringify(["Power", "Play"]) && (await visible(page, "media_player.pr_speaker", ".sv-bar")) === 0, JSON.stringify(spk));
    await clear(page);
    await click(page, "media_player.pr_speaker", ".sv-btn[aria-label=Play]");
    check(`${tag} ...and play on an idle one plays`, JSON.stringify(await log(page)) === JSON.stringify(["media_player.media_play {} media_player.pr_speaker"]), JSON.stringify(await log(page)));
    const off = await q(page, "media_player.pr_off", ".sv-btn", (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("aria-label")));
    await clear(page);
    await click(page, "media_player.pr_off", ".sv-btn[aria-label=Power]");
    check(`${tag} a player that is off shows only power, which turns it on`, JSON.stringify(off) === JSON.stringify(["Power"]) && JSON.stringify(await log(page)) === JSON.stringify(["media_player.turn_on {} media_player.pr_off"]), JSON.stringify([off, await log(page)]));
    const basic = await q(page, "media_player.pr_basic", ".sv-btn", (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("aria-label")));
    check(`${tag} what a player can't do is not shown (no power, track, mute or volume)`, JSON.stringify(basic) === JSON.stringify(["Pause"]) && (await visible(page, "media_player.pr_basic", ".sv-bar")) === 0, JSON.stringify(basic));

    // touch: a vertical swipe on the volume bar is left to the page; a sideways one sets the volume
    await clear(page);
    const touch = (type, x, y) => page.evaluate(({ type, x, y }) => {
      const bar = window.__savvy.portalRoot().querySelector('.sv-row[data-id="media_player.pr_tv"] .sv-bar');
      bar.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1, bubbles: true, composed: true }));
    }, { type, x, y });
    const [tx, ty, tw] = await center(page, "media_player.pr_tv", ".sv-bar");
    await touch("pointerdown", tx, ty);
    await touch("pointermove", tx + 2, ty + 40);
    await touch("pointermove", tx + 4, ty + 90);
    await touch("pointerup", tx + 4, ty + 90);
    await page.waitForTimeout(250);
    const vertical = await log(page);
    await touch("pointerdown", tx, ty);
    for (let i = 1; i <= 8; i++) await touch("pointermove", tx + (tw * 0.3 * i) / 8, ty);
    await touch("pointerup", tx + tw * 0.3, ty);
    await page.waitForTimeout(300);
    const sideways = (await log(page)).filter((l) => l.startsWith("media_player.volume_set"));
    check(`${tag} touch: a vertical swipe on the bar changes nothing, a sideways one sets the volume`, vertical.length === 0 && sideways.length >= 1, JSON.stringify([vertical, sideways]));

    // ---- climate
    const segs = await q(page, "climate.pr_ac", ".sv-seg-b", (els) => els.map((e) => `${e.textContent}${e.hasAttribute("data-on") ? "*" : ""}`));
    check(`${tag} a unit shows Off, Cool, Heat and what else it has, the current mode marked`, JSON.stringify(segs) === JSON.stringify(["Off", "Cool*", "Heat", "Auto"]), JSON.stringify(segs));
    check(`${tag} the target and the reading`, (await q(page, "climate.pr_ac", ".sv-step-v", (e) => e[0].textContent)) === "22.0°" && /23\.4° now · Cooling/.test(await q(page, "climate.pr_ac", ".sv-sub", (e) => e[0].textContent)));
    await clear(page);
    await click(page, "climate.pr_ac", ".sv-step .sv-btn", 1);
    await click(page, "climate.pr_ac", ".sv-step .sv-btn", 1);
    await click(page, "climate.pr_ac", ".sv-step .sv-btn", 1);
    const shown = await q(page, "climate.pr_ac", ".sv-step-v", (e) => e[0].textContent);
    await page.waitForTimeout(650);
    check(`${tag} + three times is one write of 23.5 once the stepping stops`, shown === "23.5°" && JSON.stringify(await log(page)) === JSON.stringify(['climate.set_temperature {"temperature":23.5} climate.pr_ac']), JSON.stringify([shown, await log(page)]));
    await page.evaluate(() => window.push("climate.pr_ac", "cool", { temperature: 23.5 }));
    await clear(page);
    await click(page, "climate.pr_ac", ".sv-step .sv-btn", 0);
    await page.waitForTimeout(650);
    check(`${tag} - steps it down`, JSON.stringify(await log(page)) === JSON.stringify(['climate.set_temperature {"temperature":23} climate.pr_ac']), JSON.stringify(await log(page)));
    await page.waitForTimeout(2300);
    await page.evaluate(() => window.push("climate.pr_ac", "cool", { temperature: 16 }));
    await page.waitForTimeout(150);
    check(`${tag} the stepper stops at the unit's minimum`, await q(page, "climate.pr_ac", ".sv-step .sv-btn", (els) => els[0].hasAttribute("disabled") && !els[1].hasAttribute("disabled")));
    await clear(page);
    await click(page, "climate.pr_ac", ".sv-seg-b", 2);
    await click(page, "climate.pr_ac", ".sv-seg-b", 1);
    check(`${tag} a mode button sets the mode; the current one does nothing`, JSON.stringify(await log(page)) === JSON.stringify(['climate.set_hvac_mode {"hvac_mode":"heat"} climate.pr_ac']), JSON.stringify(await log(page)));
    const heaterSegs = await q(page, "climate.pr_heater", ".sv-seg-b", (els) => els.map((e) => e.textContent));
    check(`${tag} a unit with two modes shows two`, JSON.stringify(heaterSegs) === JSON.stringify(["Off", "Heat"]) && (await q(page, "climate.pr_heater", ".sv-line", (e) => e[0].hasAttribute("data-dim"))), JSON.stringify(heaterSegs));
    check(`${tag} a unit with a range (no single target) has no stepper`, (await visible(page, "climate.pr_range", ".sv-step")) === 0);

    // ---- lights
    check(`${tag} a dimmable light that's on has a brightness bar, others don't`,
      (await visible(page, "light.pr_dim", ".sv-bar")) === 1 && (await visible(page, "light.pr_off", ".sv-bar")) === 0 && (await visible(page, "light.pr_plain", ".sv-bar")) === 0
      && (await q(page, "light.pr_dim", ".sv-pct", (e) => e[0].textContent)) === "50%");
    await clear(page);
    await dragBar(page, "light.pr_dim", ".sv-bar", 0.8);
    const lv = (await log(page)).filter((l) => l.startsWith("light.turn_on"));
    const pct = Number(/"brightness_pct":(\d+)/.exec(lv[lv.length - 1] || "")?.[1]);
    check(`${tag} dragging the bar dims it with light.turn_on`, lv.length >= 1 && Math.abs(pct - 80) <= 6, JSON.stringify(lv));
    await clear(page);
    await click(page, "light.pr_plain", ".sv-tog", 0);
    check(`${tag} the switch still toggles`, JSON.stringify(await log(page)) === JSON.stringify(["light.toggle {} light.pr_plain"]), JSON.stringify(await log(page)));

    // ---- covers
    const blind = await q(page, "cover.pr_blind", ".sv-btn", (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("aria-label")));
    const garage = await q(page, "cover.pr_garage", ".sv-btn", (els) => els.filter((e) => e.offsetParent !== null).map((e) => `${e.getAttribute("aria-label")}${e.hasAttribute("disabled") ? "!" : ""}`));
    check(`${tag} a blind has open, stop, close and a position bar; a garage door only open and close (closed: close is off)`,
      JSON.stringify(blind) === JSON.stringify(["Open", "Stop", "Close"]) && (await visible(page, "cover.pr_blind", ".sv-bar")) === 1 && JSON.stringify(garage) === JSON.stringify(["Open", "Close!"])
      && (await visible(page, "cover.pr_garage", ".sv-bar")) === 0, JSON.stringify([blind, garage]));
    await clear(page);
    await click(page, "cover.pr_blind", ".sv-btn[aria-label=Open]");
    await click(page, "cover.pr_blind", ".sv-btn[aria-label=Stop]");
    await click(page, "cover.pr_blind", ".sv-btn[aria-label=Close]");
    check(`${tag} the cover buttons call open, stop and close`, JSON.stringify(await log(page)) === JSON.stringify(["cover.open_cover {} cover.pr_blind", "cover.stop_cover {} cover.pr_blind", "cover.close_cover {} cover.pr_blind"]), JSON.stringify(await log(page)));
    await clear(page);
    await dragBar(page, "cover.pr_blind", ".sv-bar", 0.3);
    const cv = (await log(page)).filter((l) => l.startsWith("cover.set_cover_position"));
    const cpos = Number(/"position":(\d+)/.exec(cv[cv.length - 1] || "")?.[1]);
    check(`${tag} the position bar sets the position`, cv.length >= 1 && Math.abs(cpos - 30) <= 6, JSON.stringify(cv));
    check(`${tag} the cover says its state and position`, /Open · 70%/.test(await q(page, "cover.pr_blind", ".sv-sub", (e) => e[0].textContent)));

    // ---- alarm
    const arm = await q(page, "alarm_control_panel.pr_alarm", ".sv-seg-b", (els) => els.map((e) => `${e.textContent}${e.hasAttribute("data-on") ? "*" : ""}`));
    check(`${tag} an alarm panel shows its arm modes, the current one marked, and a disarm button`, JSON.stringify(arm) === JSON.stringify(["Home*", "Away", "Night"]) && (await visible(page, "alarm_control_panel.pr_alarm", ".sv-pillbtn")) === 1, JSON.stringify(arm));
    await clear(page);
    await click(page, "alarm_control_panel.pr_alarm", ".sv-seg-b", 1);
    await click(page, "alarm_control_panel.pr_alarm", ".sv-seg-b", 0);
    check(`${tag} arming without a code calls the service; the mode it's in does nothing`, JSON.stringify(await log(page)) === JSON.stringify(["alarm_control_panel.alarm_arm_away {} alarm_control_panel.pr_alarm"]), JSON.stringify(await log(page)));
    await clear(page);
    await click(page, "alarm_control_panel.pr_alarm", ".sv-pillbtn");
    check(`${tag} disarm opens more-info (that's where the code goes)`, (await page.evaluate(() => window.info))[0] === "alarm_control_panel.pr_alarm" && (await log(page)).length === 0, JSON.stringify(await page.evaluate(() => window.info)));
    await clear(page);
    await click(page, "alarm_control_panel.pr_coded", ".sv-seg-b", 1);
    check(`${tag} a panel that wants a code to arm opens more-info instead`, (await page.evaluate(() => window.info))[0] === "alarm_control_panel.pr_coded" && (await log(page)).length === 0
      && (await q(page, "alarm_control_panel.pr_coded", ".sv-pillbtn", (e) => e[0].hidden)));
    check(`${tag} a panel with only two arm modes shows two`, (await q(page, "alarm_control_panel.pr_coded", ".sv-seg-b", (e) => e.length)) === 2);

    // ---- fans, switches, sensors
    check(`${tag} a fan that's on has a speed bar; one that's off doesn't`, (await visible(page, "fan.pr_fan", ".sv-bar")) === 1 && (await visible(page, "fan.pr_fan_off", ".sv-bar")) === 0 && (await q(page, "fan.pr_fan", ".sv-pct", (e) => e[0].textContent)) === "40%");
    await clear(page);
    await dragBar(page, "fan.pr_fan", ".sv-bar", 0.9);
    const fv = (await log(page)).filter((l) => l.startsWith("fan.set_percentage"));
    check(`${tag} the speed bar sets the percentage`, fv.length >= 1 && Math.abs(Number(/"percentage":(\d+)/.exec(fv[fv.length - 1])?.[1]) - 90) <= 6, JSON.stringify(fv));
    await clear(page);
    await click(page, "switch.pr_plug", ".sv-tog");
    check(`${tag} a switch toggles`, JSON.stringify(await log(page)) === JSON.stringify(["switch.toggle {} switch.pr_plug"]));
    check(`${tag} a sensor is its state, with nothing to control`, (await q(page, "sensor.pr_temp", ".sv-val", (e) => e[0].textContent)).length > 0 && (await q(page, "sensor.pr_temp", ".sv-ctl", (e) => e[0].hidden)));

    // ---- compact when idle: rows with nothing to control carry no control line
    const heights = await page.evaluate(() => ["light.pr_off", "switch.pr_plug", "sensor.pr_temp", "light.pr_dim", "media_player.pr_tv"].map((id) => Math.round(window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"]`).getBoundingClientRect().height)));
    check(`${tag} idle rows stay one line; controls make a row taller`, heights.slice(0, 3).every((h) => h <= 62) && heights[3] > 60 && heights[4] > 100, JSON.stringify(heights));

    // tapping a name still opens more-info
    await clear(page);
    await click(page, "media_player.pr_tv", ".sv-main .sv-name");
    check(`${tag} the name area opens more-info`, (await page.evaluate(() => window.info))[0] === "media_player.pr_tv");

    await page.evaluate(() => { window.push("climate.pr_ac", "off", { hvac_action: "off" }); window.push("climate.pr_range", "off", { hvac_action: "off" }); });
    await page.waitForTimeout(5200);
    check(`${tag} the clock goes to sleep`, await page.evaluate(() => window.__savvy.Clock.jobs.size === 0),
      await page.evaluate(() => JSON.stringify({ jobs: window.__savvy.Clock.jobs.size, busy: [...window.list.rows.__rows.entries()].filter(([, r]) => r.__kit.springs.some((s) => !s.idle)).map(([id]) => id),
        spin: [...window.list.rows.__rows.entries()].filter(([, r]) => r.__spin && !r.__spin.idle).map(([id]) => id), sheet: !window.list.sheet.spring.idle, own: window.list.kit.springs.some((s) => !s.idle) })));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
