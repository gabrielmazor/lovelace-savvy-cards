// 0.9.1: a Watchman item that an offline device already explains is not a second problem (count by
// cause, "N dashboard references broken" on the device's row, Watchman's line says so), and known
// problems (`ignore`: devices and entities) leave every count and wait under "Known".
import { openPage, idle, centerOf } from "./_util.mjs";

const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];

// two dead devices (a sensor with two entities your dashboards use, a light with one), one missing entity
// with no device, one missing action; Watchman lists all of it
const SETUP = (W) => {
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  window.house.devices.dev_m_a = { id: "dev_m_a", name: "Kitchen Sensor", area_id: "kitchen", via_device_id: null, config_entries: [], primary_config_entry: null };
  window.house.devices.dev_m_b = { id: "dev_m_b", name: "Counter Light", area_id: "kitchen", via_device_id: null, config_entries: [], primary_config_entry: null };
  const patch = {};
  const ent = (id, device, name) => {
    window.house.entities[id] = { entity_id: id, area_id: null, device_id: device, platform: "mqtt", entity_category: null, hidden: false, disabled_by: null };
    patch[id] = { entity_id: id, state: "unavailable", attributes: { friendly_name: name }, last_changed: ago(3 * 3600000) };
  };
  ent("sensor.m_a_temp", "dev_m_a", "Kitchen Sensor Temperature");
  ent("sensor.m_a_hum", "dev_m_a", "Kitchen Sensor Humidity");
  ent("sensor.m_a_batt_x", "dev_m_a", "Kitchen Sensor Linkquality");
  ent("light.m_b_light", "dev_m_b", "Counter Light");
  ent("light.m_b_alt", "dev_m_b", "Counter Light Alt");
  window.setWatchman = (missing, actions = []) => window.setStates({
    "sensor.watchman_missing_entities": { entity_id: "sensor.watchman_missing_entities", state: String(missing.length),
      attributes: { friendly_name: "Watchman Missing Entities", entities: missing.map((id) => ({ id, state: "missing", occurrences: "/config/ui-lovelace.yaml:3" })) } },
    "sensor.watchman_missing_actions": { entity_id: "sensor.watchman_missing_actions", state: String(actions.length),
      attributes: { friendly_name: "Watchman Missing Actions", services: actions.map((id) => ({ id, state: "missing", occurrences: "/config/automations.yaml:9" })) } },
  });
  window.setStates(patch);
  window.setWatchman(["sensor.m_a_temp", "sensor.m_a_hum", "light.m_b_light", "sensor.ghost_gone"], ["script.old_script"]);
};

