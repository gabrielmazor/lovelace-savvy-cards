// savvy-media-card on the made-up house.
import { openPage, idle, shot } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [440, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-media-card", { area: "living_room", presets: [{ entity: "script.good_night", name: "Night" }],
        chips: [{ entity: "switch.living_room_plug", name: "Plug" }], tts: { action: "tts.speak", data: { message: "$MSG", entity_id: "tts.cloud" } } }, width);
      window.mount("savvy-media-card", { area: "kitchen", layout: "compact" }, width);
      // the pre-Savvy shape: players named, actions
      window.mount("savvy-media-card", { name: "Legacy", video: [{ entity: "media_player.living_room_tv", name: "TV" }], audio: ["media_player.kitchen_speaker"],
        actions: [{ entity: "switch.living_room_plug", name: "Plug", tap_action: "more-info" }] }, width);
      await new Promise((res) => setTimeout(res, 500));
      const read = (el) => {
        const R = el.shadowRoot;
        return { title: R.getElementById("title").textContent, now: R.getElementById("nowName").textContent, sub: R.getElementById("nowSub").textContent,
          speakers: [...R.querySelectorAll("#audioBand .player:not([hidden]) .n")].map((n) => n.textContent),
          vols: [...R.querySelectorAll(".vol:not([hidden]) .pct")].map((n) => n.textContent),
          chips: [...R.querySelectorAll(".pill:not([hidden]) span")].map((n) => n.textContent), tts: !R.getElementById("tts").hidden };
      };
      return window.cards.map(read);
    }, width);
    const [lr, kit, legacy] = r;
    // the TV is on and plays through itself: its speakers lead the sound band, the speaker is the next in its picker
    check(`${tag} the area's players: the TV is the source, its sound at the bottom`, lr.title === "Living Room" && lr.now === "TV"
      && JSON.stringify(lr.speakers) === JSON.stringify(["TV"]) && lr.vols.length === 2, JSON.stringify(lr));
    check(`${tag} presets, text to speech, chips`, JSON.stringify(lr.chips) === JSON.stringify(["Night", "Plug"]) && lr.tts, JSON.stringify(lr));
    check(`${tag} compact: one row, what's playing`, kit.now === "A Song" && kit.vols.length === 1, JSON.stringify(kit));
    check(`${tag} the pre-Savvy shape: players and actions`, legacy.now === "TV" && JSON.stringify(legacy.speakers) === JSON.stringify(["TV"]) && legacy.chips[0] === "Plug", JSON.stringify(legacy));

    // gestures: play/pause, a preset, TTS, the volume steppers, a sideways drag; a tap on the bar alone never changes it
    await page.evaluate(() => { window.log.length = 0; window.info = []; document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId)); });
    const at = (sel, i = 0, k = 0) => page.evaluate(({ sel, i, k }) => { const b = window.cards[k].shadowRoot.querySelectorAll(sel)[i].getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, { sel, i, k });
    await page.mouse.click(...await at('#nowTransport .tb[data-k="play"]'));
    await page.mouse.click(...await at(".pill"));
    await page.mouse.click(...await at(".pill", 0, 2));
    await page.evaluate(() => { const i = window.cards[0].shadowRoot.getElementById("ttsInput"); i.value = "Dinner's ready"; i.dispatchEvent(new Event("input")); });
    await page.mouse.click(...await at("#ttsSend"));
    await page.mouse.click(...await at('.vstep[data-d="1"]'));
    const bar = await at(".slider");
    await page.mouse.click(...bar);
    await page.waitForTimeout(200);
    const tapLog = await page.evaluate(() => [...window.log]);
    await page.mouse.move(bar[0], bar[1]); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(bar[0] + i * 12, bar[1] + 1); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => ({ log: [...window.log], info: [...window.info] }));
    check(`${tag} play/pause, a preset runs, a more-info chip opens it`, g.log[0] === "media_player.media_play_pause {} media_player.living_room_tv"
      && g.log[1] === "script.turn_on {} script.good_night" && g.info[0] === "switch.living_room_plug", JSON.stringify(g));
    check(`${tag} text to speech fills $MSG`, g.log.some((l) => l.startsWith('tts.speak {"message":"Dinner\'s ready"} tts.cloud')), JSON.stringify(g.log));
    check(`${tag} + steps the volume; a tap on the bar alone doesn't move it`, tapLog.filter((l) => l.startsWith("media_player.volume_set")).length === 1
      && /volume_level":0\.35/.test(tapLog.find((l) => l.startsWith("media_player.volume_set")) || ""), JSON.stringify(tapLog));
    check(`${tag} a sideways drag sets the volume`, g.log.filter((l) => l.startsWith("media_player.volume_set")).length >= 2, JSON.stringify(g.log));

    if (width === 440) await shot(page, `media-${theme}`, 0);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
