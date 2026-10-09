// An entity's own icon flips with its state, a lamp that only switches fills its row when it is on,
// the climate card's fan button opens a list of speeds, and the media card gives several speakers a
// picker and puts the sound output's volume under what you watch.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });

  // ---- icons: the chosen icon stays, only its on / off half follows the state
  const icons = await page.evaluate(() => {
    const f = window.__savvy.iconForState, st = (entity_id, state) => ({ entity_id, state, attributes: {} });
    return {
      switchOff: f("mdi:light-switch", st("switch.a", "off")), switchOn: f("mdi:light-switch-off", st("switch.a", "on")),
      toggleOff: f("mdi:toggle-switch", st("input_boolean.a", "off")), bulbOn: f("mdi:lightbulb-off", st("light.a", "on")),
      keep: f("mdi:sofa", st("light.a", "off")), unknown: f("mdi:lightbulb", st("light.a", "unavailable")),
      locked: f("mdi:lock-open", st("lock.a", "locked")), unlocked: f("mdi:lock", st("lock.a", "unlocked")),
      door: f("mdi:door-closed", st("binary_sensor.a", "on")), sensor: f("mdi:fan", st("sensor.a", "12")),
    };
  });
  check("icon: a light switch icon reads off when the switch is off", icons.switchOff === "mdi:light-switch-off", icons.switchOff);
  check("icon: and on when it is on", icons.switchOn === "mdi:light-switch", icons.switchOn);
  check("icon: a toggle icon flips too", icons.toggleOff === "mdi:toggle-switch-off", icons.toggleOff);
  check("icon: an off bulb set on a lamp that is on lights up", icons.bulbOn === "mdi:lightbulb", icons.bulbOn);
  check("icon: an icon with no pair stays as chosen", icons.keep === "mdi:sofa", icons.keep);
  check("icon: unavailable keeps the chosen icon", icons.unknown === "mdi:lightbulb", icons.unknown);
  check("icon: a lock follows locked / unlocked", icons.locked === "mdi:lock" && icons.unlocked === "mdi:lock-open", JSON.stringify(icons));
  check("icon: a door sensor opens", icons.door === "mdi:door-open", icons.door);
  check("icon: a sensor (neither on nor off) keeps its icon", icons.sensor === "mdi:fan", icons.sensor);

  // ---- lights: a lamp that only switches fills its row while it is on
  await page.evaluate(() => {
    window.setStates({ "light.porch": { state: "on", attributes: { ...window.hass.states["light.porch"].attributes, icon: "mdi:light-switch" } } });
    window.mount("savvy-lights-card", { lights: ["light.porch", "light.office_desk"] }, 460);
  });
  await page.waitForTimeout(700);
  const fills = await page.evaluate(() => ["light.porch", "light.office_desk"].map((id) => [...window.cards.at(-1).shadowRoot.querySelectorAll(".light")].find((n) => n.__entity === id)).map((n) => ({
    v: n.style.getPropertyValue("--v"), w: n.querySelector(".lvl").getBoundingClientRect().right - n.getBoundingClientRect().left, total: n.getBoundingClientRect().width,
    icon: n.querySelector("savvy-state-icon ha-icon")?.getAttribute("icon") })));
  check("lights: an on/off lamp that is on fills its row", fills[0].v === "1" && fills[0].w >= fills[0].total - 1, JSON.stringify(fills[0]));
  check("lights: an on/off lamp that is off is empty", fills[1].v === "0", JSON.stringify(fills[1]));
  await page.evaluate(() => window.setStates({ "light.porch": { state: "off", attributes: window.hass.states["light.porch"].attributes } }));
  await page.waitForTimeout(500);
  const offIcon = await page.evaluate(() => [...window.cards.at(-1).shadowRoot.querySelectorAll(".light")].find((n) => n.__entity === "light.porch").querySelector("savvy-state-icon ha-icon").getAttribute("icon"));
  check("lights: the lamp's own light-switch icon reads off once it is off", offIcon === "mdi:light-switch-off", offIcon);

  // ---- climate: the fan button opens the speeds, a pick sets one
  await page.evaluate(() => { window.mount("savvy-climate-card", { entity: "climate.living_room_ac", fan_control: true }, 460); });
  await page.waitForTimeout(800);
  const fanBox = await page.evaluate(() => { const r = window.cards.at(-1).shadowRoot; const e = [...r.querySelector("#actions").children].find((x) => /Fan/.test(x.textContent)); e.scrollIntoView(); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  await page.evaluate(() => { window.log.length = 0; });
  await page.mouse.click(fanBox.x, fanBox.y);
  await page.waitForTimeout(700);
  const menu = await page.evaluate(() => [...document.querySelectorAll("*")].map((n) => n.shadowRoot).filter(Boolean).flatMap((r) => [...r.querySelectorAll(".sv-opt")])
    .filter((o) => o.getBoundingClientRect().width > 0).map((o) => ({ t: o.textContent.trim(), sel: o.hasAttribute("data-sel"), r: o.getBoundingClientRect().toJSON() })));
  check("climate: a tap on the fan button opens the speeds, not the next one", menu.length === 4 && (await page.evaluate(() => window.log.length)) === 0, JSON.stringify(menu.map((m) => m.t)));
  check("climate: the current speed is marked", menu.find((m) => m.sel)?.t === "Auto", JSON.stringify(menu.map((m) => [m.t, m.sel])));
  const high = menu.find((m) => m.t === "High");
  if (high) await page.mouse.click(high.r.x + high.r.width / 2, high.r.y + high.r.height / 2);
  await page.waitForTimeout(500);
  const set = await page.evaluate(() => [...window.log]);
  check("climate: picking a speed sets it", set.some((c) => c.includes("set_fan_mode") && c.includes("high")), set.join(" | "));

  // ---- media: several speakers get a picker
  await page.evaluate(() => {
    window.mount("savvy-media-card", { name: "Living", artwork: false,
      video: [{ entity: "media_player.living_room_tv" }], audio: [{ entity: "media_player.kitchen_speaker" }, { entity: "media_player.living_room_speaker" }] }, 460);
  });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const r = window.cards.at(-1).shadowRoot, vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
    return {
      picker: vis(r.getElementById("speakers")), segs: [...r.querySelectorAll("#speakers .seg")].filter(vis).length,
      rows: [...r.querySelectorAll("#audioBand .player")].filter(vis).length,
      caps: [r.getElementById("videoCap"), r.getElementById("audioCap")].map((c) => (vis(c) ? c.textContent : "")),
    };
  });
  check("media: two speakers get a picker", m.picker && m.segs === 2, JSON.stringify(m));
  check("media: the picker shows one speaker at a time", m.rows === 1, JSON.stringify(m));
  check("media: the bands say Watch and Listen", m.caps[0] === "Watch" && m.caps[1] === "Listen", JSON.stringify(m.caps));
  const seg = await page.evaluate(() => { const s = [...window.cards.at(-1).shadowRoot.querySelectorAll("#speakers .seg")].find((x) => !x.hasAttribute("data-sel")); const q = s.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, t: s.textContent.trim() }; });
  await page.mouse.click(seg.x, seg.y);
  await page.waitForTimeout(600);
  const picked = await page.evaluate(() => window.cards.at(-1).shadowRoot.querySelector("#speakers .seg[data-sel]")?.textContent.trim());
  check("media: a tap on another speaker picks it", picked === seg.t, `${picked} vs ${seg.t}`);

  // ---- media: an LG TV lists where its sound can go; on its own speaker the volume is the TV's
  await page.evaluate(() => {
    window.setStates({ "media_player.living_room_tv": { state: "playing", attributes: { ...window.hass.states["media_player.living_room_tv"].attributes, sound_output: "external_arc" } } });
    window.mount("savvy-media-card", { name: "LG", artwork: false, video: [{ entity: "media_player.living_room_tv" }], audio: [{ entity: "media_player.living_room_speaker" }],
      video_output: "media_player.living_room_speaker" }, 460);
  });
  await page.waitForTimeout(700);
  const lg = () => page.evaluate(() => { const r = window.cards.at(-1).shadowRoot, b = r.querySelector("#nowVol .via"); const q = b.getBoundingClientRect();
    return { tag: b.tagName, t: b.textContent.trim(), x: q.x + q.width / 2, y: q.y + q.height / 2, vol: r.querySelector("#nowVol .vol .pct")?.textContent }; });
  const v1 = await lg();
  check("media/LG: the sound line is a button, naming the box the sound goes to", v1.tag === "BUTTON" && /Speaker/.test(v1.t), JSON.stringify(v1));
  await page.evaluate(() => { window.log.length = 0; });
  await page.mouse.click(v1.x, v1.y);
  await page.waitForTimeout(700);
  const opts = await page.evaluate(() => [...document.querySelectorAll("*")].map((n) => n.shadowRoot).filter(Boolean).flatMap((r) => [...r.querySelectorAll(".sv-opt")])
    .filter((o) => o.getBoundingClientRect().width > 0).map((o) => ({ t: o.textContent.trim(), sel: o.hasAttribute("data-sel"), r: o.getBoundingClientRect().toJSON() })));
  check("media/LG: a tap lists the outputs, the current one marked", opts.length >= 4 && opts.find((o) => o.sel)?.t === "HDMI ARC", JSON.stringify(opts.map((o) => [o.t, o.sel])));
  const tvsp = opts.find((o) => o.t === "TV speaker");
  if (tvsp) await page.mouse.click(tvsp.r.x + tvsp.r.width / 2, tvsp.r.y + tvsp.r.height / 2);
  await page.waitForTimeout(500);
  const lgCalls = await page.evaluate(() => [...window.log]);
  check("media/LG: a pick calls webostv.select_sound_output", lgCalls.some((c) => c.includes("webostv.select_sound_output") && c.includes("tv_speaker")), lgCalls.join(" | "));
  await page.evaluate(() => window.setStates({ "media_player.living_room_tv": { state: "playing", attributes: { ...window.hass.states["media_player.living_room_tv"].attributes, sound_output: "tv_speaker" } } }));
  await page.waitForTimeout(800);
  const v2 = await lg();
  check("media/LG: on its own speaker, the line says so and the volume is the TV's (30%)", /TV speaker/.test(v2.t) && v2.vol === "30%", JSON.stringify(v2));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
