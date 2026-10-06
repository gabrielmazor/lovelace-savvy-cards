// The glass and matte designs: opt-in per card or by the settings card, plain by default, the same on every card;
// lit tiles carry their light; popups and menus follow their card; reduced transparency switches it off.
import { openPage } from "./_util.mjs";

const CARDS = [
  ["savvy-lights-card", { area: "living_room" }], ["savvy-lights-card", { area: "living_room", layout: "compact" }],
  ["savvy-people-card", {}], ["savvy-entity-card", { entity: "person.alex" }], ["savvy-media-card", { area: "living_room" }],
  ["savvy-climate-card", { area: "living_room" }], ["savvy-vacuum-card", { entity: "vacuum.robot" }], ["savvy-scene-card", { area: "living_room" }],
  ["savvy-lock-card", {}], ["savvy-graph-card", { entities: [{ entity: "sensor.living_room_temperature" }] }], ["savvy-camera-card", { area: "living_room" }],
  ["savvy-home-header-card", {}], ["savvy-room-header-card", { area: "living_room" }], ["savvy-system-health-card", {}], ["savvy-room-tile", { area: "living_room" }],
];

export default async function ({ browser, base, check }) {
  for (const style of ["glass", "matte"]) for (const theme of ["dark", "light"]) {
    const tag = `[${style} ${theme}]`;
    const { page, errors } = await openPage(browser, base, { theme, width: 420 });
    const r = await page.evaluate(async ({ CARDS, style }) => {
      const out = { glass: [], plain: [] };
      const surface = (el) => { const c = el.shadowRoot.querySelector("ha-card"); const cs = getComputedStyle(c); return { on: c.hasAttribute(`data-${style}`), blur: (cs.backdropFilter || cs.webkitBackdropFilter || "none") !== "none" }; };
      const els = CARDS.map(([t, cfg]) => [t, window.mount(t, { ...cfg, design: style }, 420), window.mount(t, cfg, 420)]);
      await new Promise((res) => setTimeout(res, 700));
      for (const [t, g, p] of els) { out.glass.push([t, surface(g)]); out.plain.push([t, surface(p)]); }
      // the settings card turns it on for every card without its own say
      const S = window.__savvy;
      out.fromSettings = S.resolveSettings("savvy-lights-card", { area: "living_room" }, { design: { style } }).config.design;
      out.cardWins = S.resolveSettings("savvy-lights-card", { area: "living_room", design: "plain" }, { design: { style } }).config.design;
      out.plainDefault = S.resolveSettings("savvy-lights-card", { area: "living_room" }, {}).config.design ?? null;
      // a lit light throws its colour into its own tile; an off one does not; brighter throws more
      const lights = els[0][1].shadowRoot.querySelectorAll(".light");
      out.lit = [...lights].map((n) => ({ light: n.hasAttribute("data-light"), on: Number(getComputedStyle(n).getPropertyValue("--on")) }));
      // popups follow their card
      const sheets = [els[0][1], els[0][2]].map((host) => { const sh = new S.Sheet(host, { title: "x" }); sh.open(); const on = sh.el.hasAttribute(`data-${style}`); sh.close(true); return on; });
      out.sheets = sheets;
      return out;
    }, { CARDS, style });
    const bad = (k, want) => r[k].filter(([, s]) => s.on !== want || (style === "glass" ? (want && !s.blur) || (!want && s.blur) : s.blur)).map(([t]) => t);
    check(`${tag} design: ${style} gives every card its surface (matte has no blur)`, bad("glass", true).length === 0, bad("glass", true).join(","));
    check(`${tag} without it nothing is frosted (plain is the default)`, bad("plain", false).length === 0, bad("plain", false).join(","));
    check(`${tag} the settings card turns glass on; a card's own design wins; unset stays plain`, r.fromSettings === style && r.cardWins === "plain" && r.plainDefault === null, JSON.stringify([r.fromSettings, r.cardWins, r.plainDefault]));
    const [ceiling, lamp, strip] = r.lit;
    check(`${tag} lit lights throw light by their brightness, an off one none`, ceiling.on > lamp.on && lamp.on > 0 && strip.on === 0, JSON.stringify(r.lit));
    check(`${tag} a popup is glass when its card is, plain otherwise`, r.sheets[0] === true && r.sheets[1] === false, JSON.stringify(r.sheets));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
