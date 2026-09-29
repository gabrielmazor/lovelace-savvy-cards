// The core modules, checked directly through the test hook.
export default async function ({ browser, base, check }) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "page.html");
  await page.waitForFunction(() => window.__savvy);

  // ---- palette: the mode dictionary
  const looks = await page.evaluate(() => {
    const L = (o) => window.__savvy.modeLook(o);
    return {
      // the palette the old cards shipped with must come through unchanged
      legacy: Object.fromEntries(["Sync", "Basic", "Manual", "Daytime", "Evening", "Night", "Sleep", "Sleeping", "Away", "Guest",
        "Cooking", "Watching TV", "TV", "Movie Time", "Watching Movie", "Movie", "Gaming", "Music", "In a Meeting", "Meeting",
        "Focus Time", "Focus", "Chilling"].map((o) => [o, L(o)])),
      movieNight: L("Movie Night"), guests: L("Guests"), plural: L("Parties"), unknown: L("Zorblax"),
      underscored: L("date_night"), override: window.__savvy.modeLook("Night", { icons: { night: "mdi:star" }, colors: { night: "red" } }),
      size: window.__savvy.MODE_DICTIONARY.reduce((n, [w]) => n + w.length, 0),
    };
  });
  const legacy = {
    Sync: ["mdi:sync", ""], Basic: ["mdi:home-outline", "#8FA3B8"], Manual: ["mdi:hand-back-right-outline", "#4FB3A5"],
    Daytime: ["mdi:white-balance-sunny", "#F5B83D"], Evening: ["mdi:weather-sunset", "#F2915E"], Night: ["mdi:weather-night", "#4F8FE0"],
    Sleep: ["mdi:sleep", "#7B6FE0"], Sleeping: ["mdi:sleep", "#7B6FE0"], Away: ["mdi:home-export-outline", "#E06666"],
    Guest: ["mdi:account-group-outline", "#5FBF8A"], Cooking: ["mdi:silverware-fork-knife", "#E8934A"],
    "Watching TV": ["mdi:television-play", "#5BA3D9"], TV: ["mdi:television-play", "#5BA3D9"], "Movie Time": ["mdi:movie-open", "#9B7BD9"],
    "Watching Movie": ["mdi:movie-open", "#9B7BD9"], Movie: ["mdi:movie-open", "#9B7BD9"], Gaming: ["mdi:gamepad-variant", "#A8C74F"],
    Music: ["mdi:music", "#D97FB8"], "In a Meeting": ["mdi:account-voice", "#C4566E"], Meeting: ["mdi:account-voice", "#C4566E"],
    "Focus Time": ["mdi:head-cog-outline", "#3FB6C9"], Focus: ["mdi:head-cog-outline", "#3FB6C9"], Chilling: ["mdi:sofa-outline", "#C4A57B"],
  };
  const drift = Object.entries(legacy).filter(([k, [i, c]]) => looks.legacy[k].icon !== i || looks.legacy[k].color !== c)
    .map(([k]) => `${k}: ${JSON.stringify(looks.legacy[k])}`);
  check("mode dictionary keeps every legacy colour and icon", drift.length === 0, drift.join("; "));
  check("longest keyword wins: 'Movie Night' is a movie", looks.movieNight.icon === "mdi:movie-open", JSON.stringify(looks.movieNight));
  check("plurals match: 'Guests', 'Parties'", looks.guests.icon === "mdi:account-group-outline" && looks.plural.icon === "mdi:party-popper");
  check("underscores match: 'date_night' is romantic", looks.underscored.icon === "mdi:heart-outline", JSON.stringify(looks.underscored));
  check("unknown option gets a neutral look", looks.unknown.icon === "mdi:shape-outline" && looks.unknown.color === "");
  check("overrides win, HA colour names resolve", looks.override.icon === "mdi:star" && looks.override.color === "var(--red-color, #f44336)", JSON.stringify(looks.override));
  check("dictionary has a few hundred keywords", looks.size >= 300, `${looks.size}`);

  // ---- registry: discovery
  const reg = await page.evaluate(() => {
    const s = window.__savvy, h = window.hass;
    return {
      living: s.areaEntities(h, "living_room").sort(),
      lightsLiving: s.pick(h, s.areaEntities(h, "living_room"), { domains: "light" }).sort(),
      climates: s.pick(h, s.areaEntities(h, "living_room"), { domains: "climate" }),
      presence: s.rankBy(h, s.pick(h, s.areaEntities(h, "living_room"), { domains: "binary_sensor", deviceClasses: ["presence", "occupancy", "motion"] }), ["presence", "occupancy", "motion"]),
      empty: s.areaEntities(h, "empty_room"),
      short: s.shortName(h, "light.living_room_floor_lamp"),
      noArea: s.entityArea(h, "light.porch"),
      items: s.asItems(["light.a", { entity: "light.b", name: "B" }, false, { name: "nav", navigation_path: "/x" }]),
      active: ["media_player.living_room_tv", "media_player.living_room_speaker", "lock.back_door", "lock.front_door", "climate.bedroom_ac", "light.hallway_broken"].map((id) => s.isActive(h.states[id])),
    };
  });
  check("area discovery includes device-area entities", reg.lightsLiving.includes("light.living_room_floor_lamp") && reg.lightsLiving.length === 3, JSON.stringify(reg.lightsLiving));
  check("diagnostic and battery entities are never discovered", !reg.living.includes("sensor.living_room_ac_filter") && !reg.living.includes("sensor.living_room_motion_battery"));
  check("two climates found in one area", reg.climates.length === 2);
  check("presence ranking picks occupancy", reg.presence[0] === "binary_sensor.living_room_presence");
  check("an empty area discovers nothing", reg.empty.length === 0);
  check("short names drop the area prefix", reg.short === "Floor Lamp", reg.short);
  check("an entity with no area has none", reg.noArea === null);
  check("asItems normalizes and drops false", reg.items.length === 3 && reg.items[0].entity === "light.a" && reg.items[2].navigation_path === "/x");
  check("isActive per domain", JSON.stringify(reg.active) === JSON.stringify([true, false, true, false, false, false]), JSON.stringify(reg.active));

  // ---- health: what the cog counts
  const health = await page.evaluate(() => {
    const s = window.__savvy, h = window.hass;
    const a = s.healthSummary(h, {});
    const b = s.healthSummary(h, { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"], battery_threshold: 60 });
    return { a: { counts: a.counts, total: a.total, phone: a.battery.some((r) => r.entity === "sensor.phone_battery") },
      b: { counts: b.counts, total: b.total, rows: b.watchman.length } };
  });
  check("health: low batteries (phone excluded), unavailable, no watchman by default",
    health.a.counts.battery === 1 && !health.a.phone && health.a.counts.unavailable === 2 && health.a.counts.watchman === 0 && health.a.total === 3, JSON.stringify(health.a));
  check("health: watchman sums its sensors, threshold is configurable",
    health.b.counts.watchman === 3 && health.b.rows === 3 && health.b.counts.battery === 2 && health.b.total === 7, JSON.stringify(health.b));

  // ---- actions
  const acts = await page.evaluate(() => {
    const s = window.__savvy, h = window.hass, host = document.body, out = [];
    const events = [];
    document.addEventListener("hass-more-info", (e) => events.push(e.detail.entityId));
    let listed = 0;
    window.log.length = 0;
    s.runAction(host, h, "toggle", { entity: "lock.front_door" });
    s.runAction(host, h, { action: "toggle" }, { entity: "light.bedroom_lamp" });
    s.runAction(host, h, { action: "perform-action", perform_action: "scene.turn_on", target: { entity_id: "scene.x" } });
    s.runAction(host, h, { action: "more-info" }, { entity: "sensor.kitchen_temperature" });
    s.runAction(host, h, { action: "list" }, { list: () => listed++ });
    const none = s.runAction(host, h, { action: "none" }, {});
    out.push(...window.log);
    return { calls: out, events, listed, none,
      defaults: ["light.x", "button.x", "script.x", "sensor.x", "lock.x"].map((id) => s.defaultTapAction(id).action + (s.defaultTapAction(id).perform_action ? `:${s.defaultTapAction(id).perform_action}` : "")) };
  });
  check("toggle is per-domain (a lock unlocks)", acts.calls[0].startsWith("lock.unlock") && acts.calls[1].startsWith("light.toggle"), acts.calls.join(" | "));
  check("perform-action calls the service", acts.calls[2].startsWith("scene.turn_on"), acts.calls[2]);
  check("more-info, list and none", acts.events[0] === "sensor.kitchen_temperature" && acts.listed === 1 && acts.none === false);
  check("default tap actions by domain", JSON.stringify(acts.defaults) === JSON.stringify(["toggle", "perform-action:button.press", "perform-action:script.turn_on", "more-info", "more-info"]), JSON.stringify(acts.defaults));

  // ---- press gesture: tap, hold, double-tap
  const press = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:20px;top:20px;width:80px;height:40px";
    document.body.appendChild(el);
    window.__p = { tap: 0, hold: 0, dbl: 0 };
    window.__savvy.bindPress(el, { onTap: () => window.__p.tap++, onHold: () => window.__p.hold++ });
    const el2 = el.cloneNode(); el2.style.top = "80px"; document.body.appendChild(el2);
    window.__savvy.bindPress(el2, { onTap: () => window.__p.tap++, onDouble: () => window.__p.dbl++ });
    return true;
  });
  await page.mouse.click(60, 40); await page.waitForTimeout(50);
  await page.mouse.move(60, 40); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); await page.waitForTimeout(50);
  await page.mouse.move(60, 40); await page.mouse.down(); await page.mouse.move(60, 80, { steps: 5 }); await page.mouse.up();
  await page.mouse.click(60, 100); await page.waitForTimeout(40); await page.mouse.click(60, 100); await page.waitForTimeout(400);
  const p = await page.evaluate(() => window.__p);
  check("press: tap, hold (no tap after), drag (nothing), double-tap", press && p.tap === 1 && p.hold === 1 && p.dbl === 1, JSON.stringify(p));

  // ---- history: long ranges read statistics, falling back to history
  const hist = await page.evaluate(async () => {
    const s = window.__savvy, calls = [];
    const h = { ...window.hass, callWS: async (m) => {
      calls.push(m.type);
      if (m.type === "recorder/statistics_during_period") return { "sensor.energy_cost": [{ start: Date.now() - 3600000, state: 3.1 }, { start: Date.now() - 1800000, state: 3.3 }] };
      return { [m.entity_ids[0]]: [{ s: "1", lu: Date.now() / 1000 - 60 }] };
    } };
    const short = await s.fetchRange(h, ["sensor.kitchen_temperature"], 24);
    const long = await s.fetchRange(h, ["sensor.energy_cost", "sensor.kitchen_temperature"], 720);
    const pts = s.resample(s.numericPoints(long["sensor.energy_cost"], "3.45"), Date.now() - 720 * 3600000, Date.now());
    return { calls, short: !!short["sensor.kitchen_temperature"], longStats: long["sensor.energy_cost"].length, longFallback: !!long["sensor.kitchen_temperature"], pts: pts.length };
  });
  check("history: ≤ a week uses history; longer uses statistics with history fallback",
    hist.calls.join() === "history/history_during_period,recorder/statistics_during_period,history/history_during_period"
    && hist.short && hist.longStats === 2 && hist.longFallback && hist.pts >= 1, JSON.stringify(hist));

  // ---- format
  const fmt = await page.evaluate(() => {
    const s = window.__savvy;
    return [s.duration(90 * 60000), s.since(Date.now() - 5 * 60000, true), s.since(Date.now() - 5 * 60000, false), s.fmtNumber(1234.5), s.fmtNumber(3.456), s.withUnit("22", "°C"), s.withUnit("3", "lx"), s.isTimestamp({ state: "2026-09-26T10:00:00", attributes: {} })];
  });
  check("format helpers", JSON.stringify(fmt) === JSON.stringify(["1 h 30 min", "for 5 min", "5 min ago", "1235", "3.46", "22°C", "3 lx", true]), JSON.stringify(fmt));

  // ---- the sheet and the entity list
  const sheet = await page.evaluate(async () => {
    const s = window.__savvy;
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = "<button id=opener>open</button>";
    document.body.appendChild(host);
    const list = new s.EntityListSheet(host, { title: "Lights on" });
    list.show(window.hass, (h) => Object.keys(h.states).filter((id) => id.startsWith("light.") && h.states[id].state === "on"), host.shadowRoot.getElementById("opener"));
    await new Promise((r) => setTimeout(r, 500));
    const rows = [...host.shadowRoot.querySelectorAll(".sv-row .sv-name")].map((n) => n.textContent);
    const toggles = [...host.shadowRoot.querySelectorAll(".sv-tog")].filter((t) => !t.hidden).length;
    window.log.length = 0;
    host.shadowRoot.querySelector(".sv-tog:not([hidden])").click();
    const call = window.log[0];
    window.__host = host;
    return { rows, toggles, call, open: !!host.shadowRoot.querySelector(".sv-sheet") };
  });
  check("entity list: live rows with toggles, toggling calls the service",
    sheet.open && sheet.rows.length === 4 && sheet.toggles === 4 && /light\.toggle/.test(sheet.call), JSON.stringify(sheet));
  await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  check("sheet closes on Escape", await page.evaluate(() => !window.__host.shadowRoot.querySelector(".sv-sheet")));

  // ---- editor kit
  const ed = await page.evaluate(async () => {
    const s = window.__savvy;
    const type = "savvy-test-card";
    s.defineEditor(type, () => [s.S.area(), s.S.bool("show_toggle", "Toggle"), s.S.chips()]);
    const el = document.createElement(`${type}-editor`);
    document.body.appendChild(el);
    const changes = [];
    el.addEventListener("config-changed", (e) => changes.push(e.detail.config));
    el.setConfig({ type: "custom:x", area: "kitchen", chips: ["light.a", { entity: "light.b" }, "light.c"] });
    el.hass = window.hass;
    await new Promise((r) => setTimeout(r, 50));
    const form = el.shadowRoot.querySelector("ha-form");
    const fields = [...form.querySelectorAll(".stub-field")].map((f) => `${f.dataset.name}:${f.dataset.selector}`);
    form.set("show_toggle", true);
    const list = el.shadowRoot.querySelector("savvy-list-editor");
    list.shadowRoot.querySelectorAll('[data-a="down"]')[0].click();          // light.a moves down
    list.shadowRoot.querySelectorAll('[data-a="remove"]')[2].click();        // drop the last
    list.shadowRoot.querySelector("ha-selector").pick("light.d");            // add one
    form.set("area", "");                                                     // cleared keys disappear
    return { fields, changes: changes.map((c) => JSON.stringify(c)) };
  });
  check("editor: scalar fields go to ha-form with their selectors", JSON.stringify(ed.fields) === JSON.stringify(["area:area", "show_toggle:boolean"]), JSON.stringify(ed.fields));
  check("editor: edits, reorder, remove, add, clear all emit config-changed",
    ed.changes.length === 5
    && JSON.parse(ed.changes[0]).show_toggle === true
    && JSON.stringify(JSON.parse(ed.changes[1]).chips) === JSON.stringify([{ entity: "light.b" }, "light.a", "light.c"])
    && JSON.parse(ed.changes[2]).chips.length === 2
    && JSON.parse(ed.changes[3]).chips[2].entity === "light.d"
    && !("area" in JSON.parse(ed.changes[4])) && JSON.parse(ed.changes[4]).chips.length === 3, ed.changes.join("\n"));

  // ---- editor: typing survives HA's round trip (config-changed -> setConfig)
  const typing = await page.evaluate(async () => {
    const s = window.__savvy;
    s.defineEditor("savvy-typing-card", () => [s.S.text("title", "Title"), s.S.bool("show_toggle", "Toggle", null, true), s.S.chips()]);
    const el = document.createElement("savvy-typing-card-editor");
    document.body.appendChild(el);
    // behave like HA: every config-changed comes straight back as setConfig
    el.addEventListener("config-changed", (e) => el.setConfig(e.detail.config));
    el.hass = window.hass;
    el.setConfig({ type: "custom:x", chips: [{ entity: "light.a", name: "A" }] });
    await new Promise((r) => setTimeout(r, 50));
    const form = el.shadowRoot.querySelector("ha-form");
    const sets0 = form.__schemaSets;
    for (const t of ["L", "Li", "Liv", "Livi"]) form.set("title", t);       // four keystrokes
    const sameForm = el.shadowRoot.querySelector("ha-form") === form;
    const list = el.shadowRoot.querySelector("savvy-list-editor");
    list.shadowRoot.querySelector('[data-a="edit"]').click();              // open the chip
    const itemForm = list.shadowRoot.querySelector(".sv-item-body ha-form");
    for (const t of ["B", "Be", "Bed"]) itemForm.set("name", t);            // type in the chip's name
    const sameItemForm = list.shadowRoot.querySelector(".sv-item-body ha-form") === itemForm;
    return { sameForm, schemaResets: form.__schemaSets - sets0, sameItemForm, title: el._config.title, chip: el._config.chips[0].name };
  });
  check("editor: typing keeps the field (no rebuild on HA's echo), top level and in a chip",
    typing.sameForm && typing.schemaResets === 0 && typing.sameItemForm && typing.title === "Livi" && typing.chip === "Bed", JSON.stringify(typing));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