export default async function ({ browser, base, check }) {
  // ---------- the engine ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    await page.evaluate(SETUP, W);
    const r = await page.evaluate((W) => {
      const S = window.__savvy, h = () => window.hass;
      const sum = S.healthSummary(h(), { watchman: W });
      const dev = (s, id) => s.offline.find((i) => i.id === id);
      const out = { mixed: {
        explained: sum.watchmanExplained.map((x) => x.entity).sort(), left: sum.watchman.map((x) => x.entity).sort(),
        counts: [sum.counts.watchman, sum.counts.watchmanAll, sum.counts.watchmanExplained], kinds: sum.counts.watchmanKinds,
        refsA: dev(sum, "dev_m_a")?.refs, refsB: dev(sum, "dev_m_b")?.refs, by: sum.watchmanExplained.map((x) => x.explainedBy).sort(),
        total: sum.total, offlineCount: sum.counts.unavailable, battery: sum.counts.battery } };
      // the same house with Watchman off: only the offline part and the batteries
      const bare = S.healthSummary(h(), {});
      out.delta = sum.total - bare.total;                 // Watchman's contribution: only what nothing explains
      // everything explained
      window.setWatchman(["sensor.m_a_temp", "sensor.m_a_hum", "light.m_b_light"], []);
      const all = S.healthSummary(h(), { watchman: W });
      out.all = { left: all.counts.watchman, explained: all.counts.watchmanExplained, rows: all.watchman.length, total: all.total - bare.total };
      // a hub's devices: the references add up on the hub
      window.setWatchman(["sensor.m_a_temp", "sensor.m_a_hum", "light.m_b_light", "sensor.ghost_gone"], ["script.old_script"]);
      // group_by: none lists entities: the item sits on its entity
      const none = S.healthSummary(h(), { watchman: W, group_by: "none" });
      out.none = { explained: none.watchmanExplained.map((x) => x.entity).sort(), refs: none.offline.filter((i) => i.refs).map((i) => `${i.entity}:${i.refs}`).sort() };
      // known problems: a device, an entity; as an object, and as one list
      const known = S.healthSummary(h(), { watchman: W, ignore: { devices: ["dev_m_a"], entities: ["light.m_b_light"] } });
      out.known = { offline: known.offline.map((i) => i.id), knownDevices: known.known.devices.map((d) => d.id), knownEntities: known.known.entities.map((d) => d.id), knownCount: known.counts.known,
        refs: known.known.refs, left: known.watchman.map((x) => x.entity).sort(), total: known.total, devB: known.offline.find((i) => i.id === "dev_m_b")?.entities.map((e) => e.id).sort() };
      const flat = S.healthSummary(h(), { watchman: W, ignore: ["dev_m_a", "light.m_b_light"] });
      out.flat = JSON.stringify([flat.total, flat.counts.known]) === JSON.stringify([known.total, known.counts.known]);
      // a known device's low battery leaves the batteries
      window.setStates({ "sensor.m_a_battery": { entity_id: "sensor.m_a_battery", state: "5", attributes: { device_class: "battery", friendly_name: "Kitchen Sensor Battery", unit_of_measurement: "%" } } });
      window.house.entities["sensor.m_a_battery"] = { entity_id: "sensor.m_a_battery", area_id: null, device_id: "dev_m_a", platform: "mqtt", entity_category: null, hidden: false, disabled_by: null };
      window.setStates({ "sensor.m_a_battery": { entity_id: "sensor.m_a_battery", state: "5", attributes: { device_class: "battery", friendly_name: "Kitchen Sensor Battery", unit_of_measurement: "%" } } });
      const b0 = S.healthSummary(h(), {}), b1 = S.healthSummary(h(), { ignore: { devices: ["dev_m_a"] } });
      out.batt = [b0.counts.battery, b1.counts.battery];
      return out;
    }, W);
    const m = r.mixed;
    check("an offline device explains the Watchman items of its entities", JSON.stringify(m.explained) === JSON.stringify(["light.m_b_light", "sensor.m_a_hum", "sensor.m_a_temp"]) && JSON.stringify(m.left) === JSON.stringify(["script.old_script", "sensor.ghost_gone"]), JSON.stringify(m));
    check("what nothing explains stays: the missing entity with no device and the action", m.counts[0] === 2 && m.counts[1] === 5 && m.counts[2] === 3 && m.kinds.entities === 1 && m.kinds.actions === 1, JSON.stringify(m.counts) + JSON.stringify(m.kinds));
    check("the device rows carry the references: 2 on the sensor, 1 on the light, explained by their device", m.refsA === 2 && m.refsB === 1 && m.by.every((k) => /^d:dev_m_[ab]$/.test(k)), JSON.stringify([m.refsA, m.refsB, m.by]));
    check("counted by cause: Watchman adds only the 2 it alone knows about", r.delta === 2, String(r.delta));
    check("everything explained: Watchman adds nothing and lists nothing", r.all.left === 0 && r.all.explained === 3 && r.all.rows === 0 && r.all.total === 0, JSON.stringify(r.all));
    check("with group_by none the item sits on its entity", JSON.stringify(r.none.explained) === JSON.stringify(["light.m_b_light", "sensor.m_a_hum", "sensor.m_a_temp"]) && r.none.refs.length >= 3, JSON.stringify(r.none));
    const k = r.known;
    check("a known device and entity leave the offline issues and wait as Known", !k.offline.includes("dev_m_a") && k.knownDevices.join() === "dev_m_a" && k.knownEntities.join() === "light.m_b_light" && k.knownCount === 2 && k.devB.join() === "light.m_b_alt", JSON.stringify(k));
    check("their Watchman items go with them, counted on Known, and the total follows", k.refs === 3 && k.left.join() === "script.old_script,sensor.ghost_gone", JSON.stringify([k.refs, k.left]));
    check("ignore as one list works the same", r.flat === true);
    check("a known device's low battery leaves the batteries", r.batt[0] === r.batt[1] + 1, JSON.stringify(r.batt));
    check("health engine: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- the card ----------
  for (const theme of ["dark", "light"]) for (const width of [420, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP, W);
    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      const rows = [...R.querySelectorAll(".row")].map((n) => ({ n: n.querySelector(".n").textContent, s: n.querySelector(".s").textContent, key: n.__key }));
      const group = (t) => { const g = [...R.querySelectorAll(".group")].find((x) => x.querySelector(".gt").textContent === t); return g ? g.querySelector(".gw").textContent : null; };
      return { rows, pill: R.getElementById("pill").textContent, watchman: group("Watchman"), offline: group("Offline devices"),
        ok: [...R.querySelectorAll(".empty.ok")].map((n) => n.textContent.trim()) };
    }, i);
    const idx = await page.evaluate((W) => { const e = window.mount("savvy-system-health-card", { source: "all", watchman: W }, 420); return window.cards.indexOf(e); }, W);
    await page.waitForTimeout(900);
    const a = await read(idx);
    const rowA = a.rows.find((r) => r.n === "Kitchen Sensor"), rowB = a.rows.find((r) => r.n === "Counter Light");
    check(`${tag} the sensor's row says 2 dashboard references broken, the light's 1`, /2 dashboard references broken/.test(rowA?.s) && /1 dashboard reference broken/.test(rowB?.s), JSON.stringify([rowA, rowB]));
    check(`${tag} Watchman's line says what is its own and what the devices explain`, a.watchman === "1 missing entity, 1 missing action, 3 from offline devices", String(a.watchman));
    check(`${tag} Watchman lists only what nothing explains`, a.rows.filter((r) => /^(sensor\.|script\.|light\.)/.test(r.n)).map((r) => r.n).sort().join() === "script.old_script,sensor.ghost_gone", JSON.stringify(a.rows.map((r) => r.n)));
    // everything explained: the line says so, the tick says nothing else, no rows
    await page.evaluate(() => window.setWatchman(["sensor.m_a_temp", "sensor.m_a_hum", "light.m_b_light"], []));
    await page.waitForTimeout(700);
    const b = await read(idx);
    check(`${tag} all explained: "3 missing entities, all from offline devices", a tick and no Watchman rows`, b.watchman === "3 missing entities, all from offline devices" && b.ok.includes("Nothing else missing") && !b.rows.some((r) => /^(sensor\.|light\.)/.test(r.n)), JSON.stringify([b.watchman, b.ok, b.rows.map((r) => r.n)]));
    // the pill and the cog count the same, by cause
    const counts = await page.evaluate((W) => {
      const S = window.__savvy, sum = S.healthSummary(window.hass, { watchman: W });
      const e = window.mount("savvy-home-header-card", { health: { watchman: W }, weather: false }, 420);
      return { total: sum.total, i: window.cards.indexOf(e) };
    }, W);
    await page.waitForTimeout(500);
    const cog = await page.evaluate((i) => Number(window.cards[i].shadowRoot.getElementById("count").textContent), counts.i);
    check(`${tag} the cog counts what the card counts`, cog === counts.total && b.pill.startsWith(String(counts.total)), JSON.stringify([cog, counts.total, b.pill]));

    // known problems: one collapsed line, the device inside it
    const kn = await page.evaluate((W) => { const e = window.mount("savvy-system-health-card", { source: "all", watchman: W, ignore: { devices: ["dev_m_a"] } }, 420); return window.cards.indexOf(e); }, W);
    await page.waitForTimeout(900);
    const k0 = await read(kn);
    const known0 = k0.rows.find((r) => /^Known/.test(r.n));
    check(`${tag} a known device is not an issue: it waits in one collapsed "Known" line`, !!known0 && known0.n === "Known · 1" && /Snoozed/.test(known0.s) && !k0.rows.some((r) => r.n === "Kitchen Sensor"), JSON.stringify(k0.rows));
    await page.evaluate((i) => window.cards[i].shadowRoot.querySelector('.row[aria-expanded="false"]'), kn);
    const toggled = await page.evaluate(async (i) => {
      const R = window.cards[i].shadowRoot, row = [...R.querySelectorAll(".row")].find((n) => /^Known/.test(n.querySelector(".n").textContent));
      row.scrollIntoView({ block: "center" });
      const r = row.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, kn);
    await page.mouse.click(toggled.x, toggled.y);
    await page.waitForTimeout(700);
    const k1 = await read(kn);
    check(`${tag} opening it lists the known device, dim, and leaves the count alone`, k1.rows.some((r) => r.n === "Kitchen Sensor"), JSON.stringify(k1.rows.map((r) => r.n)));
    // the cog takes the same ignore list
    const cg = await page.evaluate((W) => { const e = window.mount("savvy-home-header-card", { health: { watchman: W, ignore: { devices: ["dev_m_a"] } }, weather: false }, 420);
      const base = window.__savvy.healthSummary(window.hass, { watchman: W, ignore: { devices: ["dev_m_a"] } }); return { i: window.cards.indexOf(e), total: base.total }; }, W);
    await page.waitForTimeout(500);
    check(`${tag} the cog honours the ignore list too`, (await page.evaluate((i) => Number(window.cards[i].shadowRoot.getElementById("count").textContent), cg.i)) === cg.total, String(cg.total));
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- the settings' known problems add to the card's own ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(() => {
      const S = window.__savvy;
      const settings = S.normalizeSettings({ health: { ignore: { devices: ["dev_m_b"], entities: ["sensor.x"] } } });
      const card = S.resolveSettings("savvy-system-health-card", { ignore: { devices: ["dev_m_a"] } }, settings).config;
      const home = S.resolveSettings("savvy-home-header-card", { health: { ignore: { devices: ["dev_m_a"] } } }, settings).config;
      const flat = S.resolveSettings("savvy-system-health-card", {}, S.normalizeSettings({ health: { ignore: ["dev_m_b", "sensor.y"] } })).config;
      return { card: card.ignore, home: home.health.ignore, flat: flat.ignore };
    });
    check("the settings' known problems add to the card's own", JSON.stringify(r.card?.devices?.slice().sort()) === JSON.stringify(["dev_m_a", "dev_m_b"]) && r.card.entities.join() === "sensor.x", JSON.stringify(r));
    check("...on the home header's health cog too, and a flat list in the settings splits by kind", JSON.stringify(r.home.devices.slice().sort()) === JSON.stringify(["dev_m_a", "dev_m_b"]) && r.flat.devices.join() === "dev_m_b" && r.flat.entities.join() === "sensor.y", JSON.stringify([r.home, r.flat]));
    check("settings: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
