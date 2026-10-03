// savvy-room-header-card on the made-up house.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [560, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-room-header-card", { area: "living_room", control: "input_select.living_room_scene", home_path: "/lovelace/home",
        entities: [{ entity: "input_boolean.movie_mode", name: "Movie", icon: "mdi:movie" }], room_path: "/lovelace/{slug}",
        chips: [{ entity: "switch.living_room_plug", name: "Plug" }], room_order: ["office"] }, width);
      window.mount("savvy-room-header-card", { area: "bedroom", auto_discover: false, entities: ["binary_sensor.bedroom_window"], icons_only: true }, width);
      window.mount("savvy-room-header-card", { area: "kitchen", light_state: "input_boolean.movie_mode", sensor_icons_only: false, ignore_sensors: ["media"],
        order: ["bedroom"], rooms: [{ area: "office", name: "Study", navigation_path: "/lovelace/study" }], exclude_rooms: ["empty_room"] }, width);
      await new Promise((res) => setTimeout(res, 500));
      const read = (el) => {
        const r = el.shadowRoot, $ = (id) => r.getElementById(id);
        const row = (id) => [...r.querySelectorAll(`#${id} .chip`)].map((c) => c.getAttribute("aria-label"));
        return { mode: $("pill").hidden ? null : $("val").textContent, pre: $("pre").textContent, home: !$("home").hidden,
          temp: $("temp").hidden ? null : $("deg").textContent, sensors: row("sensors"), chips: row("chips"), rooms: row("rooms"),
          dim: [...r.querySelectorAll("#sensors .chip .body")].map((b) => (/opacity\(([\d.]+)\)/.exec(b.style.filter || "") || [0, "1"])[1]),
          iconOnly: $("sensors").hasAttribute("data-icon-only"), sep: !$("sep").hidden };
      };
      return window.cards.map(read);
    }, width);
    const [lr, bed, kit] = r;
    check(`${tag} mode, caption, home button, temperature`, lr.mode === "Relax" && lr.pre === "Room mode" && lr.home && lr.temp === "23.6°C", JSON.stringify(lr));
    check(`${tag} pinned first, then everything the room has, on or off`, JSON.stringify(lr.sensors.map((s) => s.split(",")[0])) ===
      JSON.stringify(["Movie", "Presence", "Door", "Media", "Climate"]), JSON.stringify(lr.sensors));
    check(`${tag} idle ones dimmed (the pinned helper, the closed door)`, lr.dim[0] !== "1" && lr.dim[2] !== "1" && lr.dim[1] === "1", JSON.stringify(lr.dim));
    const media = await page.evaluate(() => {
      const out = {};
      for (const state of ["paused", "idle", "on", "off", "standby", "playing", "unavailable"]) {
        window.setStates({ "media_player.living_room_tv": state, "media_player.living_room_speaker": "off" });
        out[state] = [...window.cards[0].shadowRoot.querySelectorAll("#sensors .chip")].find((c) => c.getAttribute("aria-label").startsWith("Media")).getAttribute("aria-label");
      }
      window.setStates({ "media_player.living_room_tv": "playing", "media_player.living_room_speaker": "idle" });
      return out;
    });
    check(`${tag} media: anything but playing reads "Not playing"`, ["paused", "idle", "on", "off", "standby"].every((k) => media[k] === "Media, Not playing")
      && media.playing === "Media, Playing" && media.unavailable === "Media, Unavailable", JSON.stringify(media));
    check(`${tag} your chips, their own row`, JSON.stringify(lr.chips) === JSON.stringify(["Plug, On"]), JSON.stringify(lr.chips));
    check(`${tag} rooms row: every other room with something in it, ordered, alphabetical after`, JSON.stringify(lr.rooms) ===
      JSON.stringify(["Office", "Bedroom", "Hallway", "Kitchen"]) && lr.sep, JSON.stringify(lr.rooms));
    check(`${tag} discovery off: only the pinned (captioned by its kind), icons only; no room paths, no rooms row`, JSON.stringify(bed.sensors.map((s) => s.split(",")[0])) === JSON.stringify(["Window"])
      && bed.iconOnly && !bed.rooms.length && !bed.sep && bed.mode === null, JSON.stringify(bed));
    check(`${tag} pre-Savvy keys: light_state first as "Light", ignore_sensors, order, rooms overrides`, kit.sensors[0].startsWith("Light,")
      && !kit.sensors.some((s) => s.startsWith("Media")) && JSON.stringify(kit.rooms) === JSON.stringify(["Study"]), JSON.stringify(kit));

    // gestures: pinned helper toggles; a sensor opens more-info; a room navigates; the mode picker
    await page.evaluate(() => { window.nav = []; window.info = []; window.addEventListener("location-changed", () => window.nav.push(location.pathname));
      document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId)); window.log.length = 0; });
    const chip = (sel, i) => page.evaluate(({ sel, i }) => { const b = window.cards[0].shadowRoot.querySelectorAll(sel)[i].getBoundingClientRect(); return [b.x + 15, b.y + b.height / 2]; }, { sel, i });
    await page.mouse.click(...await chip("#sensors .chip", 0));
    await page.mouse.click(...await chip("#sensors .chip", 1));
    await page.mouse.click(...await chip("#rooms .chip", 0));
    await page.mouse.click(...await chip("#home", 0));
    await page.waitForTimeout(300);
    const g = await page.evaluate(() => ({ log: [...window.log], info: [...window.info], nav: [...window.nav] }));
    check(`${tag} pinned helper toggles; a sensor opens more-info; rooms and home navigate`, g.log[0] === "input_boolean.toggle {} input_boolean.movie_mode"
      && g.info[0] === "binary_sensor.living_room_presence" && g.nav[0] === "/lovelace/office" && g.nav[1] === "/lovelace/home", JSON.stringify(g));
    await page.mouse.click(...Object.values(await centerOf(page, 0, "#pill")));
    await page.waitForTimeout(450);
    const opts = await page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-opt")].map((o) => o.textContent));
    check(`${tag} the mode picker lists the room's options`, JSON.stringify(opts) === JSON.stringify(["Auto", "Relax", "Reading", "Movie", "Party"]), JSON.stringify(opts));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    const closed = await page.evaluate(() => !window.cards[0]._picker.isOpen);
    check(`${tag} Escape closes the picker`, closed);

    if (width === 560) await shot(page, `room-${theme}`, 0);
    await page.evaluate(() => window.setStates({ "climate.living_room_ac": { state: "off", attributes: { ...window.house.states["climate.living_room_ac"].attributes, hvac_action: "off" } } }));
    check(`${tag} springs idle`, await idle(page, 6000));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
