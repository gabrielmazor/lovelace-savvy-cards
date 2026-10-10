// The dashboard's design (the settings card's design.style) reaches every card, the camera, graph and settings
// cards included, and a card's own design still wins.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
  for (const style of ["glass", "matte"]) {
    const r = await page.evaluate(async (style) => {
      const S = window.__savvy.SettingsStore;
      S.settings = { design: { style } };
      const mk = (type, cfg) => { const el = window.mount(type, cfg, 420); return el; };
      const cards = [mk("savvy-camera-card", { area: "living_room" }), mk("savvy-graph-card", { entities: ["sensor.living_room_temperature"] }),
        mk("savvy-lights-card", { area: "living_room" }), mk("savvy-settings-card", { design: { style } })];
      for (const c of cards) c._onSettings?.();
      await new Promise((res) => setTimeout(res, 700));
      const out = cards.map((c) => [c.localName, !!c.shadowRoot?.querySelector("ha-card")?.hasAttribute(`data-${style}`)]);
      const own = mk("savvy-camera-card", { area: "living_room", design: "plain" });
      await new Promise((res) => setTimeout(res, 400));
      out.push(["own design wins", !own.shadowRoot.querySelector("ha-card").hasAttribute(`data-${style}`)]);
      S.settings = null;
      for (const c of [...cards, own]) c.remove();
      return out;
    }, style);
    for (const [name, ok] of r) check(`${style}: ${name}`, ok, JSON.stringify(r));
  }
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
