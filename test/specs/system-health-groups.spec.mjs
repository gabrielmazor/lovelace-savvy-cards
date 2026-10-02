// The health engine's grouping (devices, hubs), and the health card's rows on a house with hubs.
import { openPage, idle, centerOf } from "./_util.mjs";

const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };

export default async function ({ browser, base, check }) {
  // ---------- the engine, on tiny houses ----------
  {
    const { page } = await openPage(browser, base, {});
    const r = await page.evaluate(() => {
      const S = window.__savvy;
      // devs: { id: via | [via, ownEntityState...] }; kids: [[device, state, n entities]]
      const house = (spec, extra = {}) => {
        const hass = { states: {}, entities: {}, devices: {}, areas: {} };
        for (const [id, d] of Object.entries(spec)) {
          hass.devices[id] = { id, name: d.name || id, via_device_id: d.via || null };
          (d.ents || []).forEach((st, i) => {
            const eid = `sensor.${id}_${i}`;
            hass.states[eid] = { entity_id: eid, state: st, attributes: { friendly_name: `${id} ${i}` }, last_changed: new Date(Date.now() - 3600000).toISOString() };
            hass.entities[eid] = { entity_id: eid, device_id: id, platform: d.platform || `p_${id}`, hidden: !!d.hidden?.[i] };
          });
        }
        return Object.assign(hass, extra);
      };
      const U = "unavailable", OK = "on";
      const kids = (n, via, state = U) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${via}${i}`, { via, ents: [state, state] }]));
      const sum = (h, cfg = {}) => S.healthSummary(h, cfg);
      const shape = (s) => s.offline.map((i) => `${i.kind}:${i.id}${i.state ? `:${i.state}` : ""}${i.devices ? `[${i.devices.length}]` : ""}`);
      const out = {};
      out.hub = shape(sum(house({ H: { ents: [U, U] }, ...kids(4, "H") })));
      out.small = shape(sum(house({ H: { ents: [U] }, ...kids(2, "H") })));
      out.min2 = shape(sum(house({ H: { ents: [U] }, ...kids(2, "H") }), { group_min: 2 }));
      out.coord = shape(sum(house({ C: { ents: [] }, ...kids(3, "C") })));
      out.coordSmall = shape(sum(house({ C: { ents: [] }, ...kids(2, "C") })));
      out.up = shape(sum(house({ H: { ents: [OK] }, ...kids(3, "H") })));
      out.upSome = shape(sum(house({ H: { ents: [OK] }, ...kids(3, "H"), x: { via: "H", ents: [OK] } })));
      out.chain = shape(sum(house({ A: { ents: [U] }, B: { via: "A", ents: [U] }, C: { via: "B", ents: [U] } }), { group_min: 2 }));
      out.chain3 = shape(sum(house({ A: { ents: [U] }, B: { via: "A", ents: [U] }, C: { via: "B", ents: [U] } })));
      out.chainUp = shape(sum(house({ A: { ents: [OK] }, B: { via: "A", ents: [U] }, C: { via: "B", ents: [U] } })));
      out.cycle = shape(sum(house({ A: { via: "B", ents: [U] }, B: { via: "A", ents: [U] } })));
      out.partial = shape(sum(house({ H: { ents: [U] }, ...kids(4, "H"), p: { via: "H", ents: [U, OK, OK] } })));
      out.deviceMode = shape(sum(house({ H: { ents: [U] }, ...kids(4, "H") }), { group_by: "device" }));
      out.noneMode = shape(sum(house({ H: { ents: [U] }, ...kids(4, "H") }), { group_by: "none" }));
      out.hidden = shape(sum(house({ d: { ents: [U, OK], hidden: [true, false] }, e: { ents: [U], hidden: [true] }, f: { ents: [U], platform: "mobile_app" } })));
      out.mixed = shape(sum(house({ H: { ents: [U] }, ...kids(3, "H") }), { group_min: 99 }));
      const hubSum = sum(house({ H: { ents: [U, U], name: "Bridge" }, ...kids(4, "H") }));
      out.hubTree = { name: hubSum.offline[0].name, own: hubSum.offline[0].entities.length, devs: hubSum.offline[0].devices.map((d) => d.entities.length), count: hubSum.counts.unavailable, total: hubSum.total, stats: hubSum.stats.devices };
      out.loose = shape(sum({ ...house({}), states: { "light.x": { entity_id: "light.x", state: U, attributes: {}, last_changed: "" } }, entities: {} }));
      return out;
    });
    check("engine: a down hub with enough devices behind it is one issue", JSON.stringify(r.hub) === JSON.stringify(["hub:H:offline[4]"]), JSON.stringify(r.hub));
    check("engine: below group_min the hub and its devices stay separate", r.small.length === 3 && r.small.every((x) => x.startsWith("device:")), JSON.stringify(r.small));
    check("engine: group_min is an option", JSON.stringify(r.min2) === JSON.stringify(["hub:H:offline[2]"]), JSON.stringify(r.min2));
    check("engine: a coordinator with no entities rolls up when all its devices are down", JSON.stringify(r.coord) === JSON.stringify(["hub:C:offline[3]"]), JSON.stringify(r.coord));
    check("engine: ...and shows only its devices when there are too few", r.coordSmall.length === 2 && r.coordSmall.every((x) => x.startsWith("device:")), JSON.stringify(r.coordSmall));
    check("engine: a hub that is up, with every device behind it down, says so", JSON.stringify(r.up) === JSON.stringify(["hub:H:behind[3]"]), JSON.stringify(r.up));
    check("engine: a hub that is up with some devices up never rolls up", r.upSome.length === 3 && r.upSome.every((x) => x.startsWith("device:")), JSON.stringify(r.upSome));
    check("engine: a chain rolls up to its top-most down hub", JSON.stringify(r.chain) === JSON.stringify(["hub:A:offline[2]"]) && r.chain3.length === 3, JSON.stringify([r.chain, r.chain3]));
    check("engine: a chain stops at an up hub", r.chainUp.length === 2 && r.chainUp.every((x) => x.startsWith("device:")), JSON.stringify(r.chainUp));
    check("engine: a cycle neither hangs nor loses a device", r.cycle.length === 2, JSON.stringify(r.cycle));
    check("engine: a device with a few entities unavailable folds into an offline hub with the rest, and counts once", JSON.stringify(r.partial) === JSON.stringify(["hub:H:offline[5]"]), JSON.stringify(r.partial));
    check("engine: group_by device keeps every device, none keeps every entity", r.deviceMode.length === 5 && r.noneMode.length === 9, JSON.stringify([r.deviceMode, r.noneMode]));
    check("engine: hidden entities and excluded platforms are never issues; a device is partial when only some entities are down",
      r.hidden.length === 0 || (r.hidden.length === 1 && r.hidden[0].startsWith("device:d")), JSON.stringify(r.hidden));
    check("engine: entities of a hub and its devices are kept for the rows", r.hubTree.own === 2 && JSON.stringify(r.hubTree.devs) === "[2,2,2,2]" && r.hubTree.count === 1 && r.hubTree.total === 1
      && r.hubTree.stats.total === 5 && r.hubTree.stats.down === 5, JSON.stringify(r.hubTree));
    check("engine: an entity with no device is its own issue", JSON.stringify(r.loose) === JSON.stringify(["entity:light.x"]), JSON.stringify(r.loose));
    check("engine: group_min above the number of devices rolls nothing", r.mixed.length === 4, JSON.stringify(r.mixed));
    await page.close();
  }

  // ---------- the card, on the made-up house with hubs ----------
  for (const theme of ["dark", "light"]) for (const width of [420, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const Z2M = ["dev_z2m_bridge", "dev_z2m_kitchen_motion", "dev_z2m_hall_door", "dev_z2m_bedroom_climate", "dev_z2m_office_plug", "dev_z2m_garage_leak"];
    const ZHA = ["dev_zha_hall_bulb", "dev_zha_porch_bulb", "dev_zha_stair_bulb"];
    const setup = await page.evaluate(async ({ width, W, Z2M, ZHA }) => {
      window.setStates(window.hubFixture(window.house, { down: [...Z2M, ...ZHA, "dev_solo"], downEntities: ["sensor.garage_multi_temperature", "sensor.garage_multi_pressure"] }));
      window.mount("savvy-system-health-card", { watchman: W, max_rows: 30 }, width);
      window.mount("savvy-system-health-card", { watchman: W, max_rows: 30, details: true }, width);
      window.mount("savvy-system-health-card", { source: "unavailable", max_rows: 30 }, width);
      window.mount("savvy-system-health-card", { source: "unavailable", group_by: "device", max_rows: 30 }, width);
      window.mount("savvy-system-health-card", { source: "unavailable", group_by: "none", max_rows: 60 }, width);
      window.mount("savvy-home-header-card", { health: { watchman: W } }, width);
      await new Promise((res) => setTimeout(res, 500));
      const sum = window.__savvy.healthSummary(window.hass, { watchman: W });
      const home = window.cards[5].shadowRoot;
      return { total: sum.total, offline: sum.counts.unavailable, stats: sum.stats, cog: home.getElementById("count").textContent, pill: window.cards[0].shadowRoot.getElementById("pill").textContent };
    }, { width, W, Z2M, ZHA });
    check(`${tag} the card's pill, the cog and the engine agree (hub, hub, device, partial, 2 entities, battery, Watchman)`,
      setup.total === 10 && setup.cog === "10" && setup.pill === "10 issues" && setup.offline === 6, JSON.stringify(setup));

    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return { pill: R.getElementById("pill").textContent, name: R.getElementById("name").textContent,
        groups: [...R.querySelectorAll(".group")].map((g) => `${g.querySelector(".gt").textContent} | ${g.querySelector(".gw").textContent}`),
        facts: [...R.querySelectorAll(".facts")].map((f) => f.textContent),
        rows: [...R.querySelectorAll(".row")].map((r) => ({ n: r.querySelector(".n").textContent, s: r.querySelector(".s").hidden ? "" : r.querySelector(".s").textContent, d: r.getAttribute("data-depth") || "0",
          x: r.getAttribute("aria-expanded"), soft: r.hasAttribute("data-soft") })) };
    }, i);
    const a = await read(0);
    check(`${tag} sections say what's wrong in words`, JSON.stringify(a.groups) === JSON.stringify(["Watchman | 2 missing entities, 1 missing action", "Offline devices | 4 devices and 2 entities offline", "Low batteries | 1 battery low"]), JSON.stringify(a.groups));
    const top = a.rows.filter((r) => r.d === "0");
    check(`${tag} offline: hubs first, then devices, then entities; each says how long`,
      JSON.stringify(top.slice(3, 9).map((r) => r.n)) === JSON.stringify(["ZHA Coordinator offline", "Zigbee2MQTT Bridge offline", "Garage Multisensor", "Washer Plug", "Garage Temperature", "Hallway Light"]), JSON.stringify(top.map((r) => r.n)));
    const byName = (rows, n) => rows.find((r) => r.n === n);
    check(`${tag} hub, device, partial and entity lines read right`,
      byName(top, "Zigbee2MQTT Bridge offline").s === "5 devices · offline for 3 h" && byName(top, "ZHA Coordinator offline").s === "3 devices · offline for 3 h"
      && byName(top, "Washer Plug").s === "offline for 3 h · 3 entities" && byName(top, "Garage Multisensor").s === "offline for 3 h · 2 of 4 entities" && !byName(top, "Garage Multisensor").soft
      && byName(top, "Hallway Light").s === "offline for 30 min · light.hallway_broken", JSON.stringify(top));
    check(`${tag} hubs and devices are collapsed buttons`, byName(top, "Zigbee2MQTT Bridge offline").x === "false" && byName(top, "Washer Plug").x === "false" && byName(top, "Hallway Light").x === null, JSON.stringify(top));

    // tap a hub: its own entities, then its devices; tap a device: its entities; tap an entity: more-info
    await page.evaluate(() => { window.moreInfo = []; window.nav = []; document.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId)); window.addEventListener("location-changed", () => window.nav.push(location.pathname)); });
    const rowCenter = (name, i = 0) => page.evaluate(({ name, i }) => {
      const r = [...window.cards[i].shadowRoot.querySelectorAll(".row")].find((x) => x.querySelector(".n").textContent === name);
      r.scrollIntoView({ block: "center" });
      const b = r.getBoundingClientRect();
      return { x: b.x + Math.min(40, b.width / 2), y: b.y + b.height / 2 };
    }, { name, i });
    await page.mouse.click(...Object.values(await rowCenter("Zigbee2MQTT Bridge offline")));
    await page.waitForTimeout(250);
    const b = await read(0);
    const kids = b.rows.filter((r) => r.d === "1").map((r) => r.n);
    check(`${tag} tapping a hub opens it: its own entities, then the devices behind it`, byName(b.rows, "Zigbee2MQTT Bridge offline").x === "true"
      && JSON.stringify(kids) === JSON.stringify(["Z2M Bridge Connection", "Z2M Bridge Version", "Bedroom Climate Sensor", "Garage Leak Sensor", "Hall Door Sensor", "Kitchen Motion Sensor", "Office Plug"]), JSON.stringify(kids));
    await page.mouse.click(...Object.values(await rowCenter("Hall Door Sensor")));
    await page.waitForTimeout(250);
    const c = await read(0);
    const hall = c.rows.filter((r) => r.d === "2").map((r) => r.n);
    check(`${tag} tapping a device opens its entities`, byName(c.rows, "Hall Door Sensor").x === "true" && hall.length === 3 && hall.every((n) => n.startsWith("Hall Door Sensor ")), JSON.stringify(hall));
    // a state update keeps what's open, and moves nothing
    const moved = await page.evaluate(async () => {
      const rows = window.cards[0].shadowRoot.querySelector(".rows");
      let n = 0;
      const mo = new MutationObserver((l) => { n += l.reduce((x, m) => x + m.addedNodes.length + m.removedNodes.length, 0); });
      mo.observe(rows, { childList: true });
      window.setStates({ "sensor.living_room_temperature": "24.4" });
      await new Promise((r) => setTimeout(r, 200));
      mo.disconnect();
      return n;
    });
    const d2 = await read(0);
    check(`${tag} what's open stays open across state updates, and nothing is moved`, byName(d2.rows, "Hall Door Sensor").x === "true" && d2.rows.filter((r) => r.d === "2").length === 3 && moved === 0, `${moved}`);
    await page.mouse.click(...Object.values(await rowCenter("Hall Door Sensor State")));
    await page.waitForTimeout(150);
    await hold(page, await rowCenter("Hall Door Sensor"));
    await page.waitForTimeout(200);
    const act = await page.evaluate(() => ({ info: window.moreInfo, nav: window.nav }));
    check(`${tag} tapping an entity opens its more-info; holding a device opens its page in Home Assistant`,
      act.info[0] === "sensor.hall_door_state" && act.nav.includes("/config/devices/device/dev_z2m_hall_door"), JSON.stringify(act));
    // keyboard: Enter and Space on a focused row
    const keys = await page.evaluate(async () => {
      const r = [...window.cards[0].shadowRoot.querySelectorAll(".row")].find((x) => x.querySelector(".n").textContent === "Washer Plug");
      r.focus(); r.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
      await new Promise((res) => setTimeout(res, 100));
      const open = r.getAttribute("aria-expanded");
      r.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true }));
      await new Promise((res) => setTimeout(res, 100));
      return [open, r.getAttribute("aria-expanded"), r.getAttribute("role"), r.tabIndex];
    });
    check(`${tag} keyboard: Enter and Space toggle a row`, keys.join() === "true,false,button,0", keys.join());
    // collapse the hub again
    await page.mouse.click(...Object.values(await rowCenter("Zigbee2MQTT Bridge offline")));
    await page.waitForTimeout(250);
    const e = await read(0);
    check(`${tag} collapsing hides what was under it`, !e.rows.some((r) => r.d !== "0") && byName(e.rows, "Zigbee2MQTT Bridge offline").x === "false", JSON.stringify(e.rows.map((r) => r.n)));

    // details: facts lines, area and integration on the rows
    const det = await read(1);
    const dtop = det.rows.filter((r) => r.d === "0");
    check(`${tag} details: a facts line under every section`, JSON.stringify(det.facts) === JSON.stringify(["Checked 2 h ago, 3 missing", `12 of 23 devices online`, "4 batteries, lowest 12%"]) && !a.facts.length, JSON.stringify([det.facts, a.facts]));
    check(`${tag} details: area and integration on the rows`, byName(dtop, "Zigbee2MQTT Bridge offline").s === "MQTT · 5 devices · offline for 3 h"
      && byName(dtop, "Washer Plug").s === "Bathroom · Shelly · offline for 3 h · 3 entities" && byName(dtop, "Garage Multisensor").s === "Hallway · MQTT · offline for 3 h · 2 of 4 entities", JSON.stringify(dtop));
    check(`${tag} the facts count devices the way the engine does`, setup.stats.devices.total === 23 && setup.stats.devices.down === 11, JSON.stringify(setup.stats));

    // single sources and group_by
    const one = await read(2), dev = await read(3), none = await read(4);
    check(`${tag} source offline: titled Offline devices, counted in what's offline`, one.name === "Offline devices" && one.pill === "6 offline" && one.rows.filter((r) => r.d === "0").length === 6, JSON.stringify([one.name, one.pill]));
    check(`${tag} group_by device: no hubs; none: one row per entity`, dev.pill === "13 offline" && !dev.rows.some((r) => /offline$/.test(r.n))
      && none.pill === "30 offline" && none.rows.every((r) => r.x === null), JSON.stringify([dev.pill, none.pill, none.rows.length]));

    // healthy house: everything back, Watchman clean
    await page.evaluate(() => {
      window.setStates({ ...window.hubFixture(window.house, { down: [] }), "light.hallway_broken": "off", "sensor.garage_temperature": "20", "sensor.front_door_battery": "80",
        "sensor.watchman_missing_entities": { state: "0", attributes: { friendly_name: "Watchman Missing Entities", entities: [] } },
        "sensor.watchman_missing_actions": { state: "0", attributes: { friendly_name: "Watchman Missing Actions", services: [] } } });
    });
    await page.waitForTimeout(300);
    const healthy = await page.evaluate(() => {
      const R = window.cards[0].shadowRoot;
      return { pill: R.getElementById("pill").textContent, ticks: [...R.querySelectorAll(".rows .ok")].map((x) => x.textContent.trim()), rows: R.querySelectorAll(".row").length,
        single: window.cards[2].shadowRoot.querySelector(".rows .ok")?.textContent.trim(), facts: [...window.cards[1].shadowRoot.querySelectorAll(".facts")].map((f) => f.textContent) };
    });
    check(`${tag} nothing wrong: All good, with a tick and what's fine under each title`, healthy.pill === "All good" && healthy.rows === 0
      && JSON.stringify(healthy.ticks) === JSON.stringify(["Nothing missing", "All devices online", "All batteries fine"]) && healthy.single === "All devices online", JSON.stringify(healthy));
    check(`${tag} nothing wrong, with details: the facts say so`, JSON.stringify(healthy.facts) === JSON.stringify(["Checked 2 h ago, nothing missing", "23 devices, all online", "9 batteries, lowest 55%"]), JSON.stringify(healthy.facts));

    check(`${tag} springs idle`, await idle(page));
    const real = errors.filter((x) => !/Failed to load resource/.test(x));
    check(`${tag} no errors`, real.length === 0, real.join(" | "));
    await page.close();
  }

  // ---------- the editor ----------
  {
    const { page } = await openPage(browser, base, {});
    const ed = await page.evaluate(async () => {
      const el = document.createElement("savvy-system-health-card-editor");
      document.body.appendChild(el);
      const changes = [];
      el.addEventListener("config-changed", (e) => { changes.push(e.detail.config); el.setConfig(e.detail.config); });
      el.setConfig({ type: "custom:savvy-system-health-card" });
      el.hass = window.hass;
      await new Promise((r) => setTimeout(r, 60));
      const fields = [...el.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
      const form = el.shadowRoot.querySelector("ha-form");
      form.set("details", true);
      form.set("group_by", "device");
      form.set("group_min", 4);
      form.set("columns", 2);
      return { fields, last: changes[changes.length - 1] };
    });
    check("editor: details, group_by, group_min and columns round-trip into the config", ["details", "group_by", "group_min", "columns"].every((f) => ed.fields.includes(f))
      && ed.last.details === true && ed.last.group_by === "device" && ed.last.group_min === 4 && ed.last.columns === 2, JSON.stringify(ed));
    const home = await page.evaluate(async () => {
      const el = document.createElement("savvy-home-header-card-editor");
      document.body.appendChild(el);
      el.setConfig({ type: "custom:savvy-home-header-card", health: {} });
      el.hass = window.hass;
      await new Promise((r) => setTimeout(r, 60));
      return [...el.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
    });
    check("editor: the home card's cog offers group_by and group_min", home.includes("group_by") && home.includes("group_min"), JSON.stringify(home));
    await page.close();
  }
}
