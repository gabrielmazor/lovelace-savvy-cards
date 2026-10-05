// savvy-entity-card: a long name or a long state stays inside the card, whatever the width.
import { openPage, idle } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [360, 260, 180]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const h = window.hass, house = window.house;
      const long = "Now playing a very long track title by an artist with an extraordinarily long name, from the album of the year";
      house.states["sensor.long_text"] = { entity_id: "sensor.long_text", state: long, attributes: { friendly_name: "A sensor with a really remarkably long friendly name that goes on and on" }, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
      house.states["media_player.long_one"] = { entity_id: "media_player.long_one", state: "playing", attributes: { friendly_name: "Living Room Speaker With A Long Name", media_title: long }, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() };
      h.entities["sensor.long_text"] = { entity_id: "sensor.long_text", area_id: null, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
      window.hass = { ...h, states: { ...house.states } };
      window.mount("savvy-entity-card", { entity: "sensor.long_text", chips: [{ entity: "switch.living_room_plug", name: "A chip with a long name" }] }, width);
      window.mount("savvy-entity-card", { entity: "media_player.long_one" }, width);
      await new Promise((res) => setTimeout(res, 600));
      const out = [];
      for (const c of window.cards) {
        const R = c.shadowRoot, card = R.querySelector("ha-card").getBoundingClientRect();
        const over = [...R.querySelectorAll(".main, .txt, .name, .sub, .st, .since, .av")].filter((n) => n.getClientRects().length).map((n) => { const b = n.getBoundingClientRect(); return b.right - card.right; }).filter((d) => d > 0.5);
        out.push({ over, scroll: R.querySelector("ha-card").scrollWidth - R.querySelector("ha-card").clientWidth, st: R.getElementById("st").textContent.length });
      }
      return out;
    }, width);
    r.forEach((x, i) => check(`${tag} card ${i}: nothing leaves the card`, x.over.length === 0 && x.scroll <= 0, JSON.stringify(x)));
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
