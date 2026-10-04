// Room activity card: the alarm is opt-in (none by default, named, or `auto`), and a state that is on has its own
// colour whatever the alarm says: presence the accent, an open door or window and an unlocked lock amber, an
// escalation red, idle grey. `colored_states: false` keeps it grey; the soft wash follows the strongest state.
// Colours are classified by channel (computed through a canvas), never by exact values or text widths.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.house.areas.den = { area_id: "den", name: "Den" };
  const patch = {};
  const add = (id, state, attrs, mins = 5) => {
    window.house.entities[id] = { entity_id: id, area_id: "den", device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
    patch[id] = { entity_id: id, state, attributes: attrs, last_changed: ago(mins), last_updated: ago(mins) };
  };
  add("binary_sensor.den_presence", "on", { friendly_name: "Den Presence", device_class: "presence" }, 12);
  add("binary_sensor.den_door", "off", { friendly_name: "Den Door", device_class: "door" }, 40);
  add("binary_sensor.den_window", "off", { friendly_name: "Den Window", device_class: "window" }, 40);
  window.house.entities["alarm_control_panel.den_alarm"] = { entity_id: "alarm_control_panel.den_alarm", area_id: null, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  patch["alarm_control_panel.den_alarm"] = { entity_id: "alarm_control_panel.den_alarm", state: "disarmed", attributes: { friendly_name: "Den Alarm" }, last_changed: ago(90), last_updated: ago(90) };
  window.setStates(patch);
};

const KIND = (rgb) => {
  const [r, g, b] = rgb;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 28) return "grey";
  if (b > r + 40) return "blue";
  if (g - b > 50) return "amber";
  if (r > g + 55 && Math.abs(g - b) < 40) return "red";
  return `other:${rgb}`;
};

