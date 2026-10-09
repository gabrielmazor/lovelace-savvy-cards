// The media card's screens: the TV owns the volume of everything watched on it (an Apple TV, a console);
// when its sound goes out over eARC to the soundbar the config names, the bar is the soundbar's own, and
// that soundbar leaves Listen while the TV is on, so a box never shows two bars. Nothing is guessed:
// without an output in the config the TV plays through itself.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  const TV = "media_player.living_room_tv", BAR = "media_player.living_room_speaker", SPK = "media_player.kitchen_speaker";
  await page.evaluate(({ TV, BAR, SPK }) => {
    const a = (id) => window.hass.states[id].attributes;
    window.setStates({
      [TV]: { state: "on", attributes: { ...a(TV), volume_level: 0.12, sound_output: "external_arc" } },
      [BAR]: { state: "on", attributes: { ...a(BAR), volume_level: 0.34, device_class: "receiver" } },
      [SPK]: { state: "idle", attributes: { ...a(SPK), volume_level: 0.25 } },
      "media_player.streamer": { state: "playing", attributes: { friendly_name: "Streamer", supported_features: 21437, volume_level: 0.9, media_title: "A Show" } },
    });
  }, { TV, BAR, SPK });
  const mount = (cfg) => page.evaluate((cfg) => window.mount("savvy-media-card", { name: "Living", artwork: false, ...cfg }, 460), cfg);
  const read = () => page.evaluate(() => {
    const r = window.cards.at(-1).shadowRoot, vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
    return {
      bars: [...r.querySelectorAll(".vol")].filter(vis).map((v) => v.querySelector(".pct")?.textContent),
      source: r.querySelector("#nowVol .vol .pct")?.textContent, via: vis(r.querySelector("#nowVol .via")) ? r.querySelector("#nowVol .via").textContent.trim() : "",
      listen: vis(r.getElementById("audioBand")) ? [...r.querySelectorAll("#audioBand .player")].filter(vis).map((p) => p.querySelector(".n").textContent) : [],
      segs: [...r.querySelectorAll("#speakers .seg")].filter(vis).map((x) => x.textContent.trim()),
    };
  });
  const both = { video: [{ entity: "media_player.streamer" }, { entity: TV }], audio: [{ entity: BAR, name: "Soundbar" }, { entity: SPK, name: "Speaker" }] };

  // eARC to the configured soundbar: one bar, the soundbar's, under what you watch; Listen keeps only the other speaker
  await mount({ ...both, video_output: BAR });
  await page.waitForTimeout(800);
  const arc = await read();
  check("eARC, soundbar configured: the bar under the source is the soundbar's (34%)", arc.source === "34%" && /Soundbar/.test(arc.via), JSON.stringify(arc));
  check("...and the soundbar is not in Listen, so no second bar for it", !arc.listen.includes("Soundbar") && arc.listen.includes("Speaker") && arc.bars.filter((b) => b === "34%").length === 1, JSON.stringify(arc));

  // the streamer has no volume of its own: it plays on the TV
  check("the streamer's own level (90%) is never shown", !arc.bars.includes("90%"), JSON.stringify(arc.bars));

  // the TV switched to its own speakers: the TV's bar, and the soundbar is free again
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, sound_output: "tv_speaker" } } }), TV);
  await page.waitForTimeout(800);
  const own = await read();
  check("TV speakers: the bar is the TV's (12%)", own.source === "12%" && /TV speaker/.test(own.via), JSON.stringify(own));
  check("...and the soundbar is back in Listen with a picker", own.segs.includes("Soundbar") && own.segs.includes("Speaker"), JSON.stringify(own));

  // the TV off: its soundbar is free to play on its own
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "off", attributes: { ...window.hass.states[TV].attributes, sound_output: "external_arc" } } }), TV);
  await page.waitForTimeout(800);
  const off = await read();
  check("TV off: the soundbar is in Listen again", off.segs.includes("Soundbar"), JSON.stringify(off));

  // nothing configured: never guessed, the TV plays through itself
  await page.evaluate((TV) => window.setStates({ [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, sound_output: "external_arc" } } }), TV);
  await mount(both);
  await page.waitForTimeout(800);
  const none = await read();
  check("no output in the config: the TV's own bar, the soundbar stays a speaker in Listen", none.source === "12%" && none.segs.includes("Soundbar"), JSON.stringify(none));

  // a TV that doesn't say where its sound goes (not an LG): the configured soundbar's bar while the soundbar is on
  await page.evaluate((TV) => { const a = { ...window.hass.states[TV].attributes }; delete a.sound_output; window.setStates({ [TV]: { state: "on", attributes: a } }); }, TV);
  await mount({ ...both, video_output: BAR });
  await page.waitForTimeout(800);
  const plain = await read();
  check("another brand, soundbar configured and on: the soundbar's bar, once", plain.source === "34%" && !plain.listen.includes("Soundbar"), JSON.stringify(plain));
  await page.evaluate((BAR) => window.setStates({ [BAR]: { state: "off", attributes: window.hass.states[BAR].attributes } }), BAR);
  await page.waitForTimeout(800);
  const barOff = await read();
  check("...and with the soundbar off, the TV's own bar", barOff.source === "12%", JSON.stringify(barOff));

  // a TV alone: its own bar
  await mount({ video: [{ entity: TV }] });
  await page.waitForTimeout(800);
  const alone = await read();
  check("a TV alone: its own bar", alone.source === "12%" && alone.bars.length === 1, JSON.stringify(alone));

  // the soundbar playing its own music while the TV is on: not the TV's sound
  await page.evaluate(({ TV, BAR }) => window.setStates({
    [TV]: { state: "on", attributes: { ...window.hass.states[TV].attributes, volume_level: 0.12, sound_output: "external_arc" } },
    [BAR]: { state: "playing", attributes: { ...window.hass.states[BAR].attributes, source: "Spotify", media_title: "So What" } },
  }), { TV, BAR });
  await mount({ ...both, video_output: BAR });
  await page.waitForTimeout(800);
  const spot = await read();
  check("soundbar on Spotify while the TV is on: the bar under the screen is the TV's, the soundbar is in Listen", spot.source === "12%" && spot.listen.includes("Soundbar"), JSON.stringify(spot));
  await page.evaluate((BAR) => window.setStates({ [BAR]: { state: "on", attributes: { ...window.hass.states[BAR].attributes, source: "TV", media_title: null } } }), BAR);
  await page.waitForTimeout(800);
  const back = await read();
  check("back on the TV input: the soundbar's bar under the screen, out of Listen", back.source === "34%" && !back.listen.includes("Soundbar"), JSON.stringify(back));
  await page.evaluate((BAR) => window.setStates({ [BAR]: { state: "on", attributes: { ...window.hass.states[BAR].attributes, source: "Input 2" } } }), BAR);
  await mount({ ...both, video_output: BAR, output_source: "Input 2" });
  await page.waitForTimeout(800);
  const named = await read();
  check("output_source names the soundbar's TV input when it has another name", named.source === "34%", JSON.stringify(named));

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
  check("two screens: the second TV keeps its own bar (55%), not the first TV's soundbar", two.source === "55%", JSON.stringify(two));
  const str = await pickSeg("Streamer");
  check("two screens: an unmapped source plays on the first TV (its soundbar's 34%)", str.source === "34%", JSON.stringify(str));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
