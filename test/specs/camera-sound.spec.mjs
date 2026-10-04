// The camera card's sound: muted by default, a speaker button only when the stream has sound, one tile at a time,
// back to muted when the picture goes, the popup closes or the tab hides; `audio_button: false` hides it.
// Home Assistant's player is faked: a custom element with a nested <video> whose audio tracks the test controls.
import { openPage, idle } from "./_util.mjs";

const FAKE = () => {
  window.__audio = {};
  customElements.define("ha-camera-stream", class extends HTMLElement {
    constructor() {
      super();
      this._muted = true;
      const inner = document.createElement("div");
      this.attachShadow({ mode: "open" }).appendChild(inner);
      const holder = inner.attachShadow({ mode: "open" });
      this.video = document.createElement("video");
      Object.defineProperty(this.video, "audioTracks", { get: () => ({ length: window.__audio[this.stateObj?.entity_id] ? 1 : 0 }) });
      this.video.muted = true;
      holder.appendChild(this.video);
    }
    set muted(v) { this._muted = !!v; this.video.muted = !!v; }
    get muted() { return this._muted; }
  });
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(FAKE);
    await page.evaluate((width) => {
      window.mount("savvy-camera-card", { area: ["living_room", "kitchen"], columns: "2" }, width);
      window.mount("savvy-camera-card", { area: "living_room", audio_button: false }, width);
    }, width);
    await page.waitForTimeout(1600);
    const read = (i) => page.evaluate((i) => {
      const card = window.cards[i];
      return card._tiles.map((t) => ({ hidden: t.snd.hidden, pressed: t.snd.getAttribute("aria-pressed"), label: t.snd.getAttribute("aria-label"), icon: t.snd.querySelector("ha-icon").getAttribute("icon"),
        muted: t.liveEl?.muted, inner: t.liveEl?.video?.muted, live: !!t.liveEl }));
    }, i);
    const tap = async (i, n = 0) => {
      const at = await page.evaluate(({ i, n }) => { const b = window.cards[i]._tiles[n].snd; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, { i, n });
      await page.mouse.click(...at);
      await page.waitForTimeout(150);
    };
    const audio = (entity, on) => page.evaluate(({ entity, on }) => { window.__audio[entity] = on; }, { entity, on });
    // with two cameras the card is a grid at 900 and a pager at 360: bring a tile into view either way
    const show = (n) => page.evaluate((n) => { const c = window.cards[0]; if (!c._grid) c._select?.(n); }, n);

    let a = await read(0);
    check(`${tag} the live pictures are there, muted, and there is no button without sound`, a.every((t) => t.live && t.muted === true && t.hidden), JSON.stringify(a));

    await audio("camera.living_room", true);
    await page.waitForTimeout(1300);
    a = await read(0);
    check(`${tag} a speaker button shows only on the camera that has sound`, !a[0].hidden && a[1].hidden, JSON.stringify(a));
    check(`${tag} it starts muted: label "Unmute", not pressed, volume-off`, a[0].label === "Unmute" && a[0].pressed === "false" && a[0].icon === "mdi:volume-off" && a[0].muted === true && a[0].inner === true, JSON.stringify(a[0]));

    await tap(0);
    a = await read(0);
    check(`${tag} one tap turns the sound on: "Mute", pressed, volume-high, player unmuted`, a[0].label === "Mute" && a[0].pressed === "true" && a[0].icon === "mdi:volume-high" && a[0].muted === false && a[0].inner === false, JSON.stringify(a[0]));
    await tap(0);
    a = await read(0);
    check(`${tag} a second tap mutes again`, a[0].pressed === "false" && a[0].muted === true && a[0].inner === true, JSON.stringify(a[0]));

    // one tile at a time
    await audio("camera.kitchen", true);
    await page.waitForTimeout(1300);
    await tap(0, 0);
    await show(1);
    await page.waitForTimeout(500);
    await tap(0, 1);
    a = await read(0);
    check(`${tag} sound is on for one tile at a time`, a[1].pressed === "true" && a[1].muted === false && a[0].pressed === "false" && a[0].muted === true, JSON.stringify(a));
    await tap(0, 1);
    await show(0);
    await page.waitForTimeout(500);

    // the stream loses its sound: the button goes and the picture is muted
    await tap(0, 0);
    await audio("camera.living_room", false);
    await page.waitForTimeout(1300);
    a = await read(0);
    check(`${tag} sound gone from the stream: no button, muted`, a[0].hidden && a[0].muted === true, JSON.stringify(a[0]));
    await audio("camera.living_room", true);
    await page.waitForTimeout(1300);

    // the tab hides
    await tap(0, 0);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    a = await read(0);
    check(`${tag} hiding the tab mutes`, a[0].muted === true && a[0].pressed === "false", JSON.stringify(a[0]));
    await page.evaluate(() => { delete document.hidden; });

    // a popup closing mutes
    await tap(0, 0);
    await page.evaluate(() => window.cards[0]._closeDialog());
    a = await read(0);
    check(`${tag} closing the popup mutes`, a[0].muted === true && a[0].pressed === "false", JSON.stringify(a[0]));

    // the stream restarting (a new element) is muted
    await tap(0, 0);
    await page.evaluate(() => { const c = window.cards[0]; c._dropLive(c._tiles[0]); c._syncLive(); });
    await page.waitForTimeout(1500);
    a = await read(0);
    check(`${tag} a restarted stream is muted`, a[0].live && a[0].muted === true && a[0].pressed === "false", JSON.stringify(a[0]));

    // keyboard: the button is a real button
    const kb = await page.evaluate(() => { const b = window.cards[0]._tiles[0].snd; return { tag: b.tagName, tab: b.tabIndex }; });
    check(`${tag} the speaker is a real button for the keyboard`, kb.tag === "BUTTON" && kb.tab >= 0, JSON.stringify(kb));

    // audio_button: false
    const off = await read(1);
    check(`${tag} audio_button: false: no button even with sound`, off.every((t) => t.hidden && t.muted === true), JSON.stringify(off));

    // the recordings player: its control bar has the speaker, for the lead video
    const rec = await page.evaluate(async () => {
      const c = window.cards[0], t = c._tiles[0];
      c._dropLive(t);
      Object.defineProperty(t.video, "audioTracks", { configurable: true, get: () => ({ length: window.__recSound ? 1 : 0 }) });
      c._mode = "play";
      t.playing = true;
      c._el.ctrl.hidden = false;
      c._syncSound();
      const none = c._el.snd.hidden;
      window.__recSound = true;
      c._syncSound();
      const shown = !c._el.snd.hidden;
      const b = c._el.snd, r = b.getBoundingClientRect();
      b.scrollIntoView({ block: "center" });
      return { none, shown, muted: t.video.muted, label: b.getAttribute("aria-label") };
    });
    const at = await page.evaluate(() => { const r = window.cards[0]._el.snd.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...at);
    await page.waitForTimeout(150);
    const rec2 = await page.evaluate(() => { const c = window.cards[0]; return { muted: c._tiles[0].video.muted, pressed: c._el.snd.getAttribute("aria-pressed"), label: c._el.snd.getAttribute("aria-label") }; });
    check(`${tag} recordings: no speaker without sound, one when the recording has it, muted at first`, rec.none && rec.shown && rec.muted === true && rec.label === "Unmute", JSON.stringify(rec));
    check(`${tag} recordings: a tap unmutes the lead video`, rec2.muted === false && rec2.pressed === "true" && rec2.label === "Mute", JSON.stringify(rec2));
    await page.evaluate(() => { const c = window.cards[0]; c._stopVideo(c._tiles[0]); c._syncSound(); });
    const rec3 = await page.evaluate(() => window.cards[0]._tiles[0].video.muted);
    check(`${tag} recordings: stopping the recording mutes`, rec3 === true);

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
