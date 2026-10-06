// savvy-entity-card: the glow and the icon take the entity's own colour, a card's `color` overrides it (names,
// variables and hex all work), and nothing falls back to blue.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 320 });
  const r = await page.evaluate(async () => {
    const h = window.hass, house = window.house, now = new Date().toISOString();
    house.states["light.rgb_lamp"] = { entity_id: "light.rgb_lamp", state: "on", attributes: { friendly_name: "Rgb lamp", rgb_color: [200, 40, 40], brightness: 200 }, last_changed: now, last_updated: now };
    window.hass = { ...h, states: { ...house.states } };
    const glowOf = (el) => { const c = el.shadowRoot.querySelector("ha-card"); return c.style.getPropertyValue("--glow-rgb").trim(); };
    const mk = (cfg) => window.mount("savvy-entity-card", cfg, 320);
    const cards = { lamp: mk({ entity: "light.rgb_lamp" }), plug: mk({ entity: "switch.living_room_plug" }), named: mk({ entity: "switch.living_room_plug", color: "red" }),
      hex: mk({ entity: "switch.living_room_plug", color: "#00ff00" }), sensor: mk({ entity: "sensor.living_room_temperature" }) };
    await new Promise((res) => setTimeout(res, 900));
    return Object.fromEntries(Object.entries(cards).map(([k, el]) => [k, glowOf(el)]));
  });
  const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const near = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 6);
  check("a light glows in its own colour", near(nums(r.lamp), [200, 40, 40]), r.lamp);
  check("a switch glows amber, not blue", nums(r.plug)[0] > 200 && nums(r.plug)[2] < 120, r.plug);
  check("a colour name on the card is honoured (it used to fall back to blue)", nums(r.named)[0] > 150 && nums(r.named)[2] < 100, r.named);
  check("a hex colour on the card wins", near(nums(r.hex), [0, 255, 0]), r.hex);
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
