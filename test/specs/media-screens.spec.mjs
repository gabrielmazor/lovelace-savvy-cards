// The media card's screens and sound. The TV leads the picker, its inputs after it; an input that is on while
// its TV is on holds the selector. Every sound is at the bottom, one row at a time: the TV's own speakers (its
// volume) while it plays through them, the soundbar always, with its transport, power and source. The row
// carrying a screen's sound says so; on an LG the line switches the TV's output. Never two bars for one box.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  const TV = "media_player.living_room_tv", BAR = "media_player.living_room_speaker", SPK = "media_player.kitchen_speaker";
  await page.evaluate(({ TV, BAR, SPK }) => {
    const a = (id) => window.hass.states[id].attributes;
    window.setStates({
      [TV]: { state: "on", attributes: { ...a(TV), volume_level: 0.12, sound_output: "external_arc" } },
      [BAR]: { state: "on", attributes: { ...a(BAR), volume_level: 0.34, device_class: "receiver", source: "TV", source_list: ["TV", "Bluetooth", "Wi-Fi"] } },
      [SPK]: { state: "idle", attributes: { ...a(SPK), volume_level: 0.25 } },
      "media_player.streamer": { state: "playing", attributes: { friendly_name: "Streamer", supported_features: 21437, volume_level: 0.9, media_title: "A Show" } },
    });
  }, { TV, BAR, SPK });
  const mount = (cfg) => page.evaluate((cfg) => window.mount("savvy-media-card", { name: "Living", artwork: false, ...cfg }, 460), cfg);
  const read = () => page.evaluate(() => {
    const r = window.cards.at(-1).shadowRoot, vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
    const row = [...r.querySelectorAll("#audioBand .player")].find(vis);
    return {
      bars: [...r.querySelectorAll(".vol")].filter(vis).map((v) => v.querySelector(".pct")?.textContent),
      watchBar: vis(r.querySelector("#nowVol .vol")),
      segs: [...r.querySelectorAll("#sources .seg")].filter(vis).map((x) => x.textContent.trim() + (x.hasAttribute("data-sel") ? "*" : "")),
      sound: [...r.querySelectorAll("#speakers .seg")].filter(vis).map((x) => x.textContent.trim() + (x.hasAttribute("data-sel") ? "*" : "")),
      row: row ? row.querySelector(".n").textContent : "", pct: row?.querySelector(".pct")?.textContent,
      lines: row ? [...row.querySelectorAll(".via")].filter(vis).map((v) => v.textContent.trim()) : [],
      keys: row ? [...row.querySelectorAll(".transport [data-k]")].filter(vis).map((b) => b.dataset.k) : [],
      pill: r.querySelector("#sources .sel").style.transform,
    };
  });
  const tap = async (box, name) => {
    const at = await page.evaluate(({ box, name }) => { const s = [...window.cards.at(-1).shadowRoot.querySelectorAll(`${box} .seg`)].find((x) => x.textContent.trim() === name); s.scrollIntoView({ block: "center" }); const q = s.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, { box, name });
    await page.mouse.click(...at);
    await page.waitForTimeout(800);
    return read();
  };
  const both = { video: [{ entity: "media_player.streamer", name: "Streamer" }, { entity: TV, name: "TV" }], audio: [{ entity: BAR, name: "Soundbar" }, { entity: SPK, name: "Speaker" }] };

  // eARC to the configured soundbar: the soundbar's row carries the TV's sound, with all its controls
  await mount({ ...both, video_output: BAR });
  await page.waitForTimeout(800);
  const arc = await read();
  check("the TV leads the picker, its input after it; the playing input holds the selector", arc.segs.join() === "TV,Streamer*", JSON.stringify(arc));
  check("no volume under what you watch: sound is at the bottom", !arc.watchBar, JSON.stringify(arc));
  check("eARC: the soundbar's row is up, says it carries the TV's sound, one bar (34%)", arc.row === "Soundbar" && arc.pct === "34%" && /Sound output for TV/.test(arc.lines[0] || "") && arc.bars.length === 1, JSON.stringify(arc));
  check("...with its full transport and power, and its source", arc.keys.join() === "prev,play,next,power" && arc.lines.some((l) => /Source · TV/.test(l)), JSON.stringify(arc));
  check("...and the soundbar stays in the picker (no TV speakers entry while the sound is out)", arc.sound.join() === "Soundbar*,Speaker", JSON.stringify(arc));
  check("the streamer's own level (90%) is never shown", !arc.bars.includes("90%"), JSON.stringify(arc.bars));

  // the selector moves with the pick (the card's frame loop runs)
  const tv = await tap("#sources", "TV");
  check("picking the TV moves the selector to it", tv.segs[0] === "TV*" && /translate3d\(3px/.test(tv.pill), JSON.stringify(tv));
  await tap("#sources", "Streamer");

  // the soundbar's source: a list to pick from
  await page.evaluate(() => { window.log.length = 0; });
  const src = await page.evaluate(() => { const b = [...window.cards.at(-1).shadowRoot.querySelectorAll(".via")].find((x) => /Source/.test(x.textContent) && x.getClientRects().length); const q = b.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  await page.mouse.click(...src);
  await page.waitForTimeout(500);
  const opt = await page.evaluate(() => { const all = [...document.querySelectorAll("*")].flatMap((e) => (e.shadowRoot ? [...e.shadowRoot.querySelectorAll("button")] : [])); const o = all.find((x) => x.textContent.trim() === "Bluetooth" && x.getClientRects().length); if (!o) return null; const q = o.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  if (opt) { await page.mouse.click(...opt); await page.waitForTimeout(500); }
  const picked = await page.evaluate(() => [...window.log]);
  check("the soundbar's source list switches its source", picked.some((l) => l.startsWith("media_player.select_source") && l.includes("Bluetooth") && l.includes("living_room_speaker")), JSON.stringify({ picked, opt }));

  // the TV switched to its own speakers: a TV entry with the TV's bar; the soundbar is still there
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, sound_output: "tv_speaker" } } }), TV);
  await page.waitForTimeout(800);
  const own = await read();
  check("TV speakers: the TV's sound row is up, its bar (12%), its output named", own.row === "TV" && own.pct === "12%" && /TV speaker/.test(own.lines[0] || ""), JSON.stringify(own));
  check("...the soundbar and speaker stay in the picker, after the TV", own.sound.join() === "TV*,Soundbar,Speaker", JSON.stringify(own));
  check("...the TV's row has no transport (that is up in Watch)", own.keys.length === 0, JSON.stringify(own));

  // the TV off: no TV entry, the soundbar plays on its own
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "off", attributes: { ...window.hass.states[TV].attributes, sound_output: "external_arc" } } }), TV);
  await page.waitForTimeout(800);
  const off = await read();
  check("TV off: the soundbar and speaker, no TV entry", off.sound.join().replace("*", "") === "Soundbar,Speaker", JSON.stringify(off));

  // nothing configured: never guessed, the TV plays through itself
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, sound_output: "external_arc" } } }), TV);
  await mount(both);
  await page.waitForTimeout(800);
  const none = await read();
  check("no output in the config: the TV's own speakers carry it (12%), the soundbar is a speaker", none.row === "TV" && none.pct === "12%" && none.sound.includes("Soundbar"), JSON.stringify(none));

  // a TV that doesn't say where its sound goes (not an LG): the configured soundbar carries it while it is on
  await page.evaluate((TV) => { const a = { ...window.hass.states[TV].attributes }; delete a.sound_output; window.setStates({ [TV]: { state: "on", attributes: a } }); }, TV);
  await mount({ ...both, video_output: BAR });
  await page.waitForTimeout(800);
  const plain = await read();
  check("another brand, soundbar configured and on: the soundbar carries it, a plain line", plain.row === "Soundbar" && plain.pct === "34%" && /Sound output for TV$/.test(plain.lines[0] || ""), JSON.stringify(plain));
  await page.evaluate((BAR) => window.setStates({ [BAR]: { state: "off", attributes: window.hass.states[BAR].attributes } }), BAR);
  await page.waitForTimeout(800);
  const barOff = await read();
  check("...and with the soundbar off, the TV's own speakers (12%)", barOff.row === "TV" && barOff.pct === "12%", JSON.stringify(barOff));

  // a TV alone: its own bar, once
  await mount({ video: [{ entity: TV }] });
  await page.waitForTimeout(800);
  const alone = await read();
  check("a TV alone: its own bar, once", alone.pct === "12%" && alone.bars.length === 1, JSON.stringify(alone));

  // the soundbar playing its own music while the TV is on: not the TV's sound
  await page.evaluate(({ TV, BAR }) => window.setStates({
    [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, volume_level: 0.12, sound_output: "external_arc" } },
    [BAR]: { state: "playing", attributes: { ...window.hass.states[BAR].attributes, source: "Spotify", media_title: "So What" } },
  }), { TV, BAR });
  await mount({ ...both, video_output: BAR });
  await page.waitForTimeout(800);
  const spot = await read();
  check("soundbar on Spotify while the TV is on: it doesn't say it carries the TV", spot.row !== "Soundbar" || !spot.lines.some((l) => /Sound output/.test(l)), JSON.stringify(spot));
  await page.evaluate((BAR) => window.setStates({ [BAR]: { state: "on", attributes: { ...window.hass.states[BAR].attributes, source: "TV", media_title: null } } }), BAR);
  await page.waitForTimeout(800);
  const back = await read();
  check("back on the TV input: the soundbar carries the TV again", back.row === "Soundbar" && /Sound output for TV/.test(back.lines[0] || ""), JSON.stringify(back));
  await page.evaluate((BAR) => window.setStates({ [BAR]: { state: "on", attributes: { ...window.hass.states[BAR].attributes, source: "Input 2" } } }), BAR);
  await mount({ ...both, video_output: BAR, output_source: "Input 2" });
  await page.waitForTimeout(800);
  const named = await read();
  check("output_source names the soundbar's TV input when it has another name", named.row === "Soundbar" && named.pct === "34%", JSON.stringify(named));

  // two screens: each TV is its own screen; a source with no screen of its own plays on the first TV
  await page.evaluate((BAR) => window.setStates({ "media_player.bedroom_tv": { state: "on", attributes: { friendly_name: "Bedroom TV", device_class: "tv", supported_features: 21437, volume_level: 0.55 } },
    [BAR]: { state: "on", attributes: { ...window.hass.states[BAR].attributes, source: "TV" } } }), BAR);
  await mount({ video: [{ entity: TV }, { entity: "media_player.bedroom_tv" }, { entity: "media_player.streamer" }], video_output: BAR, audio: [{ entity: BAR, name: "Soundbar" }] });
  await page.waitForTimeout(800);
  const pickSeg = async (name) => {
    const box = await page.evaluate((name) => { const s = [...window.cards.at(-1).shadowRoot.querySelectorAll("#sources .seg")].find((x) => x.textContent.includes(name)); s.scrollIntoView(); const q = s.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, name);
    await page.mouse.click(...box);
    await page.waitForTimeout(700);
    return read();
  };
  const two = await pickSeg("Bedroom");
  check("two screens: the second TV's own speakers carry it (55%), not the first TV's soundbar", two.row === "Bedroom TV" && two.pct === "55%", JSON.stringify(two));
  const str = await pickSeg("Streamer");
  check("two screens: an unmapped source plays on the first TV (its soundbar's 34%)", str.row === "Soundbar" && str.pct === "34%", JSON.stringify(str));

  // the frame: the screen (name, what it is on, its power) over the inputs; inputs follow and switch the TV's input
  await page.evaluate(({ TV, BAR }) => window.setStates({
    [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, source: "HDMI 2", source_list: ["HDMI 1", "HDMI 2"], sound_output: "external_arc" } },
    [BAR]: { state: "on", attributes: { ...window.hass.states[BAR].attributes, source: "TV" } },
    "media_player.console": { state: "idle", attributes: { friendly_name: "Console", device_class: "tv", supported_features: 21437 } },
  }), { TV, BAR });
  await mount({ screen: TV, screen_frame: true, video_output: BAR, video: [{ entity: TV }, { entity: "media_player.streamer", name: "Streamer", input: "HDMI 1" }, { entity: "media_player.console", name: "Console", input: "HDMI 2" }],
    audio: [{ entity: BAR, name: "Soundbar" }] });
  await page.waitForTimeout(900);
  const fr = await page.evaluate(() => {
    const r = window.cards.at(-1).shadowRoot, vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
    const y = (e) => e.getBoundingClientRect().top;
    return { framed: vis(r.getElementById("frame")), name: r.getElementById("frameName").textContent, sub: r.getElementById("frameSub").textContent,
      framePower: vis(r.querySelector("#frameTransport [data-k=power]")), frameKeys: [...r.querySelectorAll("#frameTransport [data-k]")].filter(vis).map((b) => b.dataset.k),
      sel: r.querySelector("#sources .seg[data-sel]")?.textContent.trim(), segs: [...r.querySelectorAll("#sources .seg")].filter(vis).map((x) => x.textContent.trim()),
      order: [y(r.getElementById("frame")), y(r.getElementById("sources")), y(r.getElementById("nowRow")), y(r.getElementById("audioBand"))],
      bars: [...r.querySelectorAll(".vol")].filter(vis).length };
  });
  check("frame: the TV, on its input, with only its power", fr.framed && fr.sub === "Console" && fr.framePower && fr.frameKeys.join() === "power", JSON.stringify(fr));
  const [yFrame, ySources, yNow, ySound] = fr.order;
  check("frame: the screen, its inputs, what plays, then the sound band, top to bottom", yFrame < ySources && ySources < yNow && yNow < ySound, JSON.stringify(fr.order));
  check("frame: the TV in the picker stands for its own apps", fr.segs[0] === "TV apps", JSON.stringify(fr.segs));
  check("the picker follows the TV's input (HDMI 2: the console)", fr.sel === "Console", fr.sel);
  check("one volume bar for the screen", fr.bars === 1, String(fr.bars));
  await page.evaluate(() => { window.log.length = 0; });
  const st = await page.evaluate(() => { const s = [...window.cards.at(-1).shadowRoot.querySelectorAll("#sources .seg")].find((x) => x.textContent.includes("Streamer")); s.scrollIntoView({ block: "center" }); const q = s.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  await page.mouse.click(...st);
  await page.waitForTimeout(500);
  const sw = await page.evaluate(() => [...window.log]);
  check("picking an input switches the TV to it", sw.some((c) => c.includes("select_source") && c.includes("HDMI 1") && c.includes("living_room_tv")), JSON.stringify({ sw, st }));
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, source: "HDMI 1" } } }), TV);
  await page.waitForTimeout(700);
  const sel2 = await page.evaluate(() => window.cards.at(-1).shadowRoot.querySelector("#sources .seg[data-sel]")?.textContent.trim());
  check("...and the picker stays on it once the TV reports it", sel2 === "Streamer", sel2);
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, source: "HDMI 2" } } }), TV);
  await page.waitForTimeout(700);
  const sel3 = await page.evaluate(() => window.cards.at(-1).shadowRoot.querySelector("#sources .seg[data-sel]")?.textContent.trim());
  check("switched with the remote: the picker follows", sel3 === "Console", sel3);

  // the default: no frame, the TV leads the picker by its own name
  await mount({ screen: TV, video_output: BAR, video: [{ entity: TV, name: "TV" }, { entity: "media_player.streamer", name: "Streamer", input: "HDMI 1" }],
    audio: [{ entity: BAR, name: "Soundbar" }] });
  await page.waitForTimeout(800);
  const flat = await page.evaluate(() => { const r = window.cards.at(-1).shadowRoot, vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
    return { frame: vis(r.getElementById("frame")), segs: [...r.querySelectorAll("#sources .seg")].filter(vis).map((x) => x.textContent.trim()), bars: [...r.querySelectorAll(".vol")].filter(vis).length }; });
  check("default: no frame, the TV first by its name, still one bar", !flat.frame && flat.segs[0] === "TV" && flat.bars === 1, JSON.stringify(flat));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
