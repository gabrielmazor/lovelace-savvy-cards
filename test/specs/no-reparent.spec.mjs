import { openPage } from "./_util.mjs";
// A state update moves nothing that is already in place: re-appending a row or tile under a finger cancels the scroll in progress.
export default async function ({ browser, base, check }) {
  const { page } = await openPage(browser, base, { theme: "dark", width: 420 });
  const moved = await page.evaluate(async () => {
    const patch = {};
    for (let i = 0; i < 10; i++) patch["sensor.gone_" + i] = { state: "unavailable", attributes: { friendly_name: "Gone " + i } };
    for (let i = 0; i < 10; i++) patch["sensor.batt_" + i] = { state: String(5 + i * 2), attributes: { device_class: "battery", friendly_name: "Battery " + i } };
    window.setStates(patch);
    window.mount("savvy-system-health-card", { source: "all" }, 420);
    window.mount("savvy-graph-card", { entities: ["sensor.living_room_temperature", "sensor.kitchen_temperature", "binary_sensor.living_room_door", "sensor.energy_cost"] }, 420);
    window.mount("savvy-entity-card", { entity: "person.alex", chips: [{ entity: "switch.living_room_lamp" }, { entity: "sensor.alex_phone_battery" }] }, 420);
    window.mount("savvy-room-activity-card", { area: "living_room" }, 420);
    window.mount("savvy-scene-card", { area: "living_room" }, 420);
    window.mount("savvy-settings-card", { pages: { lights: "/lovelace/lights" }, rooms: { living_room: { name: "Living" } } }, 420);
    await new Promise((r) => setTimeout(r, 900));
    const out = [];
    for (const c of window.cards) {
      let n = 0;
      const mo = new MutationObserver((l) => { n += l.reduce((a, m) => a + m.addedNodes.length + m.removedNodes.length, 0); });
      // the graph redraws its lines when a value changes; what matters is that no tile or row moves
      const roots = c.tagName === "SAVVY-GRAPH-CARD" ? [c.shadowRoot.getElementById("graphs"), c.shadowRoot.getElementById("grid")] : [c.shadowRoot];
      for (const r of roots) mo.observe(r, { childList: true, subtree: r === c.shadowRoot });
      await new Promise((r) => setTimeout(r, 100));
      n = 0;
      window.setStates({ "sensor.living_room_temperature": "23.4", "sensor.energy_cost": "9" });
      await new Promise((r) => setTimeout(r, 300));
      out.push([c.tagName.toLowerCase(), n]);
      mo.disconnect();
    }
    return out;
  });
  for (const [tag, n] of moved) check(`${tag}: a state update moves no nodes`, n === 0, `${n} nodes added/removed`);
}
