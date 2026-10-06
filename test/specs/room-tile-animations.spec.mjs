// savvy-room-tile: its animations can be turned off (on the card, or for every tile from the settings card),
// a badge's halo has room around it, and the room's light badge takes the entity's own icon.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 360 });
  const r = await page.evaluate(async () => {
    const S = window.__savvy;
    const on = window.mount("savvy-room-tile", { area: "living_room" }, 360);
    const off = window.mount("savvy-room-tile", { area: "living_room", animations: false }, 360);
    await new Promise((res) => setTimeout(res, 500));
    const pad = parseFloat(getComputedStyle(on.shadowRoot.getElementById("badges")).paddingTop);
    const halo = on.shadowRoot.querySelector(".halo"), chip = on.shadowRoot.querySelector(".chip");
    const overhang = halo && chip ? (parseFloat(getComputedStyle(halo).height) - chip.getBoundingClientRect().height) / 2 : null;
    const settings = { design: { animations: false }, rooms: { living_room: { light_state: "switch.living_room_plug" } } };
    const fromSettings = S.resolveSettings("savvy-room-tile", { area: "living_room" }, settings).config;
    const own = S.resolveSettings("savvy-room-tile", { area: "living_room", animations: true }, settings).config.animations;
    return { onMotion: on._noMotion(), offMotion: off._noMotion(), pad, overhang, anim: fromSettings.animations, own, entities: fromSettings.entities };
  });
  check("animations are on by default and off when the card says so", r.onMotion === false && r.offMotion === true, JSON.stringify([r.onMotion, r.offMotion]));
  check("the settings card turns them off for every tile; a tile's own setting wins", r.anim === false && r.own === true, JSON.stringify([r.anim, r.own]));
  check("a badge's halo has room around it in the row", r.overhang !== null && r.pad >= r.overhang, JSON.stringify([r.pad, r.overhang]));
  check("the room's light badge takes the entity's own icon", r.entities?.[0]?.entity === "switch.living_room_plug" && r.entities[0].icon === undefined, JSON.stringify(r.entities));
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
