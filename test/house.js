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

  window.makeHouse = makeHouse;
})();
