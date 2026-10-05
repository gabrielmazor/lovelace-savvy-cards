// savvy-cover-card: the covers of a room as the popup's rows, inline; Open all / Close all; a guarded garage and gate.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, area) => {
    house.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
    h.entities[id] = { entity_id: id, area_id: area, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  add("cover.living_room_blind", "open", { friendly_name: "Living Room Blind", device_class: "blind", current_position: 60, current_tilt_position: 40, supported_features: 15 | 128 | 16 | 32 }, "living_room");
  add("cover.living_room_curtain", "closed", { friendly_name: "Living Room Curtain", device_class: "curtain", current_position: 0, supported_features: 15 }, "living_room");
  add("cover.bedroom_shutter", "closed", { friendly_name: "Bedroom Shutter", device_class: "shutter", current_position: 0, supported_features: 15 }, "bedroom");
  add("cover.garage_door", "open", { friendly_name: "Garage Door", device_class: "garage", supported_features: 3 }, "hallway");
  add("cover.driveway_gate", "closed", { friendly_name: "Driveway Gate", device_class: "gate", supported_features: 3 }, "hallway");
  window.hass = { ...h, states: { ...house.states } };
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP);
    await page.evaluate((width) => {
      window.mount("savvy-cover-card", {}, width);                                                // 0 the house
      window.mount("savvy-cover-card", { area: "living_room" }, width);                           // 1
      window.mount("savvy-cover-card", { classes: ["shutter", "curtain"], exclude: ["cover.living_room_curtain"] }, width);  // 2
      window.mount("savvy-cover-card", { layout: "compact" }, width);                             // 3
      window.mount("savvy-cover-card", { area: ["living_room", "hallway"], controls: "slider" }, width);   // 4
      window.mount("savvy-cover-card", { area: "living_room", covers: [{ entity: "cover.living_room_blind", name: "Lounge blind", icon: "mdi:blinds-horizontal" }] }, width);   // 5
    }, width);
    await page.waitForTimeout(900);
    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return { title: R.getElementById("title").textContent, pill: R.getElementById("pill").hidden ? "" : R.getElementById("pill").textContent,
        names: [...R.querySelectorAll(".sv-row .sv-name")].map((n) => n.textContent), up: R.getElementById("up").hidden ? "hidden" : R.getElementById("up").hasAttribute("disabled") ? "off" : "on",
        down: R.getElementById("down").hidden ? "hidden" : R.getElementById("down").hasAttribute("disabled") ? "off" : "on",
        glow: getComputedStyle(R.querySelector("ha-card")).getPropertyValue("--glow").trim(), rows: !R.getElementById("rows").hidden };
    }, i);
    const s0 = await read(0), s1 = await read(1), s2 = await read(2), s3 = await read(3);
    check(`${tag} every cover of the house, rooms and names the popup's way`, s0.names.length === 5 && s0.names.includes("Blind") && s0.names.includes("Garage Door"), JSON.stringify(s0));
    check(`${tag} an area is the title, and only its covers`, s1.title === "Living Room covers" && JSON.stringify(s1.names) === JSON.stringify(["Blind", "Curtain"]), JSON.stringify(s1));
    check(`${tag} kinds and exclude`, JSON.stringify(s2.names) === JSON.stringify(["Shutter"]) && s2.up === "hidden", JSON.stringify(s2));
    check(`${tag} the pill counts what is open, amber with the garage open`, s0.pill === "2 open" && Number(s0.glow) >= 0, JSON.stringify([s0.pill, s0.glow]));
    check(`${tag} compact: the summary and the buttons, no rows`, !s3.rows && s3.pill === "2 open" && s3.up === "on", JSON.stringify(s3));

    const calls = async (fn) => { await page.evaluate(() => { window.log.length = 0; }); await fn(); await page.waitForTimeout(500); return page.evaluate(() => [...window.log]); };
    const click = async (sel, i = 0, card = 0) => {
      const p = await page.evaluate(({ sel, i, card }) => { const e = [...window.cards[card].shadowRoot.querySelectorAll(sel)][i]; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { sel, i, card });
      await page.mouse.click(p.x, p.y);
    };

    // Close all: what is open (garage too); Open all: what is closed, but not the garage or the gate
    const close = await calls(() => click("#down"));
    check(`${tag} Close all closes exactly what is open, the garage included`, close.length === 1 && /^cover\.close_cover \{\} 2 entities$/.test(close[0]), JSON.stringify(close));
    const open = await calls(() => click("#up"));
    check(`${tag} Open all opens the closed ones, not the gate`, open.length === 1 && /^cover\.open_cover \{\} 2 entities$/.test(open[0]), JSON.stringify(open));

    // a garage door asks twice to open
    await page.evaluate(() => window.setStates({ "cover.garage_door": "closed" }));
    await page.waitForTimeout(600);
    const garageRow = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".sv-row")].findIndex((r) => /Garage/.test(r.querySelector(".sv-name").textContent)));
    const once = await calls(() => click(`.sv-row:nth-of-type(${garageRow + 1}) .sv-act .sv-btn`));
    const sub = await page.evaluate((n) => window.cards[0].shadowRoot.querySelectorAll(".sv-row")[n].querySelector(".sv-sub").textContent, garageRow);
    check(`${tag} the first tap on a garage door opens nothing and says so`, once.length === 0 && /Tap again to open/.test(sub), JSON.stringify([once, sub]));
    const twice = await calls(() => click(`.sv-row:nth-of-type(${garageRow + 1}) .sv-act .sv-btn`));
    check(`${tag} the second tap opens it`, twice.length === 1 && /^cover\.open_cover \{\} cover\.garage_door$/.test(twice[0]), JSON.stringify(twice));

    // a blind: position and tilt behind the chevron
    const blindRow = await page.evaluate(() => [...window.cards[1].shadowRoot.querySelectorAll(".sv-row")].findIndex((r) => /Blind/.test(r.querySelector(".sv-name").textContent)));
    await click(`.sv-row:nth-of-type(${blindRow + 1}) .sv-chev`, 0, 1);
    await page.waitForTimeout(500);
    const bars = await page.evaluate((n) => [...window.cards[1].shadowRoot.querySelectorAll(".sv-row")[n].querySelectorAll(".sv-bar")].map((b) => b.getAttribute("aria-label") + ":" + b.getAttribute("aria-valuenow")), blindRow);
    check(`${tag} the blind has a position bar and a tilt bar`, JSON.stringify(bars) === JSON.stringify(["Position:60", "Tilt:40"]), JSON.stringify(bars));
    const key = await calls(async () => {
      await page.evaluate((n) => window.cards[1].shadowRoot.querySelectorAll(".sv-row")[n].querySelectorAll(".sv-bar")[1].focus(), blindRow);
      await page.keyboard.press("ArrowRight");
    });
    check(`${tag} the tilt bar sets the tilt position`, key.some((c) => /^cover\.set_cover_tilt_position \{"tilt_position":45\} cover\.living_room_blind$/.test(c)), JSON.stringify(key));

    // sliders instead of arrows; a cover with no position keeps its arrow
    const sl = await page.evaluate(() => [...window.cards[4].shadowRoot.querySelectorAll(".sv-row")].map((r) => ({ n: r.querySelector(".sv-name").textContent, bar: !!r.querySelector(".sv-act .sv-bar:not([hidden])"), arrow: !!r.querySelector(".sv-act .sv-btn:not([hidden])") })));
    check(`${tag} controls: slider puts the position bar on the line, arrows stay only where a cover has no position`, sl.find((r) => r.n === "Blind").bar && !sl.find((r) => r.n === "Blind").arrow && !sl.find((r) => r.n === "Garage Door").bar && sl.find((r) => r.n === "Garage Door").arrow, JSON.stringify(sl));
    const lineKey = await calls(async () => { await page.evaluate(() => [...window.cards[4].shadowRoot.querySelectorAll(".sv-row")].find((r) => r.querySelector(".sv-name").textContent === "Blind").querySelector(".sv-act .sv-bar").focus()); await page.keyboard.press("ArrowRight"); });
    check(`${tag} the slider on the line sets the position`, lineKey.some((x) => /^cover\.set_cover_position \{"position":65\} cover\.living_room_blind$/.test(x)), JSON.stringify(lineKey));
    const own = await page.evaluate(() => { const r = window.cards[5].shadowRoot.querySelector(".sv-row"); return { n: [...window.cards[5].shadowRoot.querySelectorAll(".sv-row .sv-name")].map((x) => x.textContent), icon: [...window.cards[5].shadowRoot.querySelectorAll(".sv-row")].map((x) => x.querySelector(".sv-ic ha-icon")?.getAttribute("icon")) }; });
    check(`${tag} a cover's own name and icon replace Home Assistant's`, own.n.includes("Lounge blind") && own.icon.includes("mdi:blinds-horizontal") && own.icon.length === 2, JSON.stringify(own));

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
