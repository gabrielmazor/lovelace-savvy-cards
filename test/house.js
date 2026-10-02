// A made-up house for tests: every card's test page builds on it. Deliberately awkward in
// the ways real houses are: two climates in one room, a light with no area, a diagnostic
// entity that must stay hidden, a phone battery that must be ignored, unavailable devices,
// entities that get their area from their device.
//   window.makeHouse() -> { states, entities, devices, areas }
(() => {
  const now = Date.now(), MIN = 60000, HOUR = 3600000;
  const ago = (ms) => new Date(now - ms).toISOString();

  function makeHouse() {
    const states = {}, entities = {}, devices = {};
    const areas = {
      living_room: { area_id: "living_room", name: "Living Room", icon: "mdi:sofa" },
      kitchen: { area_id: "kitchen", name: "Kitchen", icon: "mdi:fridge" },
      bedroom: { area_id: "bedroom", name: "Bedroom", icon: "mdi:bed" },
      office: { area_id: "office", name: "Office", icon: "mdi:desk" },
      bathroom: { area_id: "bathroom", name: "Bathroom", icon: "mdi:shower" },
      hallway: { area_id: "hallway", name: "Hallway" },
      empty_room: { area_id: "empty_room", name: "Empty Room" },
    };
    // add(id, state, attributes, registry) ; registry.area / registry.device / platform / category
    const add = (id, state, attributes = {}, reg = {}) => {
      states[id] = { entity_id: id, state: String(state), attributes, last_changed: ago(reg.changed ?? 30 * MIN), last_updated: ago(reg.changed ?? 30 * MIN) };
      if (reg.none) return;
      entities[id] = {
        entity_id: id, area_id: reg.area ?? null, device_id: reg.device ?? null, platform: reg.platform || "demo",
        entity_category: reg.category || null, hidden: !!reg.hidden, disabled_by: null,
        display_precision: reg.precision, translation_key: reg.tk,
      };
    };
    const device = (id, area) => { devices[id] = { id, area_id: area }; return id; };

    // ---- lights
    add("light.living_room_ceiling", "on", { friendly_name: "Living Room Ceiling", brightness: 200, color_mode: "hs", hs_color: [30, 60], rgb_color: [255, 190, 110], supported_color_modes: ["hs", "color_temp"] }, { area: "living_room" });
    add("light.living_room_floor_lamp", "on", { friendly_name: "Living Room Floor Lamp", brightness: 90, color_mode: "color_temp", color_temp_kelvin: 2700, supported_color_modes: ["color_temp"] }, { device: device("dev_floor_lamp", "living_room") });
    add("light.living_room_strip", "off", { friendly_name: "Living Room Strip", supported_color_modes: ["hs"] }, { area: "living_room" });
    add("light.kitchen_pendant", "off", { friendly_name: "Kitchen Pendant", supported_color_modes: ["brightness"] }, { area: "kitchen" });
    add("light.bedroom_lamp", "on", { friendly_name: "Bedroom Lamp", brightness: 60, color_mode: "brightness", supported_color_modes: ["brightness"] }, { area: "bedroom" });
    add("light.office_desk", "off", { friendly_name: "Office Desk Lamp", supported_color_modes: ["onoff"] }, { area: "office" });
    add("light.porch", "on", { friendly_name: "Porch Light", supported_color_modes: ["onoff"] }, {});           // no area
    add("light.hallway_broken", "unavailable", { friendly_name: "Hallway Light" }, { area: "hallway" });
    // a garden group made in HA with its members hidden: the member counts, the group doesn't
    add("light.garden_string", "on", { friendly_name: "Garden String", supported_color_modes: ["onoff"] }, { hidden: true });
    add("light.garden", "on", { friendly_name: "Garden", entity_id: ["light.garden_string"], supported_color_modes: ["onoff"] }, {});

    // ---- switches and helpers
    add("switch.living_room_plug", "on", { friendly_name: "Living Room Plug" }, { area: "living_room" });
    add("input_boolean.movie_mode", "off", { friendly_name: "Movie Mode" }, {});
    add("input_select.house_mode", "Home", { friendly_name: "House Mode", options: ["Home", "Away", "Night", "Movie Night", "Guests"] }, {});
    add("input_select.living_room_scene", "Relax", { friendly_name: "Living Room Scene", options: ["Auto", "Relax", "Reading", "Movie", "Party"] }, { area: "living_room" });

    // ---- climate: two in the living room, so a card has to choose
    const ac = { hvac_modes: ["off", "cool", "heat", "fan_only", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan_mode: "auto",
      min_temp: 16, max_temp: 30, target_temp_step: 0.5, supported_features: 393 };
    add("climate.living_room_ac", "cool", { ...ac, friendly_name: "Living Room AC", temperature: 22, current_temperature: 23.4, current_humidity: 48, hvac_action: "cooling" }, { area: "living_room" });
    add("climate.living_room_heater", "off", { friendly_name: "Living Room Heater", hvac_modes: ["off", "heat"], min_temp: 10, max_temp: 28, temperature: 20, current_temperature: 23.1 }, { area: "living_room" });
    add("climate.bedroom_ac", "off", { ...ac, friendly_name: "Bedroom AC", temperature: 21, current_temperature: 21.8, current_humidity: 52, hvac_action: "off" }, { area: "bedroom" });

    // ---- sensors
    const temp = (id, v, area, name) => add(id, v, { friendly_name: name, device_class: "temperature", unit_of_measurement: "°C", state_class: "measurement" }, { area });
    temp("sensor.living_room_temperature", 23.6, "living_room", "Living Room Temperature");
    temp("sensor.kitchen_temperature", 24.9, "kitchen", "Kitchen Temperature");
    temp("sensor.bedroom_temperature", 21.5, "bedroom", "Bedroom Temperature");
    temp("sensor.office_temperature", 22.8, "office", "Office Temperature");
    add("sensor.outdoor_temperature", 17.2, { friendly_name: "Outdoor Temperature", device_class: "temperature", unit_of_measurement: "°C" }, {});  // no area: not indoors
    add("sensor.garage_temperature", "unavailable", { friendly_name: "Garage Temperature", device_class: "temperature" }, { area: "hallway" });
    add("sensor.living_room_humidity", 47, { friendly_name: "Living Room Humidity", device_class: "humidity", unit_of_measurement: "%" }, { area: "living_room" });
    add("sensor.living_room_illuminance", 140, { friendly_name: "Living Room Illuminance", device_class: "illuminance", unit_of_measurement: "lx" }, { area: "living_room" });
    add("sensor.living_room_ac_filter", "ok", { friendly_name: "AC Filter" }, { area: "living_room", category: "diagnostic" });   // never discovered
    add("sensor.energy_cost", 3.45, { friendly_name: "Energy Cost", device_class: "monetary", unit_of_measurement: "$", state_class: "total" }, {});

    // ---- batteries: one low, one fine, one low phone (mobile_app: ignored)
    const batt = (id, v, name, reg) => add(id, v, { friendly_name: name, device_class: "battery", unit_of_measurement: "%" }, { category: "diagnostic", ...reg });
    batt("sensor.front_door_battery", 12, "Front Door Battery", { area: "hallway" });
    batt("sensor.living_room_motion_battery", 55, "Motion Sensor Battery", { area: "living_room" });
    batt("sensor.remote_battery", 90, "Remote Battery", {});
    batt("sensor.phone_battery", 8, "Phone Battery", { platform: "mobile_app" });

    // ---- security
    add("binary_sensor.living_room_presence", "on", { friendly_name: "Living Room Presence", device_class: "occupancy" }, { area: "living_room", changed: 12 * MIN });
    add("binary_sensor.living_room_door", "off", { friendly_name: "Living Room Door", device_class: "door" }, { area: "living_room", changed: 47 * MIN });
    add("binary_sensor.bedroom_window", "on", { friendly_name: "Bedroom Window", device_class: "window" }, { area: "bedroom", changed: 2 * HOUR });
    add("binary_sensor.kitchen_motion", "off", { friendly_name: "Kitchen Motion", device_class: "motion" }, { area: "kitchen" });
    add("binary_sensor.hallway_leak", "off", { friendly_name: "Hallway Leak", device_class: "moisture" }, { area: "hallway" });
    add("lock.front_door", "locked", { friendly_name: "Front Door" }, { area: "hallway" });
    add("lock.back_door", "unlocked", { friendly_name: "Back Door" }, { area: "kitchen" });
    add("alarm_control_panel.home_alarm", "armed_home", { friendly_name: "Home Alarm" }, {});

    // ---- media: device_class tells a TV from a speaker
    add("media_player.living_room_tv", "playing", { friendly_name: "Living Room TV", device_class: "tv", media_title: "A Show", supported_features: 21437, volume_level: 0.3 }, { area: "living_room" });
    add("media_player.living_room_speaker", "idle", { friendly_name: "Living Room Speaker", device_class: "speaker", supported_features: 21437, volume_level: 0.4 }, { area: "living_room" });
    add("media_player.kitchen_speaker", "playing", { friendly_name: "Kitchen Speaker", device_class: "speaker", media_title: "A Song", supported_features: 21437, volume_level: 0.25 }, { area: "kitchen" });

    // ---- cameras: two through Frigate, one plain
    const still = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='9'><rect width='16' height='9' fill='${c}'/></svg>`)}`;
    add("camera.living_room", "streaming", { friendly_name: "Living Room", entity_picture: still("#2d3b52") }, { area: "living_room", platform: "frigate" });
    add("camera.kitchen", "streaming", { friendly_name: "Kitchen", entity_picture: still("#3b4a2d") }, { area: "kitchen", platform: "frigate" });
    add("camera.hallway", "idle", { friendly_name: "Hallway Cam", entity_picture: still("#4a2d3b") }, { area: "hallway", platform: "generic" });

    // ---- people, zones, a script
    add("person.alex", "home", { friendly_name: "Alex" }, { changed: 3 * HOUR });
    add("person.sam", "Work", { friendly_name: "Sam Rivera" }, { changed: 40 * MIN });
    add("zone.work", "0", { friendly_name: "Work", icon: "mdi:briefcase" }, {});
    add("sensor.alex_phone_battery", 64, { friendly_name: "Alex Phone Battery", device_class: "battery", unit_of_measurement: "%" }, { platform: "mobile_app", category: "diagnostic" });
    add("script.good_night", "off", { friendly_name: "Good Night" }, {});

    // ---- scenes: a scene's state is when it last ran. Office ones are named the way a
    // scenes.yaml often does ("Office // Work - On"); one has no area, one is hidden
    const scene = (id, name, reg, icon) => add(id, ago(48 * HOUR), { friendly_name: name, ...(icon ? { icon } : {}) }, reg);
    scene("scene.office_work", "Office // Work - On", { area: "office" });
    scene("scene.office_focus", "Office // Focus - On", { area: "office" }, "mdi:target");
    scene("scene.office_relax", "Office Relax", { device: device("dev_office_hub", "office") });
    scene("scene.office_hidden", "Office // Secret - On", { area: "office", hidden: true });
    scene("scene.living_room_movie", "Living Room Movie", { area: "living_room" }, "mdi:movie-open");
    scene("scene.living_room_reading", "Living Room Reading", { area: "living_room" });
    scene("scene.evening", "Evening", { area: "living_room" });
    scene("scene.party", "Party", {});

    // ---- the rest
    add("weather.home", "sunny", { friendly_name: "Home", temperature: 26, humidity: 40 }, {});
    add("sensor.watchman_missing_entities", 2, { friendly_name: "Watchman Missing Entities",
      entities: [{ id: "light.old_lamp", state: "missing", occurrences: "/config/automations.yaml:12" },
        { id: "sensor.gone", state: "unavail", occurrences: "/config/scenes.yaml:4" }] }, {});
    add("sensor.watchman_missing_actions", 1, { friendly_name: "Watchman Missing Actions",
      services: [{ id: "script.old_script", state: "missing", occurrences: "/config/automations.yaml:40" }] }, { platform: "watchman" });
    // Watchman's own timestamps: the card should find "last parse" (when the report ran)
    add("sensor.watchman_last_updated", ago(5 * MIN), { friendly_name: "Watchman Last Updated", device_class: "timestamp" }, { platform: "watchman", tk: "last_updated", category: "diagnostic" });
    add("sensor.watchman_last_parse", ago(2 * HOUR), { friendly_name: "Watchman Last Parse", device_class: "timestamp" }, { platform: "watchman", tk: "last_parse", category: "diagnostic" });

    // ---- a robot vacuum, Roborock-shaped: everything on its device, by translation_key
    devices.dev_robot = { id: "dev_robot", area_id: null };
    const V = "vacuum.robot", P = "robot";
    const vac = (id, state, attributes, tk, category) => add(id, state, attributes, { device: "dev_robot", platform: "roborock", tk, category });
    vac(V, "docked", { friendly_name: "Robot", fan_speed: "balanced", fan_speed_list: ["quiet", "balanced", "turbo", "max"],
      supported_features: 4 | 8 | 16 | 32 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 });
    vac(`sensor.${P}_status`, "charging_complete", { friendly_name: "Status", device_class: "enum" }, "status", "diagnostic");
    vac(`sensor.${P}_battery`, "100", { friendly_name: "Robot Battery", device_class: "battery", unit_of_measurement: "%" }, "battery", "diagnostic");
    vac(`sensor.${P}_vacuum_error`, "none", { friendly_name: "Vacuum error", device_class: "enum" }, "vacuum_error", "diagnostic");
    vac(`sensor.${P}_last_clean_begin`, ago(3 * HOUR), { friendly_name: "Last clean begin", device_class: "timestamp" }, "last_clean_start", "diagnostic");
    vac(`sensor.${P}_last_clean_end`, ago(2 * HOUR), { friendly_name: "Last clean end", device_class: "timestamp" }, "last_clean_end", "diagnostic");
    vac(`sensor.${P}_filter_time_left`, "96", { friendly_name: "Filter time left", device_class: "duration", unit_of_measurement: "h" }, "filter_time_left", "diagnostic");
    vac(`sensor.${P}_main_brush_time_left`, String(212 * 3600), { friendly_name: "Main brush time left", device_class: "duration", unit_of_measurement: "s" }, "main_brush_time_left", "diagnostic");
    vac(`binary_sensor.${P}_water_shortage`, "off", { friendly_name: "Water shortage", device_class: "problem" }, "water_shortage", "diagnostic");
    vac(`select.${P}_mop_mode`, "standard", { friendly_name: "Mop mode", options: ["standard", "deep", "fast"] }, "mop_mode", "config");
    vac(`switch.${P}_dust_emptying`, "off", { friendly_name: "Empty bin" }, "dust_emptying");
    // app routines: buttons on the device with no translation_key and no category
    add("button.robot_vacuum", ago(26 * HOUR), { friendly_name: "Robot Vacuum" }, { device: "dev_robot", platform: "roborock" });
    add("button.robot_mop", "unknown", { friendly_name: "Robot Mop" }, { device: "dev_robot", platform: "roborock" });

    return { states, entities, devices, areas };
  }

  // Devices for the health card, added to a house on demand (so the base house's counts stay
  // as they are): hubs, the devices behind them, and the awkward cases.
  //   window.hubFixture(house, { down: [device ids], downEntities: [entity ids] }) -> a states patch
  // for window.setStates; the registry (hass.entities / hass.devices) is changed in place.
  //   Zigbee2MQTT bridge (own entities) with five devices behind it, three entities each
  //   a ZHA coordinator with no entities of its own, three devices behind it
  //   a Hue bridge that is up, with three devices behind it
  //   a chain: dev_chain_a (hub) <- dev_chain_b <- dev_chain_c
  //   a cycle: dev_cyc_a <-> dev_cyc_b
  //   dev_partial (some entities down), dev_solo (down, no hub)
  function hubFixture(house, { down = [], downEntities = [] } = {}) {
    const patch = {};
    const dev = (id, name, via = null, area = null, extra = {}) => { house.devices[id] = { id, name, area_id: area, via_device_id: via, manufacturer: extra.manufacturer, model: extra.model }; };
    const ent = (id, device, platform, state, attrs = {}, name) => {
      house.entities[id] = { entity_id: id, area_id: null, device_id: device, platform, entity_category: null, hidden: false, disabled_by: null };
      const off = down.includes(device) || downEntities.includes(id);
      patch[id] = { entity_id: id, state: off ? "unavailable" : String(state), attributes: { friendly_name: name || id.split(".")[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), ...attrs }, last_changed: ago(3 * HOUR) };
    };
    // Zigbee2MQTT
    dev("dev_z2m_bridge", "Zigbee2MQTT Bridge", null, null, { manufacturer: "Zigbee2MQTT" });
    ent("binary_sensor.z2m_bridge_connection_state", "dev_z2m_bridge", "mqtt", "on", { device_class: "connectivity" }, "Z2M Bridge Connection");
    ent("sensor.z2m_bridge_version", "dev_z2m_bridge", "mqtt", "2.1.0", {}, "Z2M Bridge Version");
    const z2m = [["kitchen_motion", "Kitchen Motion Sensor", "kitchen"], ["hall_door", "Hall Door Sensor", "hallway"], ["bedroom_climate", "Bedroom Climate Sensor", "bedroom"],
      ["office_plug", "Office Plug", "office"], ["garage_leak", "Garage Leak Sensor", null]];
    for (const [k, name, area] of z2m) {
      dev(`dev_z2m_${k}`, name, "dev_z2m_bridge", area, { manufacturer: "Aqara", model: "Sensor" });
      ent(`sensor.${k}_state`, `dev_z2m_${k}`, "mqtt", "ok", {}, `${name} State`);
      ent(`sensor.${k}_linkquality`, `dev_z2m_${k}`, "mqtt", "120", {}, `${name} Link Quality`);
      ent(`sensor.${k}_battery`, `dev_z2m_${k}`, "mqtt", "88", { device_class: "battery", unit_of_measurement: "%" }, `${name} Battery`);
    }
    // ZHA: a coordinator with no entities
    dev("dev_zha_coord", "ZHA Coordinator", null, null, { manufacturer: "Silicon Labs" });
    for (const [k, name] of [["hall_bulb", "Hall Bulb"], ["porch_bulb", "Porch Bulb"], ["stair_bulb", "Stair Bulb"]]) {
      dev(`dev_zha_${k}`, name, "dev_zha_coord", "hallway");
      ent(`light.zha_${k}`, `dev_zha_${k}`, "zha", "on", {}, name);
      ent(`sensor.zha_${k}_rssi`, `dev_zha_${k}`, "zha", "-60", {}, `${name} RSSI`);
    }
    // a Hue bridge that is up, with three devices behind it
    dev("dev_hue_bridge", "Hue Bridge");
    ent("binary_sensor.hue_bridge_status", "dev_hue_bridge", "hue", "on", {}, "Hue Bridge Status");
    for (const k of ["a", "b", "c"]) {
      dev(`dev_hue_${k}`, `Hue Lamp ${k.toUpperCase()}`, "dev_hue_bridge", "living_room");
      ent(`light.hue_lamp_${k}`, `dev_hue_${k}`, "hue", "on", {}, `Hue Lamp ${k.toUpperCase()}`);
    }
    // a chain A <- B <- C, and a cycle
    dev("dev_chain_a", "Chain Hub");
    dev("dev_chain_b", "Chain Router", "dev_chain_a");
    dev("dev_chain_c", "Chain Leaf", "dev_chain_b");
    for (const k of ["a", "b", "c"]) ent(`sensor.chain_${k}`, `dev_chain_${k}`, "demo", "1", {}, `Chain ${k.toUpperCase()}`);
    dev("dev_cyc_a", "Cycle A", "dev_cyc_b");
    dev("dev_cyc_b", "Cycle B", "dev_cyc_a");
    ent("sensor.cycle_a", "dev_cyc_a", "demo", "1", {}, "Cycle A");
    ent("sensor.cycle_b", "dev_cyc_b", "demo", "1", {}, "Cycle B");
    // partial and solo
    dev("dev_partial", "Garage Multisensor", null, "hallway");
    for (const k of ["temperature", "humidity", "pressure", "battery"]) ent(`sensor.garage_multi_${k}`, "dev_partial", "mqtt", "5", {}, `Garage ${k[0].toUpperCase()}${k.slice(1)}`);
    dev("dev_solo", "Washer Plug", null, "bathroom");
    for (const k of ["power", "energy", "switch"]) ent(`sensor.washer_${k}`, "dev_solo", "shelly", "1", {}, `Washer ${k}`);
    return patch;
  }

  // What a real house does when things stop (0.6.1), added on demand like hubFixture:
  //   z2m     a Zigbee2MQTT-like bridge stops: its connectivity sensor reads "off" (not unavailable),
  //           three of its four entities go unavailable, and each of the six devices behind it loses
  //           two of its three entities (one device loses only one: partial). MQTT platform.
  //   washer  an MQTT device with 14 entities, 12 of them unavailable
  //   tuya    four Tuya devices on one config entry, three of them offline
  //   coord   a ZHA-like coordinator with no entities, four devices behind it, three offline
  //   nest    a config entry with no devices
  //   tuyaState / nestState   the config entries' states, as config_entries/get says ("loaded", "setup_retry"...)
  //   window.offlineFixture(house, { z2m, washer, tuya, coord, tuyaState, nestState }) -> { patch, entries }
  // `patch` is for window.setStates; `entries` is what config_entries/get answers. The registry
  // (hass.entities / hass.devices) is changed in place.
  function offlineFixture(house, { z2m = false, washer = false, tuya = false, coord = false, tuyaState = "loaded", nestState = "loaded" } = {}) {
    const patch = {};
    const dev = (id, name, via, entry, area = null) => { house.devices[id] = { id, name, area_id: area, via_device_id: via, config_entries: entry ? [entry] : [], primary_config_entry: entry || null }; };
    const ent = (id, device, platform, state, off, attrs = {}, name) => {
      house.entities[id] = { entity_id: id, area_id: null, device_id: device, platform, entity_category: null, hidden: false, disabled_by: null };
      patch[id] = { entity_id: id, state: off ? "unavailable" : String(state), attributes: { friendly_name: name || id.split(".")[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), ...attrs }, last_changed: ago(3 * HOUR) };
    };
    dev("dev_n_bridge", "Z2M Bridge", null, "entry_mqtt");
    ent("binary_sensor.n_bridge_connection", "dev_n_bridge", "mqtt", z2m ? "off" : "on", false, { device_class: "connectivity" }, "Z2M Bridge Connection");
    for (const k of ["version", "clients", "uptime"]) ent(`sensor.n_bridge_${k}`, "dev_n_bridge", "mqtt", "1", z2m, {}, `Z2M Bridge ${k[0].toUpperCase()}${k.slice(1)}`);
    for (let i = 1; i <= 6; i++) {
      dev(`dev_n_k${i}`, `Z2M Sensor ${i}`, "dev_n_bridge", "entry_mqtt", "kitchen");
      ent(`sensor.n_k${i}_a`, `dev_n_k${i}`, "mqtt", "1", z2m, {}, `Z2M Sensor ${i} A`);
      ent(`sensor.n_k${i}_b`, `dev_n_k${i}`, "mqtt", "1", z2m && i < 6, {}, `Z2M Sensor ${i} B`);
      ent(`sensor.n_k${i}_c`, `dev_n_k${i}`, "mqtt", "1", false, {}, `Z2M Sensor ${i} C`);
    }
    dev("dev_n_washer", "Washing Machine", null, "entry_mqtt", "bathroom");
    for (let i = 0; i < 14; i++) ent(`sensor.n_washer_${i}`, "dev_n_washer", "mqtt", "1", washer && i < 12, {}, `Washer ${i}`);
    for (let i = 1; i <= 4; i++) {
      dev(`dev_n_tuya${i}`, `Tuya Plug ${i}`, null, "entry_tuya", "office");
      for (const k of ["power", "switch"]) ent(`sensor.n_tuya${i}_${k}`, `dev_n_tuya${i}`, "tuya", "1", tuya && i < 4, {}, `Tuya Plug ${i} ${k[0].toUpperCase()}${k.slice(1)}`);
    }
    dev("dev_n_coord", "ZHA Hub");
    for (let i = 1; i <= 4; i++) {
      dev(`dev_n_z${i}`, `ZHA Bulb ${i}`, "dev_n_coord", "entry_zha", "hallway");
      for (const k of ["light", "rssi"]) ent(`${k === "light" ? "light" : "sensor"}.n_z${i}_${k}`, `dev_n_z${i}`, "zha", k === "light" ? "on" : "-60", coord && i < 4, {}, `ZHA Bulb ${i} ${k}`);
    }
    const entries = [
      { entry_id: "entry_mqtt", domain: "mqtt", title: "MQTT", state: "loaded", disabled_by: null },
      { entry_id: "entry_tuya", domain: "tuya", title: "Tuya", state: tuyaState, disabled_by: null },
      { entry_id: "entry_zha", domain: "zha", title: "ZHA", state: "loaded", disabled_by: null },
      { entry_id: "entry_nest", domain: "nest", title: "Nest", state: nestState, disabled_by: null },
    ];
    return { patch, entries };
  }

  window.makeHouse = makeHouse;
  window.hubFixture = hubFixture;
  window.offlineFixture = offlineFixture;
})();
