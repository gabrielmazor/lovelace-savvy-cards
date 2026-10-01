// The control chip: what a tap does follows the entity's domain, and any action overrides it.
import { openPage, idle } from "./_util.mjs";

const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };
const DOMAINS = [
  ["input_select.house_mode", "picker"],
  ["button.robot_vacuum", "button.press {} button.robot_vacuum"],
  ["scene.evening", "scene.turn_on {} scene.evening"],
  ["script.good_night", "script.turn_on {} script.good_night"],
  ["switch.living_room_plug", "switch.toggle {} switch.living_room_plug"],
  ["input_boolean.movie_mode", "input_boolean.toggle {} input_boolean.movie_mode"],
  ["sensor.living_room_temperature", "more-info"],
];

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 520], ["light", 340]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(() => {
      window.info = []; window.nav = [];
      document.addEventListener("hass-more-info", (e) => window.info.push(e.detail.entityId));
      window.addEventListener("location-changed", () => window.nav.push(location.pathname));
    });
    const center = (sel, card = 0) => page.evaluate(({ sel, card }) => { const r = window.cards[card].shadowRoot.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { sel, card });
    const state = () => page.evaluate(() => ({ log: [...window.log], info: [...window.info], nav: [...window.nav], pick: window.__savvy.portalRoot().querySelectorAll(".sv-pick .sv-opt").length }));
    const reset = () => page.evaluate(() => { window.log.length = 0; window.info.length = 0; window.nav.length = 0; });
    const closePicker = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };

    // every domain, in the home header, the room header and the section title
    for (const [kind, type, pill] of [["home header", "savvy-home-header-card", "#pill"], ["room header", "savvy-room-header-card", "#pill"], ["section title", "savvy-section-title-card", "#mode"]]) {
      for (const [id, want] of DOMAINS) {
        const idx = await page.evaluate(({ type, id }) => { window.mount(type, { area: "living_room", control: id }, 440); return window.cards.length - 1; }, { type, id });
        await page.waitForTimeout(300);
        await reset();
        const p = await center(pill, idx);
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(450);
        const s = await state();
        const ok = want === "picker" ? s.pick > 0 && !s.log.length
          : want === "more-info" ? s.info[0] === id && !s.pick
          : s.log.length === 1 && s.log[0] === want && !s.pick;
        check(`${tag} ${kind}: ${id.split(".")[0]} tap ${want === "picker" ? "opens the picker" : want === "more-info" ? "opens more-info" : "runs " + want.split(" ")[0]}`, ok, JSON.stringify(s));
        if (want === "picker") await closePicker();
        await reset();
        await hold(page, p);
        await page.waitForTimeout(350);
        const h = await state();
        check(`${tag} ${kind}: ${id.split(".")[0]} hold opens more-info`, h.info[0] === id && !h.log.length, JSON.stringify(h));
        await page.evaluate(() => { for (const c of window.cards.splice(window.cards.length - 1, 1)) c.remove(); });
      }
    }

    // what the chip shows: a select its option and caption; a button its name alone; a switch its state under its name
    const shown = await page.evaluate(async () => {
      const mk = (cfg) => { const el = window.mount("savvy-home-header-card", cfg, 440); return el; };
      const els = [mk({ control: "input_select.house_mode" }), mk({ control: "button.robot_vacuum" }), mk({ control: "switch.living_room_plug" }), mk({ control: { entity: "scene.evening", name: "Movie time", icon: "mdi:movie" } })];
      await new Promise((r) => setTimeout(r, 500));
      return els.map((el) => { const r = el.shadowRoot; return { val: r.getElementById("val").textContent, pre: r.getElementById("pre").hidden ? "" : r.getElementById("pre").textContent, icon: r.getElementById("pillIcon").getAttribute("icon"), pop: r.getElementById("pill").getAttribute("aria-haspopup") }; });
    });
    check(`${tag} a select shows its option under its caption and says it has a popup`, shown[0].val === "Home" && shown[0].pre === "Home mode" && shown[0].pop === "listbox", JSON.stringify(shown[0]));
    check(`${tag} a button shows its name alone, with an icon, and no popup`, shown[1].val === "Robot Vacuum" && shown[1].pre === "" && shown[1].icon && !shown[1].pop, JSON.stringify(shown[1]));
    check(`${tag} a switch shows its state under its name`, shown[2].val === "On" && shown[2].pre === "Living Room Plug" && !shown[2].pop, JSON.stringify(shown[2]));
    check(`${tag} the object form sets the name and icon`, shown[3].val === "Movie time" && shown[3].icon === "mdi:movie", JSON.stringify(shown[3]));

    // overrides: a tap_action replaces the picker, a hold_action replaces more-info, a double tap is added
    const idx = await page.evaluate(() => {
      window.mount("savvy-home-header-card", { control: "input_select.house_mode",
        control_tap_action: { action: "navigate", navigation_path: "/lovelace/modes" },
        control_hold_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: "script.good_night" } },
        control_double_tap_action: { action: "toggle", entity: "input_boolean.movie_mode" } }, 440);
      window.mount("savvy-home-header-card", { control: { entity: "switch.living_room_plug", tap_action: { action: "none" } } }, 440);
      return window.cards.length - 2;
    });
    await page.waitForTimeout(400);
    await reset();
    const p = await center("#pill", idx);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(450);
    const t = await state();
    check(`${tag} tap_action replaces the picker`, t.nav.at(-1) === "/lovelace/modes" && !t.pick && !t.log.length, JSON.stringify(t));
    await reset();
    await hold(page, p);
    await page.waitForTimeout(350);
    const hh = await state();
    check(`${tag} hold_action replaces more-info`, hh.log[0] === "script.turn_on {} script.good_night" && !hh.info.length, JSON.stringify(hh));
    await reset();
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(450);
    const dd = await state();
    check(`${tag} a double tap action is added`, dd.log.some((l) => l === "input_boolean.toggle {} input_boolean.movie_mode") && !dd.pick, JSON.stringify(dd));
    await reset();
    const p2 = await center("#pill", idx + 1);
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(450);
    const none = await state();
    check(`${tag} an action of none does nothing`, !none.log.length && !none.info.length && !none.nav.length, JSON.stringify(none));

    // the picker still picks
    await reset();
    const i3 = await page.evaluate(() => { window.mount("savvy-home-header-card", { control: "input_select.house_mode" }, 440); return window.cards.length - 1; });
    await page.waitForTimeout(300);
    const p3 = await center("#pill", i3);
    await page.mouse.click(p3.x, p3.y);
    await page.waitForTimeout(450);
    const away = await page.evaluate(() => { const o = [...window.__savvy.portalRoot().querySelectorAll(".sv-opt")].find((x) => x.textContent === "Away").getBoundingClientRect(); return { x: o.x + o.width / 2, y: o.y + o.height / 2 }; });
    await page.mouse.click(away.x, away.y);
    await page.waitForTimeout(450);
    check(`${tag} the picker still sets a select's option`, (await state()).log.includes('input_select.select_option {"option":"Away"} input_select.house_mode'));

    // the room tile shows its control read only: a select's option, any other entity's state
    const tile = await page.evaluate(async () => {
      const a = window.mount("savvy-room-tile", { area: "living_room", control: "input_select.living_room_scene" }, 260);
      const b = window.mount("savvy-room-tile", { area: "living_room", control: "switch.living_room_plug" }, 260);
      const c = window.mount("savvy-room-tile", { area: "living_room", control: "scene.evening" }, 260);
      await new Promise((r) => setTimeout(r, 500));
      return [a, b, c].map((el) => { const m = el.shadowRoot.getElementById("mode"); return m.hidden ? null : el.shadowRoot.getElementById("label").textContent; });
    });
    check(`${tag} the room tile shows a select's option, a switch's state, a scene's name`, JSON.stringify(tile) === JSON.stringify(["Relax", "On", "Evening"]), JSON.stringify(tile));
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