// what the page sees for the card at index i: a disc per event, the wash, the armed pill
const READ = (i) => {
  const R = window.cards[i].shadowRoot;
  const rgb = (css) => { const x = document.createElement("canvas").getContext("2d"); x.canvas.width = x.canvas.height = 1; x.fillStyle = "#000"; x.fillStyle = css; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const ev = (key) => [...R.querySelectorAll(".ev")].find((e) => e.textContent.toLowerCase().includes(key));
  const disc = (key) => { const e = ev(key); return e ? rgb(getComputedStyle(e.querySelector(".disc")).color) : null; };
  return { presence: disc("occupied") || disc("clear"), door: disc("door") || null, armed: R.getElementById("armed").hidden ? "" : R.getElementById("armedText").textContent,
    wash: Number(R.getElementById("wash").style.opacity || 0), level: R.getElementById("status").dataset.level || "",
    warn: [...R.querySelectorAll(".ev")].map((e) => Number(e.style.getPropertyValue("--warn") || 0)), count: R.querySelectorAll(".ev").length,
    discs: [...R.querySelectorAll(".ev")].map((e) => ({ t: e.textContent, c: rgb(getComputedStyle(e.querySelector(".disc")).color) })),
    glyphs: [...R.querySelectorAll(".gl")].map((g) => rgb(getComputedStyle(g).color)) };
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [460, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP);
    const ids = await page.evaluate((width) => {
      const m = (cfg) => window.cards.indexOf(window.mount("savvy-room-activity-card", cfg, width));
      return {
        def: m({ area: "den" }), named: m({ area: "den", alarm: "alarm_control_panel.den_alarm" }), auto: m({ area: "den", alarm: "auto" }),
        plain: m({ area: "den", colored_states: false }), noglow: m({ area: "den", state_glow: false }), compact: m({ area: "den", layout: "compact" }),
      };
    }, width);
    await page.waitForTimeout(900);
    const read = (i) => page.evaluate(READ, i);

    // ---- the alarm is opt-in
    await page.evaluate(() => window.setStates({ "alarm_control_panel.den_alarm": "armed_away" }));
    await page.waitForTimeout(700);
    check(`${tag} no alarm by default: no armed pill, though the house has an armed panel`, (await read(ids.def)).armed === "");
    check(`${tag} alarm named: the armed pill`, (await read(ids.named)).armed === "Away", (await read(ids.named)).armed);
    check(`${tag} alarm: auto finds the house's first panel`, (await read(ids.auto)).armed !== "");

    // ---- states carry their own colour
    await page.evaluate(() => window.setStates({ "alarm_control_panel.den_alarm": "disarmed" }));
    await page.waitForTimeout(700);
    const idle0 = await read(ids.def);
    check(`${tag} presence on is the accent colour`, KIND(idle0.presence) === "blue", JSON.stringify(idle0.presence));
    check(`${tag} a closed door stays grey`, KIND(idle0.door) === "grey", JSON.stringify(idle0.door));
    check(`${tag} presence washes the card softly, and nothing escalates`, idle0.wash > 0.2 && idle0.wash < 0.7 && idle0.warn.every((w) => w < 0.01), JSON.stringify([idle0.wash, idle0.warn]));
    await page.evaluate(() => window.setStates({ "binary_sensor.den_door": "on" }));
    await page.waitForTimeout(900);
    const open = await read(ids.def);
    check(`${tag} an open door is amber with no alarm, and the status says so`, KIND(open.door) === "amber" && open.level === "warn", JSON.stringify([open.door, open.level]));
    check(`${tag} the wash follows the strongest state (open stronger than presence)`, open.wash > idle0.wash, JSON.stringify([idle0.wash, open.wash]));
    const compact = await read(ids.compact);
    check(`${tag} compact glyphs carry the colours too`, compact.glyphs.some((c) => KIND(c) === "amber") && compact.glyphs.some((c) => KIND(c) === "blue"), JSON.stringify(compact.glyphs.map(KIND)));
    check(`${tag} an open door escalates nothing without an alarm`, open.warn.every((w) => w < 0.01), JSON.stringify(open.warn));

    // ---- with an alarm, armed: the open door escalates amber -> red
    await page.evaluate(() => window.setStates({ "alarm_control_panel.den_alarm": "armed_away" }));
    await page.waitForTimeout(900);
    const esc = await read(ids.named);
    check(`${tag} armed alarm named: the open door turns red`, esc.discs.some((d) => /Open/.test(d.t) && KIND(d.c) === "red") && esc.level === "alert", JSON.stringify(esc.discs.map((d) => [d.t, KIND(d.c)])));
    check(`${tag} the wash is stronger still when escalated`, esc.wash > open.wash, JSON.stringify([open.wash, esc.wash]));

    // ---- colored_states: false keeps it grey; the escalation (with an alarm) is amber as before
    const plain = await read(ids.plain);
    check(`${tag} colored_states: false: presence and the open door are grey`, KIND(plain.presence) === "grey" && KIND(plain.door) === "grey", JSON.stringify([plain.presence, plain.door]));
    check(`${tag} colored_states: false: no wash`, plain.wash < 0.01, String(plain.wash));
    await page.evaluate((w) => { window.mount("savvy-room-activity-card", { area: "den", colored_states: false, alarm: "alarm_control_panel.den_alarm" }, w); }, width);
    await page.waitForTimeout(900);
    const plainEsc = await read(window_last(await page.evaluate(() => window.cards.length)));
    check(`${tag} colored_states: false with an armed alarm: the escalation is amber`, plainEsc.discs.some((d) => /Open/.test(d.t) && KIND(d.c) === "amber"), JSON.stringify(plainEsc.discs.map((d) => [d.t, KIND(d.c)])));

    // ---- the wash can be switched off on its own
    const quiet = await read(ids.noglow);
    check(`${tag} state_glow: false: colours stay, the wash goes`, quiet.wash < 0.01 && KIND(quiet.door) === "amber", JSON.stringify([quiet.wash, quiet.door]));

    // ---- everything settles, and goes back to calm
    await page.evaluate(() => window.setStates({ "binary_sensor.den_door": "off", "binary_sensor.den_presence": "off", "alarm_control_panel.den_alarm": "disarmed" }));
    await page.waitForTimeout(1200);
    const calm = await read(ids.def);
    check(`${tag} idle again: grey, no wash`, KIND(calm.presence) === "grey" && calm.wash < 0.01, JSON.stringify([calm.presence, calm.wash]));
    check(`${tag} springs idle, no errors`, (await idle(page)) && errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // reduced motion: the colours and the wash snap, nothing is left moving
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(SETUP);
    await page.evaluate(() => window.mount("savvy-room-activity-card", { area: "den" }, 460));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.setStates({ "binary_sensor.den_door": "on" }));
    await page.waitForTimeout(60);
    const r = await page.evaluate(READ, 0);
    check("[reduced motion] the open door is amber at once, and the wash is in place", KIND(r.door) === "amber" && r.wash > 0.5, JSON.stringify([r.door, r.wash]));
    check("[reduced motion] springs idle, no errors", (await idle(page)) && errors.length === 0, errors.join(" | "));
    await page.close();
  }
}

const window_last = (n) => n - 1;
