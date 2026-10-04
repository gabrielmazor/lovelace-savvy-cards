// One design language for every card (docs/DESIGN.md 5): a badge, the icon of a thing, is a circle of one of three
// sizes; a control is a rounded square of one of two; tints are the shared tokens; the state glow is a soft corner
// wash that is 0 when idle, switched off by `state_glow: false` or the Savvy settings, and never loud.
// Radii, sizes and token values only: nothing that depends on a machine's fonts.
import { openPage, idle } from "./_util.mjs";

const BADGE = [28, 36, 44];
const CONTROL = [32, 40];

// what each card calls its badges and its controls (selectors inside its shadow root)
const CARDS = [
  { name: "lights", type: "savvy-lights-card", cfg: { area: "living_room" }, badges: [".orb"], controls: [".swatch"], setup: () => window.setStates({ "light.living_room_ceiling": "on" }) },
  { name: "lights-compact", type: "savvy-lights-card", cfg: { area: "living_room", layout: "compact" }, badges: [".orb"], controls: [] },
  { name: "climate", type: "savvy-climate-card", cfg: { area: "living_room" }, badges: [], controls: [".power", ".step"] },
  { name: "media", type: "savvy-media-card", cfg: { area: "living_room" }, badges: [".row .icon"], controls: [".tb"] },
  { name: "entity", type: "savvy-entity-card", cfg: { entity: "light.living_room_ceiling" }, badges: [".av"], controls: [] },
  { name: "room-activity", type: "savvy-room-activity-card", cfg: { area: "living_room" }, badges: [".roomIcon", ".ev .disc"], controls: [] },
  { name: "scene", type: "savvy-scene-card", cfg: { area: "living_room" }, badges: [".tile .ic"], controls: [] },
  { name: "home-header", type: "savvy-home-header-card", cfg: { health: false, home_path: "/lovelace/home" }, badges: [".chip .disc"], controls: [".glyph", ".wx"] },
  { name: "lock", type: "savvy-lock-card", cfg: { entity: "lock.entrance_door", alarm: false, camera: false }, badges: [".disc"], controls: [], setup: () => window.setStates(window.entranceFixture(window.house, {})) },
  { name: "last-check", type: "savvy-last-check-card", cfg: { area: "living_room" }, badges: [".row .ic", ".slide .h"], controls: [".chk"] },
  { name: "people", type: "savvy-people-card", cfg: {}, badges: [".av"], controls: [] },
  { name: "cover", type: "savvy-cover-card", cfg: { area: "office" }, badges: [".sv-ic"], controls: [".ctl"],
    setup: () => { const h = window.hass, hs = window.house; for (const [id, st, a] of [["cover.dsn_blind", "open", { friendly_name: "Blind", device_class: "blind", current_position: 50, supported_features: 15 }], ["cover.dsn_curtain", "closed", { friendly_name: "Curtain", device_class: "curtain", supported_features: 15 }]]) { hs.states[id] = { entity_id: id, state: st, attributes: a, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() }; h.entities[id] = { entity_id: id, area_id: "office", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; } window.hass = { ...h, entities: { ...h.entities }, states: { ...hs.states } }; } },
  { name: "fan", type: "savvy-fan-card", cfg: { area: "office" }, badges: [".sv-ic"], controls: [".ctl"],
    setup: () => { const h = window.hass, hs = window.house; for (const [id, st, a] of [["fan.dsn_fan", "on", { friendly_name: "Fan", percentage: 40, supported_features: 1 }], ["fan.dsn_two", "off", { friendly_name: "Purifier", supported_features: 1 }]]) { hs.states[id] = { entity_id: id, state: st, attributes: a, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() }; h.entities[id] = { entity_id: id, area_id: "office", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; } window.hass = { ...h, entities: { ...h.entities }, states: { ...hs.states } }; } },
  { name: "settings", type: "savvy-settings-card", cfg: { pages: { lights: "/l" } }, badges: [".disc"], controls: [] },
];

const measure = (page, i, sel) => page.evaluate(({ i, sel }) => {
  const R = window.cards[i].shadowRoot;
  return [...R.querySelectorAll(sel)].filter((n) => n.getClientRects().length).map((n) => {
    const cs = getComputedStyle(n);
    return { w: Math.round(parseFloat(cs.width)), h: Math.round(parseFloat(cs.height)), r: cs.borderTopLeftRadius };
  });
}, { i, sel });

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    for (const [i, c] of CARDS.entries()) {
      await page.evaluate(({ type, cfg, setupSrc, width }) => { if (setupSrc) (0, eval)(`(${setupSrc})`)(); window.mount(type, cfg, width); },
        { type: c.type, cfg: c.cfg, setupSrc: c.setup ? c.setup.toString() : null, width });
      await page.waitForTimeout(500);
      for (const sel of c.badges) {
        const found = await measure(page, i, sel);
        check(`${tag} ${c.name}: ${sel} badges are circles of 28, 36 or 44`, found.length > 0 && found.every((m) => m.r === "50%" && m.w === m.h && BADGE.includes(m.w)), JSON.stringify(found.slice(0, 3)));
      }
      for (const sel of c.controls) {
        const found = await measure(page, i, sel);
        // a control is a rounded square (32 or 40 tall; the weather readout is a pill of the same height)
        check(`${tag} ${c.name}: ${sel} controls are rounded squares, 32 or 40`, found.length > 0 && found.every((m) => m.r !== "50%" && CONTROL.includes(m.h) && parseFloat(m.r) >= 10 && parseFloat(m.r) <= 14), JSON.stringify(found.slice(0, 3)));
      }
    }

    // the tokens themselves, on a card and in a popup
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(window.cards[0].shadowRoot.querySelector("ha-card"));
      return ["--b-s", "--b-m", "--b-l", "--c-s", "--c-l", "--mix-on", "--mix-alert", "--warn-rgb", "--bad-rgb", "--good-rgb"].map((k) => cs.getPropertyValue(k).trim());
    });
    check(`${tag} the design tokens are on every card`, JSON.stringify(tokens) === JSON.stringify(["28px", "36px", "44px", "32px", "40px", "16%", "18%", "232 163 61", "224 102 102", "76 175 80"]), JSON.stringify(tokens));

    // popups: row icons are badges, row buttons are controls, and the alert tone is the shared one
    await page.evaluate((width) => {
      window.mount("savvy-home-header-card", { health: false }, width);
      const c = window.cards.at(-1);
      c._showList("Lights on", window.__savvy.houseLights(window.hass).on, "#F5B83D", null, null, { sort: "room", toggle: true, storeKey: "design", bulk: "lights" });
    }, width);
    await page.waitForTimeout(700);
    const pop = await page.evaluate(() => {
      const root = window.__savvy.portalRoot();
      const m = (sel) => [...root.querySelectorAll(sel)].map((n) => { const cs = getComputedStyle(n); return { w: Math.round(parseFloat(cs.width)), h: Math.round(parseFloat(cs.height)), r: cs.borderTopLeftRadius }; });
      return { ic: m(".sv-ic"), bulk: m(".sv-bulk"), close: m(".sv-close") };
    });
    check(`${tag} popup row icons are circles of 36`, pop.ic.length > 0 && pop.ic.every((x) => x.r === "50%" && x.w === 36 && x.h === 36), JSON.stringify(pop.ic.slice(0, 2)));
    check(`${tag} popup buttons are rounded squares of 32`, [...pop.bulk, ...pop.close].length > 0 && [...pop.bulk, ...pop.close].every((x) => x.h === 32 && x.r === "11px"), JSON.stringify([pop.bulk, pop.close]));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- the state glow
  for (const theme of ["dark", "light"]) {
    const tag = `[${theme}] glow`;
    const { page, errors } = await openPage(browser, base, { theme, width: 520 });
    const glow = (i) => page.evaluate((i) => {
      const cs = getComputedStyle(window.cards[i].shadowRoot.querySelector("ha-card"));
      return { a: parseFloat(cs.getPropertyValue("--glow") || "0"), rgb: cs.getPropertyValue("--glow-rgb").trim(), before: getComputedStyle(window.cards[i].shadowRoot.querySelector("ha-card"), "::before").backgroundImage };
    }, i);
    await page.evaluate(() => {
      window.setStates({ "light.living_room_ceiling": "off", "light.living_room_floor_lamp": "off", "light.living_room_strip": "off" });
      window.mount("savvy-lights-card", { area: "living_room" }, 520);
      window.mount("savvy-lights-card", { area: "living_room", state_glow: false }, 520);
    });
    await page.waitForTimeout(600);
    const idleG = await glow(0);
    check(`${tag} idle: no glow (all lights off)`, idleG.a === 0, JSON.stringify(idleG));
    await page.evaluate(() => window.setStates({ "light.living_room_ceiling": "on", "light.living_room_floor_lamp": "on" }));
    // in between frames the glow grows; it never jumps
    const seen = new Set();
    for (let k = 0; k < 6; k++) { seen.add((await glow(0)).a.toFixed(2)); await page.waitForTimeout(30); }
    await page.waitForTimeout(700);
    const on = await glow(0), off = await glow(1);
    check(`${tag} lit: a glow in the light's colour, soft (0 to 1, never past 1)`, on.a > 0.4 && on.a <= 1 && /\d+ \d+ \d+/.test(on.rgb), JSON.stringify(on));
    check(`${tag} it grows through frames (springs), not in one step`, seen.size >= 2, [...seen].join(","));
    check(`${tag} the glow is a corner radial wash`, /radial-gradient/.test(on.before), on.before.slice(0, 80));
    check(`${tag} state_glow: false keeps the card plain`, off.a === 0, JSON.stringify(off));

    // the Savvy settings turn it off for every card; a card's own value wins
    await page.evaluate(() => {
      window.mount("savvy-settings-card", { design: { state_glow: false } }, 520);
      window.mount("savvy-lights-card", { area: "living_room" }, 520);
      window.mount("savvy-lights-card", { area: "living_room", state_glow: true }, 520);
    });
    await page.waitForTimeout(900);
    const n = await page.evaluate(() => window.cards.length);
    const viaSettings = await glow(n - 2), ownWins = await glow(n - 1);
    check(`${tag} design.state_glow: false in the settings turns it off`, viaSettings.a === 0, JSON.stringify(viaSettings));
    check(`${tag} the card's own state_glow: true wins over the settings`, ownWins.a > 0.4, JSON.stringify(ownWins));

    // reduced motion: the glow snaps
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.setStates({ "light.living_room_ceiling": "off", "light.living_room_floor_lamp": "off" }));
    await page.waitForTimeout(100);
    check(`${tag} reduced motion: the glow is gone at once`, (await glow(0)).a === 0);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
