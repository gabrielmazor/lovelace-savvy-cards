// savvy-home-header-card on the made-up house.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [560, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async ({ width, W }) => {
      window.mount("savvy-home-header-card", { control: "input_select.house_mode", home_path: "/lovelace/home",
        health: { navigation_path: "/lovelace/admin", watchman: W },
        lights: { tap_action: { action: "navigate", navigation_path: "/lovelace/lights" } },
        chips: [{ entity: "switch.living_room_plug", name: "Plug" }] }, width);
      window.mount("savvy-home-header-card", { weather: false, health: false, climate: false, security: { hide: true } }, width);
      // the pre-Savvy shape
      window.mount("savvy-home-header-card", { home_mode: "input_select.house_mode", weather: { entity: "weather.home" },
        admin: { path: "/lovelace/admin", entities: W, battery_threshold: 20 },
        tiles: [{ name: "Energy", entity: "sensor.energy_cost", icon: "mdi:flash", color: "#F5B83D", navigation_path: "/lovelace/energy" }] }, width);
      await new Promise((res) => setTimeout(res, 500));
      const read = (el) => {
        const r = el.shadowRoot, $ = (id) => r.getElementById(id);
        return { mode: $("pill").hidden ? null : $("val").textContent, modeIcon: $("pillIcon").getAttribute("icon"), pre: $("pre").textContent,
          home: !$("home").hidden, weather: $("weather").hidden ? null : $("wtemp").textContent,
          cog: $("health").hidden ? null : ($("count").hidden ? 0 : Number($("count").textContent)),
          chips: [...r.querySelectorAll("#chips .chip")].map((c) => `${c.querySelector(".k").textContent}: ${c.querySelector(".v").textContent}`) };
      };
      const sum = window.__savvy.healthSummary(window.hass, { watchman: W });
      return { cards: window.cards.map(read), total: sum.total, spinning: window.cards[0]._spins.get("chips:climate")?.s.target > 0 };
    }, { width, W });
    const [a, b, legacy] = r.cards;
    check(`${tag} mode chip: the option, its icon, the caption`, a.mode === "Home" && a.modeIcon && a.pre === "Home mode" && a.home, JSON.stringify(a));
    check(`${tag} weather found by itself`, a.weather === "26°", a.weather);
    check(`${tag} the cog counts exactly what the health card finds`, a.cog === r.total && r.total === 6, `${a.cog} vs ${r.total}`);
    check(`${tag} four chips count with no helpers (lights: with or without an area, hidden group members, never the group), then yours`, JSON.stringify(a.chips) === JSON.stringify(
      ["Lights: 5 on", "Climate: 22.8°C", "Media: 2 playing", "Security: Armed Home", "Plug: On"]), JSON.stringify(a.chips));
    check(`${tag} the climate fan spins while a unit runs`, r.spinning);
    check(`${tag} false / hide turn chips and parts off`, JSON.stringify(b.chips) === JSON.stringify(["Lights: 5 on", "Media: 2 playing"])
      && b.weather === null && b.cog === null && b.mode === null, JSON.stringify(b));
    check(`${tag} the pre-Savvy shape still works (tiles, admin, home_mode)`, legacy.mode === "Home" && legacy.weather === "26°" && legacy.cog === 6
      && JSON.stringify(legacy.chips) === JSON.stringify(["Energy: 3.45"]), JSON.stringify(legacy));

    // nothing playing: paused and idle players read "Not playing"
    const quiet = await page.evaluate(async () => {
      window.setStates({ "media_player.living_room_tv": "paused", "media_player.kitchen_speaker": "idle" });
      await new Promise((r) => setTimeout(r, 50));
      const v = [...window.cards[1].shadowRoot.querySelectorAll("#chips .chip")].map((c) => `${c.querySelector(".k").textContent}: ${c.querySelector(".v").textContent}`);
      window.setStates({ "media_player.living_room_tv": "playing", "media_player.kitchen_speaker": "playing" });
      return v;
    });
    check(`${tag} media chip with nothing playing: "Not playing"`, quiet.includes("Media: Not playing"), JSON.stringify(quiet));

    // gestures
    await page.evaluate(() => { window.nav = []; window.addEventListener("location-changed", () => window.nav.push(location.pathname)); window.log.length = 0; });
    await page.mouse.click(...Object.values(await centerOf(page, 0, "#chips .chip")));
    await page.waitForTimeout(200);
    await hold(page, await centerOf(page, 0, "#chips .chip"));
    await page.waitForTimeout(500);
    const list = await page.evaluate(() => ({ nav: [...window.nav], title: window.__savvy.portalRoot().querySelector(".sv-sheet .sv-title")?.textContent,
      rows: [...window.__savvy.portalRoot().querySelectorAll(".sv-sheet .sv-row .sv-name")].map((n) => n.textContent) }));
    check(`${tag} tap follows tap_action (navigate); hold lists the lights that are on`, list.nav[0] === "/lovelace/lights" && list.title === "Lights on"
      && list.rows.length === 5, JSON.stringify(list));
    // turning one off from the list keeps its row (what was counted when it opened)
    await page.evaluate(() => window.setStates({ "light.bedroom_lamp": "off" }));
    await page.waitForTimeout(200);
    const rows2 = await page.evaluate(() => window.__savvy.portalRoot().querySelectorAll(".sv-sheet .sv-row").length);
    check(`${tag} the list keeps a light switched off from it`, rows2 === 5, String(rows2));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);

    // the mode picker: opens from the chip, a pick sets the option
    await page.mouse.click(...Object.values(await centerOf(page, 0, "#pill")));
    await page.waitForTimeout(450);
    const opts = await page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-opt")].map((o) => ({ t: o.textContent, icon: o.querySelector("ha-icon").getAttribute("icon"), sel: o.hasAttribute("data-sel") })));
    check(`${tag} the picker lists every option with its icon, the current one selected`, opts.length === 5 && opts.every((o) => o.icon) && opts.find((o) => o.sel)?.t === "Home"
      && opts.find((o) => o.t === "Movie Night").icon === "mdi:movie-open", JSON.stringify(opts));
    const away = await page.evaluate(() => { const o = [...window.__savvy.portalRoot().querySelectorAll(".sv-opt")].find((x) => x.textContent === "Away").getBoundingClientRect(); return [o.x + o.width / 2, o.y + o.height / 2]; });
    await page.mouse.click(...away);
    await page.waitForTimeout(450);
    const picked = await page.evaluate(() => ({ log: [...window.log], open: window.cards[0]._picker.isOpen }));
    check(`${tag} picking sets the mode and closes the picker`, picked.log.includes("input_select.select_option {\"option\":\"Away\"} input_select.house_mode") && !picked.open, JSON.stringify(picked));
    await page.evaluate(() => window.setStates({ "input_select.house_mode": "Away" }));
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({ v: window.cards[0].shadowRoot.getElementById("val").textContent, icon: window.cards[0].shadowRoot.getElementById("pillIcon").getAttribute("icon") }));
    check(`${tag} the chip swaps to the new mode`, after.v === "Away" && after.icon !== "mdi:shape-outline", JSON.stringify(after));

    // the cog: tap and hold both list what needs attention, the same count; navigation_path only feeds the popup's button
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(...Object.values(await centerOf(page, 0, "#health")));
    await page.waitForTimeout(600);
    const tapped = await page.evaluate(() => ({ nav: [...window.nav], open: window.__savvy.portalRoot().querySelectorAll(".sv-sheet").length }));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await hold(page, await centerOf(page, 0, "#health"));
    await page.waitForTimeout(600);
    const health = await page.evaluate(() => {
      const hc = window.__savvy.portalRoot().querySelector(".sv-sheet savvy-system-health-card");
      return { nav: [...window.nav], pill: hc?.shadowRoot.getElementById("pill").textContent,
        groups: hc ? [...hc.shadowRoot.querySelectorAll(".group .gt")].map((g) => g.textContent) : [] };
    });
    check(`${tag} cog: a tap opens the list (navigation_path does not navigate); hold lists everything the count is made of`, tapped.nav.length === 0 && tapped.open === 1 && health.nav.length === 0 && health.pill === "6 issues"
      && JSON.stringify(health.groups) === JSON.stringify(["Watchman", "Offline devices", "Low batteries"]), JSON.stringify([tapped, health]));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);

    if (width === 560) {
      await page.evaluate(() => window.setStates({ "input_select.house_mode": "Home" }));
      await page.waitForTimeout(600);
      await shot(page, `home-${theme}`, 0);
    }
    // the climate fan spins while a unit runs: stop it, then everything must settle
    await page.evaluate(() => window.setStates({ "climate.living_room_ac": { state: "off", attributes: { ...window.house.states["climate.living_room_ac"].attributes, hvac_action: "off" } } }));
    check(`${tag} springs idle`, await idle(page, 6000));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
