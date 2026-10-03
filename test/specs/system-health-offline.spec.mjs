// 0.6.1: what counts as offline (half or more of a device's entities, a hub's connectivity sensor),
// hubs that fold in everything behind them, integration rows (failed config entries, or most of the
// devices offline), the Watchman run-report chip, and a lock that is always in the security popup.
import { openPage, idle, centerOf, uncalm } from "./_util.mjs";

const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };

export default async function ({ browser, base, check }) {
  // ---------- the engine, on tiny houses ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async () => {
      const S = window.__savvy;
      const U = "unavailable", OK = "on";
      // spec: { id: { via, ents: [states], platform, entry, conn: index of the connectivity entity, name } }
      const house = (spec) => {
        const hass = { states: {}, entities: {}, devices: {}, areas: {} };
        for (const [id, d] of Object.entries(spec)) {
          hass.devices[id] = { id, name: d.name || id, via_device_id: d.via || null, config_entries: d.entry ? [d.entry] : [], primary_config_entry: d.entry || null };
          (d.ents || []).forEach((st, i) => {
            const isConn = d.conn === i;
            const eid = `${isConn ? "binary_sensor" : "sensor"}.${id}_${i}`;
            hass.states[eid] = { entity_id: eid, state: st, attributes: { friendly_name: `${id} ${i}`, ...(isConn ? { device_class: "connectivity" } : {}) }, last_changed: new Date(Date.now() - 3600000).toISOString() };
            hass.entities[eid] = { entity_id: eid, device_id: id, platform: d.platform || `p_${id}` };
          });
        }
        return hass;
      };
      const kids = (n, via, ents, extra = {}) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { via, ents, ...extra }]));
      const sum = (h, cfg = {}) => S.healthSummary(h, cfg);
      const shape = (s) => s.offline.map((i) => `${i.kind}:${i.id}${i.state ? `:${i.state}` : ""}${i.devices ? `[${i.devices.length}]` : ""}`);
      let calls = 0;
      const entries = async (list, fail = false) => {
        S.resetConfigEntries();
        S.refreshConfigEntries({ callWS: async () => { calls++; if (fail) throw new Error("admin only"); return list; } }, true);
        await new Promise((res) => setTimeout(res, 40));
      };
      const out = {};

      await entries([]);
      // a bridge that stopped: three of four entities unavailable, the fourth its connectivity sensor reading off
      const real = sum(house({ H: { ents: [U, U, U, "off"], conn: 3 }, ...kids(5, "H", [U, U, OK]), p: { via: "H", ents: [U, OK, OK] } }));
      out.real = shape(real);
      out.realOwn = real.offline[0]?.entities.length;
      out.realCount = [real.counts.unavailable, real.total];
      // only its connectivity sensor says it: nothing of its own is unavailable
      const conn = sum(house({ H: { ents: [OK, OK, OK, "off"], conn: 3 }, ...kids(4, "H", [U, U, OK]) }));
      out.conn = shape(conn);
      out.connOwn = conn.offline[0]?.entities.map((e) => e.id);
      // a hub that is up, every device behind it offline, says so; one device up and nothing rolls up
      out.behind = shape(sum(house({ H: { ents: [OK, OK, "on"], conn: 2 }, ...kids(4, "H", [U, U, OK]) })));
      out.upSome = shape(sum(house({ H: { ents: [OK, OK, "on"], conn: 2 }, ...kids(3, "H", [U, U, OK]), x: { via: "H", ents: [OK, OK, OK] } })));
      // half or more of the entities is offline; fewer is partial
      out.majority = shape(sum(house({ a: { ents: [...Array(12).fill(U), OK, OK] }, b: { ents: [...Array(6).fill(U), ...Array(8).fill(OK)] }, c: { ents: [...Array(7).fill(U), ...Array(7).fill(OK)] } }), { group_by: "device" }));
      const dev = sum(house({ a: { ents: [...Array(12).fill(U), OK, OK] } }), { group_by: "device" }).offline[0];
      out.devCounts = [dev.down, dev.total, dev.state];
      // a coordinator with no entities: half of what is behind it offline
      out.coord = shape(sum(house({ C: { ents: [] }, ...Object.fromEntries([1, 2, 3].map((i) => [`o${i}`, { via: "C", ents: [U, U] }])), ...Object.fromEntries([1, 2, 3].map((i) => [`g${i}`, { via: "C", ents: [OK, OK] }])) })));
      out.coordFew = shape(sum(house({ C: { ents: [] }, ...Object.fromEntries([1, 2].map((i) => [`o${i}`, { via: "C", ents: [U, U] }])), ...Object.fromEntries([1, 2, 3, 4].map((i) => [`g${i}`, { via: "C", ents: [OK, OK] }])) })));

      // integrations: inferred from the devices
      const tuya = (n, off, extra = {}) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, { platform: "tuya", ents: i < off ? [U, U] : [OK, OK], ...extra }]));
      const inf = sum(house(tuya(5, 4)));
      out.inferred = shape(inf);
      out.inferredName = [inf.offline[0].name, inf.offline[0].label, inf.offline[0].total, inf.offline[0].domain];
      out.inferHalf = shape(sum(house(tuya(6, 3))));
      out.inferLess = shape(sum(house(tuya(6, 2)))).length;
      out.inferMin = shape(sum(house(tuya(6, 3)), { group_min: 4 })).length;
      out.inferDevice = shape(sum(house(tuya(5, 4)), { group_by: "device" })).length;
      out.inferNone = shape(sum(house(tuya(5, 4)), { group_by: "none" })).length;
      // ...and from Home Assistant's own word about the config entry
      await entries([
        { entry_id: "E1", domain: "tuya", title: "Tuya", state: "setup_retry", disabled_by: null },
        { entry_id: "E2", domain: "nest", title: "Nest", state: "setup_error", disabled_by: null },
        { entry_id: "E3", domain: "mobile_app", title: "Phone", state: "setup_error", disabled_by: null },
        { entry_id: "E4", domain: "hue", title: "Hue", state: "setup_in_progress", disabled_by: null },
        { entry_id: "E5", domain: "ring", title: "Ring", state: "loaded", disabled_by: null },
        { entry_id: "E6", domain: "demo", title: "Demo", state: "setup_error", disabled_by: "user" },
        { entry_id: "E7", domain: "mqtt", title: "MQTT", state: "not_loaded", disabled_by: null },
      ]);
      const failed = sum(house(Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`t${i}`, { platform: "tuya", entry: "E1", ents: i < 2 ? [U, U] : [OK, OK] }]))));
      out.failed = shape(failed);
      out.failedNames = failed.offline.map((i) => `${i.name}|${i.label}|${i.total}`);
      out.failedCount = failed.counts.unavailable;
      // a failed entry with a hub of its own: the hub goes inside it
      await entries([{ entry_id: "E8", domain: "mqtt", title: "MQTT", state: "setup_retry", disabled_by: null }]);
      const inside = sum(house({ H: { entry: "E8", ents: [U, U] }, ...kids(4, "H", [U, U], { entry: "E8" }) }));
      out.inside = shape(inside);
      out.insideKid = inside.offline[0].devices.map((d) => `${d.kind}:${d.id}[${d.devices?.length}]`);
      // a hub is blamed before its integration, which only sees what no hub explains
      await entries([{ entry_id: "E9", domain: "mqtt", title: "MQTT", state: "loaded", disabled_by: null }]);
      out.hubFirst = shape(sum(house({ H: { entry: "E9", platform: "mqtt", ents: [U, U] }, ...kids(5, "H", [U, U], { entry: "E9", platform: "mqtt" }), x: { entry: "E9", platform: "mqtt", ents: [U, U] }, y: { entry: "E9", platform: "mqtt", ents: [U, U] } })));
      // the entry list is only asked for once in a while, and a refusal is silent
      calls = 0;
      await entries([{ entry_id: "E1", domain: "tuya", title: "Tuya", state: "setup_retry", disabled_by: null }], true);
      const asked = calls;
      S.refreshConfigEntries({ callWS: async () => { calls++; return []; } });
      S.refreshConfigEntries({ callWS: async () => { calls++; return []; } });
      await new Promise((res) => setTimeout(res, 40));
      out.refused = { asked, after: calls, stillInferred: shape(sum(house(tuya(5, 4)))) };
      // Watchman's counts, by what they count
      const wm = house({});
      wm.states["sensor.wm_e"] = { entity_id: "sensor.wm_e", state: "2", attributes: { entities: [{ id: "light.a" }, { id: "light.b" }] } };
      wm.states["sensor.wm_a"] = { entity_id: "sensor.wm_a", state: "1", attributes: { services: [{ id: "script.x" }] } };
      wm.states["sensor.wm_other_actions"] = { entity_id: "sensor.wm_other_actions", state: "3", attributes: {} };
      out.watchman = sum(wm, { watchman: ["sensor.wm_e", "sensor.wm_a", "sensor.wm_other_actions"] }).counts.watchmanKinds;
      S.resetConfigEntries();
      return out;
    });
    check("engine: a bridge with three of four entities unavailable and its connectivity sensor off is one hub, with the partial device inside", JSON.stringify(r.real) === JSON.stringify(["hub:H:offline[6]"]) && r.realOwn === 4 && r.realCount.join() === "1,1", JSON.stringify(r));
    check("engine: a hub is offline when only its connectivity sensor says so", JSON.stringify(r.conn) === JSON.stringify(["hub:H:offline[4]"]) && JSON.stringify(r.connOwn) === JSON.stringify(["binary_sensor.H_3"]), JSON.stringify([r.conn, r.connOwn]));
    check("engine: a hub that is up rolls up only when every device behind it is offline", JSON.stringify(r.behind) === JSON.stringify(["hub:H:behind[4]"]) && r.upSome.length === 3 && r.upSome.every((x) => x.startsWith("device:")), JSON.stringify([r.behind, r.upSome]));
    check("engine: a device is offline at half or more of its entities, partial below", JSON.stringify(r.majority) === JSON.stringify(["device:a:down", "device:c:down", "device:b:partial"]) && r.devCounts.join() === "12,14,down", JSON.stringify([r.majority, r.devCounts]));
    check("engine: a coordinator with no entities rolls up when half of what is behind it is offline", JSON.stringify(r.coord) === JSON.stringify(["hub:C:offline[3]"]) && r.coordFew.length === 2 && r.coordFew.every((x) => x.startsWith("device:")), JSON.stringify([r.coord, r.coordFew]));
    check("engine: an integration whose devices are mostly offline is one issue", JSON.stringify(r.inferred) === JSON.stringify(["integration:p:tuya:offline[4]"]) && r.inferredName.join("|") === "Tuya||4|tuya", JSON.stringify([r.inferred, r.inferredName]));
    check("engine: half offline counts, fewer does not; group_min applies", JSON.stringify(r.inferHalf) === JSON.stringify(["integration:p:tuya:offline[3]"]) && r.inferLess === 2 && r.inferMin === 3, JSON.stringify([r.inferHalf, r.inferLess, r.inferMin]));
    check("engine: group_by device keeps devices, none keeps entities: no integration rows", r.inferDevice === 4 && r.inferNone === 8, JSON.stringify([r.inferDevice, r.inferNone]));
    check("engine: a failed or retrying config entry is an issue; others (starting, loaded, disabled, a phone) are not", JSON.stringify(r.failed) === JSON.stringify(["integration:e:E2:failed[0]", "integration:e:E1:failed[2]"])
      && JSON.stringify(r.failedNames) === JSON.stringify(["Nest|failed to set up|0", "Tuya|retrying setup|2"]) && r.failedCount === 2, JSON.stringify([r.failed, r.failedNames]));
    check("engine: a hub of a failed integration sits inside it", JSON.stringify(r.inside) === JSON.stringify(["integration:e:E8:failed[1]"]) && JSON.stringify(r.insideKid) === JSON.stringify(["hub:H[4]"]), JSON.stringify([r.inside, r.insideKid]));
    check("engine: a hub is blamed before its integration, which sees only what no hub explains", JSON.stringify(r.hubFirst) === JSON.stringify(["hub:H:offline[5]", "device:x:down", "device:y:down"]), JSON.stringify(r.hubFirst));
    check("engine: the config entries are asked once; a refusal is silent and the integrations are inferred anyway", r.refused.asked === 1 && r.refused.after === 1 && JSON.stringify(r.refused.stillInferred) === JSON.stringify(["integration:p:tuya:offline[4]"]), JSON.stringify(r.refused));
    check("engine: Watchman's count splits into entities and actions", r.watchman.entities === 2 && r.watchman.actions === 4, JSON.stringify(r.watchman));
    check("engine: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- the card, on a house where things stopped ----------
  for (const theme of ["dark", "light"]) for (const width of [420, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(async ({ width, W }) => {
      const f = window.offlineFixture(window.house, { z2m: true, washer: true, tuya: true, coord: true, tuyaState: "setup_retry", nestState: "setup_error" });
      window.entriesList = f.entries;
      window.hass.callWS = async (m) => { if (m.type === "config_entries/get") return window.entriesList; throw new Error(`unexpected ${m.type}`); };
      window.hass.services = { watchman: { report: {} } };
      window.setStates(f.patch);
      window.nav = []; window.moreInfo = [];
      window.addEventListener("location-changed", () => window.nav.push(location.pathname));
      document.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId));
      window.mount("savvy-system-health-card", { source: "unavailable", max_rows: 40 }, width);                       // 0
      window.mount("savvy-system-health-card", { watchman: W, max_rows: 40 }, width);                                  // 1
      window.mount("savvy-system-health-card", { source: "watchman", watchman: W }, width);                            // 2
      window.mount("savvy-system-health-card", { watchman: W, watchman_button: false }, width);                        // 3
      window.mount("savvy-system-health-card", { watchman: W, watchman_report: { parse_config: false, create_file: true } }, width); // 4
      window.mount("savvy-system-health-card", { source: "offline", max_rows: 40 }, width);                            // 5
      window.mount("savvy-home-header-card", { health: { watchman: W } }, width);                                      // 6
      await new Promise((res) => setTimeout(res, 500));
    }, { width, W });

    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return { pill: R.getElementById("pill").textContent, name: R.getElementById("name").textContent,
        groups: [...R.querySelectorAll(".group")].map((g) => `${g.querySelector(".gt").textContent} | ${g.querySelector(".gw").textContent}`),
        rows: [...R.querySelectorAll(".row")].map((r) => ({ n: r.querySelector(".n").textContent, s: r.querySelector(".s").hidden ? "" : r.querySelector(".s").textContent, d: r.getAttribute("data-depth") || "0", x: r.getAttribute("aria-expanded") })) };
    }, i);
    const byName = (rows, n) => rows.find((r) => r.n === n);
    const seeCard = (i) => page.evaluate((i) => window.cards[i].scrollIntoView({ block: "center" }), i);
    const rowCenter = (name, i = 0) => page.evaluate(({ name, i }) => {
      const r = [...window.cards[i].shadowRoot.querySelectorAll(".row")].find((x) => x.querySelector(".n").textContent === name);
      r.scrollIntoView({ block: "center" });
      const b = r.getBoundingClientRect();
      return { x: b.x + Math.min(40, b.width / 2), y: b.y + b.height / 2 };
    }, { name, i });

    const a = await read(0);
    const top = a.rows.filter((r) => r.d === "0");
    check(`${tag} offline: integrations first, then hubs, devices, entities`, JSON.stringify(top.map((r) => r.n)) === JSON.stringify(["Nest", "Tuya", "Z2M Bridge offline", "ZHA Hub offline", "Washing Machine", "Garage Temperature", "Hallway Light"]), JSON.stringify(top.map((r) => r.n)));
    check(`${tag} integration, hub and device lines read right`, byName(top, "Nest").s === "failed to set up" && byName(top, "Tuya").s === "retrying setup · 3 devices"
      && byName(top, "Z2M Bridge offline").s === "6 devices · offline for 3 h" && byName(top, "ZHA Hub offline").s === "3 devices · offline for 3 h"
      && byName(top, "Washing Machine").s === "offline for 3 h · 12 of 14 entities", JSON.stringify(top));
    check(`${tag} the section says it in words, and the pill counts every top-level row once`, a.groups.length === 0 && a.pill === "7 offline" && a.name === "Offline devices", JSON.stringify([a.pill, a.name, a.groups]));
    const all = await read(1);
    check(`${tag} Offline devices line: integrations, devices and entities, zero kinds dropped`, all.groups.includes("Offline devices | 2 integrations, 3 devices and 2 entities offline"), JSON.stringify(all.groups));
    check(`${tag} source: offline is the same as unavailable`, (await read(5)).pill === "7 offline" && (await read(5)).name === "Offline devices");

    // expand an integration, a hub; the connectivity sensor is among the bridge's own entities
    await page.mouse.click(...Object.values(await rowCenter("Tuya")));
    await page.waitForTimeout(250);
    const b = await read(0);
    check(`${tag} tapping an integration opens the devices under it; one with none is not a button`, JSON.stringify(b.rows.filter((r) => r.d === "1").map((r) => r.n)) === JSON.stringify(["Tuya Plug 1", "Tuya Plug 2", "Tuya Plug 3"])
      && byName(b.rows, "Tuya").x === "true" && byName(b.rows, "Nest").x === null, JSON.stringify(b.rows.map((r) => `${r.d}:${r.n}`)));
    await page.mouse.click(...Object.values(await rowCenter("Z2M Bridge offline")));
    await page.waitForTimeout(250);
    const c = await read(0);
    const bridge = c.rows.filter((r) => r.d === "1" && /^Z2M Bridge /.test(r.n)).map((r) => r.n);
    check(`${tag} the bridge opens to its own entities (the connectivity sensor too) and the six devices`, JSON.stringify(bridge) === JSON.stringify(["Z2M Bridge Clients", "Z2M Bridge Connection", "Z2M Bridge Uptime", "Z2M Bridge Version"])
      && c.rows.filter((r) => r.d === "1" && /^Z2M Sensor /.test(r.n)).length === 6, JSON.stringify(c.rows.map((r) => `${r.d}:${r.n}`)));
    check(`${tag} a partial device sits inside the hub, softly`, byName(c.rows, "Z2M Sensor 6")?.s.includes("1 of 3 entities unavailable") ?? false, JSON.stringify(byName(c.rows, "Z2M Sensor 6")));
    // a tap on an integration with no devices goes to its page; hold a device for its page
    await page.evaluate(() => { window.nav.length = 0; });
    await page.mouse.click(...Object.values(await rowCenter("Nest")));
    await page.waitForTimeout(250);
    await hold(page, await rowCenter("Washing Machine"));
    await page.waitForTimeout(250);
    const nav = await page.evaluate(() => [...window.nav]);
    check(`${tag} an integration with no devices opens its page; a device's hold opens its device page`, nav[0] === "/config/integrations/integration/nest" && nav.includes("/config/devices/device/dev_n_washer"), JSON.stringify(nav));
    // the cog and the card agree
    const sum = await page.evaluate((W) => window.__savvy.healthSummary(window.hass, { watchman: W }), W);
    const cog = await page.evaluate(() => window.cards[6].shadowRoot.getElementById("count").textContent);
    check(`${tag} the cog counts the same issues, failed integrations included`, cog === String(sum.total) && sum.counts.unavailable === 7, JSON.stringify([cog, sum.total, sum.counts.unavailable]));

    // ----- the Watchman chip -----   (its Running... lasts as long as the fake says: read the clock plainly)
    uncalm(page);
    const chip = (i) => page.evaluate((i) => {
      const c = window.cards[i].shadowRoot.querySelector(".report");
      if (!c || c.hidden) return null;
      return { text: c.querySelector("span").textContent, inGroup: !!c.closest(".group"), inHead: !!c.closest(".head"), busy: c.getAttribute("aria-busy"), flash: c.hasAttribute("data-flash"),
        icon: c.querySelector("ha-icon").getAttribute("icon"), turn: c.querySelector("ha-icon").style.transform, label: c.getAttribute("aria-label") };
    }, i);
    const c1 = await chip(1), c2 = await chip(2);
    check(`${tag} the Run report chip sits in the Watchman section's header (source all) or the card's head (source watchman)`, c1?.text === "Run report" && c1.inGroup && c2?.text === "Run report" && c2.inHead && !c2.inGroup, JSON.stringify([c1, c2]));
    check(`${tag} watchman_button: false hides it`, (await chip(3)) === null && (await chip(0)) === null);
    await page.evaluate(() => { delete window.hass.services.watchman; window.setStates({}); });
    await page.waitForTimeout(100);
    check(`${tag} without the Watchman service the chip is hidden`, (await chip(1)) === null && (await chip(2)) === null);
    await page.evaluate(() => { window.hass.services = { watchman: { report: {} } }; window.setStates({}); });
    await page.waitForTimeout(100);
    // run: the call, the running state, the spinner, done when the last-parse time changes
    await page.evaluate(() => { window.log.length = 0; const st = window.setTimeout; window.setTimeout = (fn, ms, ...x) => st(fn, ms >= 60000 ? 500 : ms, ...x); });
    await seeCard(1);
    await page.mouse.click(...Object.values(await centerOf(page, 1, ".report")));
    await page.waitForTimeout(250);
    const run = await chip(1);
    const call = await page.evaluate(() => [...window.log]);
    check(`${tag} a tap calls watchman.report with parse_config on`, call.length === 1 && call[0] === 'watchman.report {"parse_config":true} -', JSON.stringify(call));
    check(`${tag} it shows Running… with a turning spinner`, run.text === "Running…" && run.busy === "true" && run.icon === "mdi:loading" && /rotate/.test(run.turn), JSON.stringify(run));
    await page.mouse.click(...Object.values(await centerOf(page, 1, ".report")));
    await page.waitForTimeout(100);
    check(`${tag} a second tap while it runs does nothing`, (await page.evaluate(() => window.log.length)) === 1);
    await page.evaluate(() => window.setStates({ "sensor.watchman_last_parse": new Date().toISOString() }));
    await page.waitForTimeout(150);
    const done = await chip(1);
    check(`${tag} it says Done when Watchman's last-parse time changes`, done.text === "Done" && done.flash && done.icon === "mdi:check" && done.busy === "false", JSON.stringify(done));
    await page.waitForTimeout(2800);
    check(`${tag} ...then goes back to Run report`, (await chip(1)).text === "Run report");
    // a report that never answers stops by itself
    await page.mouse.click(...Object.values(await centerOf(page, 1, ".report")));
    await page.waitForTimeout(200);
    const running = (await chip(1)).text;
    await page.waitForTimeout(700);
    check(`${tag} a report that never answers stops running after the timeout`, running === "Running…" && (await chip(1)).text === "Run report");
    // the data can be set
    await page.evaluate(() => { window.log.length = 0; });
    await seeCard(4);
    await page.mouse.click(...Object.values(await centerOf(page, 4, ".report")));
    await page.waitForTimeout(150);
    const logged = await page.evaluate(() => [...window.log]);
    check(`${tag} watchman_report sets the service data`, logged[0] === 'watchman.report {"parse_config":false,"create_file":true} -', JSON.stringify(logged));
    // the cog's popup carries the chip
    await seeCard(6);
    await hold(page, await centerOf(page, 6, "#health"));
    await page.waitForTimeout(600);
    const inPopup = await page.evaluate(() => {
      const card = window.__savvy.portalRoot().querySelector("savvy-system-health-card");
      if (!card) return { chip: false, title: [], open: window.__savvy.portalRoot().querySelectorAll(".sv-sheet").length };
      const c = card.shadowRoot.querySelector(".report");
      return { chip: !!c && !c.hidden, title: [...card.shadowRoot.querySelectorAll(".group .gt")].map((g) => g.textContent) };
    });
    check(`${tag} the cog's popup has the chip too, under the new section titles`, inPopup.chip && inPopup.title.join() === "Watchman,Offline devices,Low batteries", JSON.stringify(inPopup));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);

    check(`${tag} springs idle`, await idle(page));
    const real = errors.filter((x) => !/Failed to load resource/.test(x));
    check(`${tag} no errors`, real.length === 0, real.join(" | "));
    await page.close();
  }

  // ---------- the copy, state by state ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    const lines = await page.evaluate(async () => {
      const f = window.offlineFixture(window.house);
      window.entriesList = f.entries.filter((e) => e.domain !== "nest");
      window.hass.callWS = async (m) => { if (m.type === "config_entries/get") return window.entriesList; throw new Error("unexpected"); };
      window.hubFixture(window.house, { down: [] });
      // a healthy house first: everything the base house has broken is mended
      const mend = { ...window.hubFixture(window.house, { down: [] }), ...f.patch, "light.hallway_broken": "off", "sensor.garage_temperature": "20", "sensor.front_door_battery": "80" };
      window.setStates(mend);
      window.mount("savvy-system-health-card", { max_rows: 40 }, 420);
      window.mount("savvy-system-health-card", { max_rows: 40, details: true }, 420);
      await new Promise((res) => setTimeout(res, 300));
      const read = () => {
        const R = window.cards[0].shadowRoot;
        return { offline: [...R.querySelectorAll(".group")].map((g) => `${g.querySelector(".gt").textContent} | ${g.querySelector(".gw").textContent}`)[0] ?? null,
          ticks: [...R.querySelectorAll(".rows .ok")].map((x) => x.textContent.trim()), pill: R.getElementById("pill").textContent,
          facts: [...window.cards[1].shadowRoot.querySelectorAll(".facts")].map((x) => x.textContent), rows: [...R.querySelectorAll(".row")].map((r) => `${r.querySelector(".n").textContent}|${r.querySelector(".s").textContent}|${r.hasAttribute("data-soft")}`) };
      };
      const step = async (patch) => { window.setStates(patch); await new Promise((res) => setTimeout(res, 150)); return read(); };
      const out = { healthy: read() };
      out.partial = await step({ "sensor.n_k1_a": "unavailable" });
      out.washer = await step({ ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`sensor.n_washer_${i}`, "unavailable"])) });
      out.loose = await step({ "light.hallway_broken": "unavailable" });
      window.entriesList = window.entriesList.map((e) => (e.domain === "tuya" ? { ...e, state: "setup_retry" } : e));
      window.__savvy.refreshConfigEntries(window.hass, true);
      await new Promise((res) => setTimeout(res, 100));
      out.integration = await step({});
      window.__savvy.resetConfigEntries();
      return out;
    });
    check("copy: nothing wrong says so under every title", lines.healthy.pill === "All good" && JSON.stringify(lines.healthy.ticks) === JSON.stringify(["All devices online", "All batteries fine"]) && lines.healthy.offline === "Offline devices | ", JSON.stringify(lines.healthy));
    check("copy: one partly offline device", lines.partial.offline === "Offline devices | 1 partly offline" && lines.partial.rows.some((r) => r.startsWith("Z2M Sensor 1|") && r.includes("1 of 3 entities unavailable") && r.endsWith("|true")), JSON.stringify(lines.partial));
    check("copy: a device and a partly offline one", lines.washer.offline === "Offline devices | 1 device offline, 1 partly offline", JSON.stringify(lines.washer));
    check("copy: a device, an entity and a partly offline one", lines.loose.offline === "Offline devices | 1 device and 1 entity offline, 1 partly offline", JSON.stringify(lines.loose));
    check("copy: an integration that failed to set up counts too", lines.integration.offline === "Offline devices | 1 integration, 1 device and 1 entity offline, 1 partly offline" && lines.integration.rows[0].startsWith("Tuya|retrying setup"), JSON.stringify(lines.integration));
    check("copy: details count the devices online; an offline one is not", lines.healthy.facts[0] === "39 devices, all online" && lines.loose.facts[0] === "38 of 39 devices online", JSON.stringify([lines.healthy.facts, lines.loose.facts]));
    check("copy: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- a lock is always in the security popup ----------
  for (const [theme, width] of [["dark", 420], ["light", 320]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate((width) => {
      // a lock with no area, and a window that is open (the house has one): the locked locks used to drop out
      window.setStates({ "lock.garage": { entity_id: "lock.garage", state: "locked", attributes: { friendly_name: "Garage Lock" } } });
      window.mount("savvy-home-header-card", { weather: false, health: false }, width);
    }, width);
    await page.waitForTimeout(300);
    const chips = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll("#chips .chip")].map((c) => c.textContent.trim()));
    const sec = chips.findIndex((t) => /Security|Armed|Doors|Secure|open/i.test(t));
    await hold(page, await page.evaluate((i) => { const c = window.cards[0].shadowRoot.querySelectorAll("#chips .chip")[i]; c.scrollIntoView({ block: "nearest", inline: "center" }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sec));
    await page.waitForTimeout(500);
    const names = await page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-row .sv-name")].map((n) => n.textContent));
    const idx = (re) => names.findIndex((n) => re.test(n));
    check(`${tag} the security popup lists every lock, locked or not, with something open`, idx(/Front Door/) >= 0 && idx(/Back Door/) >= 0 && idx(/Garage Lock/) >= 0 && idx(/Window/) >= 0, JSON.stringify(names));
    check(`${tag} ...the alarm first, then the locks, then what is open`, idx(/Alarm/) === 0 && Math.max(idx(/Front Door/), idx(/Back Door/), idx(/Garage Lock/)) < idx(/Window/), JSON.stringify(names));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- the cog follows the config entries as they arrive ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async () => {
      const S = window.__savvy;
      S.resetConfigEntries();
      window.hass.callWS = async () => { await new Promise((res) => setTimeout(res, 200)); return [{ entry_id: "N", domain: "nest", title: "Nest", state: "setup_error", disabled_by: null }]; };
      window.mount("savvy-home-header-card", { weather: false, health: {} }, 420);
      await new Promise((res) => setTimeout(res, 60));
      const before = window.cards[0].shadowRoot.getElementById("count").textContent;
      await new Promise((res) => setTimeout(res, 500));
      const after = window.cards[0].shadowRoot.getElementById("count").textContent;
      const total = S.healthSummary(window.hass, {}).total;
      S.resetConfigEntries();
      return { before, after, total };
    });
    check("cog: a failed integration is counted as soon as Home Assistant says so, with no state change", Number(r.after) === Number(r.before) + 1 && r.after === String(r.total), JSON.stringify(r));
    check("cog: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- the editors ----------
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
      form.set("watchman_button", false);
      form.set("watchman_report", { parse_config: false });
      return { fields, last: changes[changes.length - 1] };
    });
    check("editor: the report chip's switch and data round-trip", ed.fields.includes("watchman_button") && ed.fields.includes("watchman_report") && ed.last.watchman_button === false && ed.last.watchman_report?.parse_config === false, JSON.stringify(ed));
    const home = await page.evaluate(async () => {
      const el = document.createElement("savvy-home-header-card-editor");
      document.body.appendChild(el);
      el.setConfig({ type: "custom:savvy-home-header-card", health: {} });
      el.hass = window.hass;
      await new Promise((r) => setTimeout(r, 60));
      return [...el.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
    });
    check("editor: the home header's cog offers the chip's options, and tap / hold actions", ["watchman_button", "watchman_report", "tap_action", "hold_action"].every((f) => home.includes(f)), JSON.stringify(home));
    await page.close();
  }
}
