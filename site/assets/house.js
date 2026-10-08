// The demo house: six rooms, the lights, climate, media, covers, fans, locks, cameras, people,
// energy and health data the cards read, shaped the way Home Assistant hands them over
// (states, and the entity, device and area registries).
//   window.SavvyDemo.makeHouse() -> { states, entities, devices, areas, entries }
// Every timestamp is relative to the moment the page opens, so the house always looks lived in.
(() => {
  const MIN = 60000, HOUR = 60 * MIN;
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  // A camera still: a calm drawing of a room, so the camera tiles have something to show.
  const still = (sky, wall, floor, label) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'>
<defs><linearGradient id='w' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${wall}'/><stop offset='1' stop-color='${floor}'/></linearGradient>
<linearGradient id='s' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${sky}'/><stop offset='1' stop-color='${wall}'/></linearGradient></defs>
<rect width='640' height='360' fill='url(#w)'/><rect x='380' y='54' width='170' height='150' rx='6' fill='url(#s)' opacity='.9'/>
<rect x='380' y='54' width='170' height='150' rx='6' fill='none' stroke='#000' stroke-opacity='.25' stroke-width='6'/>
<path d='M0 262 L640 238 L640 360 L0 360 Z' fill='#000' fill-opacity='.22'/>
<rect x='70' y='196' width='230' height='70' rx='14' fill='#000' fill-opacity='.28'/><rect x='84' y='170' width='202' height='40' rx='12' fill='#000' fill-opacity='.2'/>
<text x='20' y='34' font-family='ui-monospace,Menlo,monospace' font-size='15' fill='#fff' fill-opacity='.7'>${label}</text></svg>`)}`;

  // Album art for what is playing.
  const art = (a, b) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs>
<radialGradient id='g' cx='.75' cy='.2' r='.9'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></radialGradient></defs>
<rect width='300' height='300' fill='url(#g)'/><circle cx='150' cy='160' r='70' fill='#fff' fill-opacity='.12'/></svg>`)}`;

  // A face for a person.
  const face = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88'><rect width='88' height='88' fill='${c}'/>
<circle cx='44' cy='34' r='15' fill='#fff' fill-opacity='.85'/><ellipse cx='44' cy='78' rx='26' ry='22' fill='#fff' fill-opacity='.85'/></svg>`)}`;

  function makeHouse() {
    const states = {}, entities = {}, devices = {};
    const areas = {
      living_room: { area_id: "living_room", name: "Living Room", icon: "mdi:sofa" },
      kitchen: { area_id: "kitchen", name: "Kitchen", icon: "mdi:countertop" },
      dining_room: { area_id: "dining_room", name: "Dining Room", icon: "mdi:table-chair" },
      bedroom: { area_id: "bedroom", name: "Bedroom", icon: "mdi:bed" },
      office: { area_id: "office", name: "Office", icon: "mdi:desk" },
      kids_room: { area_id: "kids_room", name: "Kids Room", icon: "mdi:teddy-bear" },
    };

    // add(id, state, attributes, registry): registry.area / device / platform / category / changed (ms ago) / hidden / tk
    const add = (id, state, attributes = {}, reg = {}) => {
      states[id] = { entity_id: id, state: String(state), attributes, last_changed: ago(reg.changed ?? 40 * MIN), last_updated: ago(reg.changed ?? 40 * MIN) };
      entities[id] = {
        entity_id: id, area_id: reg.area ?? null, device_id: reg.device ?? null, platform: reg.platform || "demo",
        entity_category: reg.category || null, hidden: !!reg.hidden, disabled_by: null, translation_key: reg.tk,
      };
    };
    const device = (id, name, area = null, extra = {}) => { devices[id] = { id, name, area_id: area, via_device_id: extra.via || null, manufacturer: extra.manufacturer, model: extra.model, config_entries: extra.entry ? [extra.entry] : [], primary_config_entry: extra.entry || null }; return id; };

    // ---- lights: a mix of colour, warmth, dimmable and plain on/off, as real houses have
    const COLOR = ["hs", "color_temp"], TEMP = ["color_temp"], DIM = ["brightness"], ONOFF = ["onoff"];
    const light = (id, name, area, modes, on, o = {}) => {
      const a = { friendly_name: name, supported_color_modes: modes, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500 };
      if (o.icon) a.icon = o.icon;
      if (on) {
        if (modes.includes("onoff")) a.color_mode = "onoff";
        else {
          a.brightness = Math.round((o.pct ?? 70) * 2.55);
          if (o.hs && modes.includes("hs")) { a.color_mode = "hs"; a.hs_color = o.hs; a.rgb_color = window.SavvyDemo.hsToRgb(o.hs[0], o.hs[1] / 100); }
          else if (modes.includes("color_temp")) { a.color_mode = "color_temp"; a.color_temp_kelvin = o.k ?? 2700; }
          else a.color_mode = "brightness";
        }
      }
      add(id, on ? "on" : "off", a, { area, changed: o.changed ?? 50 * MIN });
    };
    light("light.living_room_ceiling", "Living Room Ceiling", "living_room", COLOR, true, { pct: 78, k: 3000, icon: "mdi:ceiling-light" });
    light("light.living_room_floor_lamp", "Living Room Floor Lamp", "living_room", TEMP, true, { pct: 35, k: 2400, icon: "mdi:floor-lamp" });
    light("light.living_room_tv_backlight", "Living Room TV Backlight", "living_room", ["hs"], true, { pct: 55, hs: [268, 70], icon: "mdi:led-strip-variant" });
    light("light.living_room_bookshelf", "Living Room Bookshelf", "living_room", COLOR, false, { icon: "mdi:bookshelf" });
    light("light.living_room_sconces", "Living Room Sconces", "living_room", DIM, true, { pct: 45, icon: "mdi:wall-sconce-round" });
    light("light.kitchen_pendants", "Kitchen Pendants", "kitchen", TEMP, true, { pct: 90, k: 3500, icon: "mdi:ceiling-light-multiple" });
    light("light.kitchen_under_cabinet", "Kitchen Under Cabinet", "kitchen", ["hs"], true, { pct: 60, hs: [32, 55], icon: "mdi:led-strip" });
    light("light.kitchen_island", "Kitchen Island", "kitchen", DIM, false, { icon: "mdi:track-light" });
    light("light.kitchen_ceiling", "Kitchen Ceiling", "kitchen", ONOFF, false, { icon: "mdi:ceiling-light" });
    light("light.dining_room_chandelier", "Dining Room Chandelier", "dining_room", TEMP, true, { pct: 62, k: 2700, icon: "mdi:chandelier" });
    light("light.dining_room_sideboard", "Dining Room Sideboard", "dining_room", COLOR, false, { icon: "mdi:lamp" });
    light("light.dining_room_candles", "Dining Room Candles", "dining_room", ["hs"], true, { pct: 30, hs: [22, 85], icon: "mdi:candelabra" });
    light("light.bedroom_bedside_left", "Bedroom Bedside Left", "bedroom", TEMP, true, { pct: 22, k: 2200, icon: "mdi:lamp" });
    light("light.bedroom_bedside_right", "Bedroom Bedside Right", "bedroom", TEMP, false, { icon: "mdi:lamp" });
    light("light.bedroom_ceiling", "Bedroom Ceiling", "bedroom", DIM, false, { icon: "mdi:ceiling-light" });
    light("light.bedroom_headboard", "Bedroom Headboard", "bedroom", ["hs"], true, { pct: 30, hs: [340, 60], icon: "mdi:led-strip-variant" });
    light("light.office_desk_lamp", "Office Desk Lamp", "office", TEMP, true, { pct: 100, k: 5000, icon: "mdi:desk-lamp" });
    light("light.office_ceiling", "Office Ceiling", "office", DIM, true, { pct: 70, icon: "mdi:ceiling-light" });
    light("light.office_monitor_bar", "Office Monitor Bar", "office", COLOR, true, { pct: 40, hs: [205, 75], icon: "mdi:monitor-shimmer" });
    light("light.kids_room_night_light", "Kids Room Night Light", "kids_room", ["hs"], true, { pct: 12, hs: [36, 80], icon: "mdi:weather-night" });
    light("light.kids_room_ceiling", "Kids Room Ceiling", "kids_room", DIM, false, { icon: "mdi:ceiling-light" });
    light("light.kids_room_star_projector", "Kids Room Star Projector", "kids_room", ["hs"], false, { icon: "mdi:star-four-points" });
    light("light.garden_string", "Garden String Lights", null, ONOFF, true, { icon: "mdi:string-lights" });
    light("light.porch", "Porch Light", null, DIM, false, { icon: "mdi:outdoor-lamp" });

    // ---- switches and helpers
    add("switch.living_room_plug", "on", { friendly_name: "Living Room Plug", icon: "mdi:power-socket-eu" }, { area: "living_room" });
    add("switch.kitchen_coffee", "off", { friendly_name: "Coffee Machine", icon: "mdi:coffee-maker" }, { area: "kitchen" });
    add("input_boolean.movie_mode", "off", { friendly_name: "Movie Mode", icon: "mdi:movie-open" }, {});
    add("input_boolean.guest_mode", "off", { friendly_name: "Guest Mode", icon: "mdi:account-group" }, {});
    add("input_select.house_mode", "Evening", { friendly_name: "House Mode", options: ["Home", "Evening", "Night", "Away", "Movie Night", "Guests"] }, {});
    add("input_select.living_room_scene", "Relax", { friendly_name: "Living Room Scene", options: ["Auto", "Relax", "Reading", "Movie", "Party"] }, { area: "living_room" });
    add("input_select.bedroom_scene", "Auto", { friendly_name: "Bedroom Scene", options: ["Auto", "Wind Down", "Sleep", "Wake Up"] }, { area: "bedroom" });
    add("script.good_night", "off", { friendly_name: "Good Night", icon: "mdi:weather-night" }, {});
    add("script.leave_home", "off", { friendly_name: "Leave Home", icon: "mdi:home-export-outline" }, {});

    // ---- climate
    const ac = { hvac_modes: ["off", "cool", "heat", "fan_only", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan_mode: "auto", min_temp: 16, max_temp: 30, target_temp_step: 0.5, supported_features: 393 };
    add("climate.living_room_ac", "cool", { ...ac, friendly_name: "Living Room AC", temperature: 22, current_temperature: 23.4, current_humidity: 48, hvac_action: "cooling" }, { area: "living_room", changed: 90 * MIN });
    add("climate.bedroom_ac", "off", { ...ac, friendly_name: "Bedroom AC", temperature: 21, current_temperature: 21.8, current_humidity: 52, hvac_action: "off" }, { area: "bedroom", changed: 9 * HOUR });
    add("climate.office_heater", "heat", { friendly_name: "Office Heater", hvac_modes: ["off", "heat"], min_temp: 10, max_temp: 28, target_temp_step: 0.5, temperature: 21.5, current_temperature: 20.4, hvac_action: "heating", supported_features: 385 }, { area: "office", changed: 2 * HOUR });
    add("climate.kids_room_ac", "heat", { ...ac, friendly_name: "Kids Room AC", temperature: 22.5, current_temperature: 22.3, current_humidity: 44, hvac_action: "idle", fan_mode: "low" }, { area: "kids_room", changed: 5 * HOUR });

    // ---- sensors in every room
    const sensor = (id, v, name, area, dc, unit, extra = {}) => add(id, v, { friendly_name: name, device_class: dc, unit_of_measurement: unit, state_class: "measurement", ...extra }, { area });
    const temps = { living_room: 23.6, kitchen: 24.9, dining_room: 23.1, bedroom: 21.5, office: 20.6, kids_room: 22.3 };
    const hums = { living_room: 47, kitchen: 53, dining_room: 49, bedroom: 51, office: 42, kids_room: 45 };
    for (const [a, t] of Object.entries(temps)) {
      sensor(`sensor.${a}_temperature`, t, `${areas[a].name} Temperature`, a, "temperature", "°C");
      sensor(`sensor.${a}_humidity`, hums[a], `${areas[a].name} Humidity`, a, "humidity", "%");
    }
    sensor("sensor.living_room_illuminance", 140, "Living Room Illuminance", "living_room", "illuminance", "lx");
    sensor("sensor.office_co2", 820, "Office CO2", "office", "carbon_dioxide", "ppm");
    add("sensor.outdoor_temperature", 17.2, { friendly_name: "Outdoor Temperature", device_class: "temperature", unit_of_measurement: "°C", state_class: "measurement" }, {});
    add("weather.home", "partlycloudy", { friendly_name: "Home", temperature: 17, humidity: 62, wind_speed: 11 }, {});

    // presence, doors, windows, leaks
    const bin = (id, v, name, area, dc, changed) => add(id, v, { friendly_name: name, device_class: dc }, { area, changed });
    bin("binary_sensor.living_room_presence", "on", "Living Room Presence", "living_room", "occupancy", 12 * MIN);
    bin("binary_sensor.living_room_door", "off", "Living Room Door", "living_room", "door", 47 * MIN);
    bin("binary_sensor.kitchen_motion", "on", "Kitchen Motion", "kitchen", "motion", 3 * MIN);
    bin("binary_sensor.kitchen_leak", "off", "Kitchen Leak", "kitchen", "moisture", 6 * HOUR);
    bin("binary_sensor.dining_room_presence", "off", "Dining Room Presence", "dining_room", "occupancy", 75 * MIN);
    bin("binary_sensor.bedroom_window", "on", "Bedroom Window", "bedroom", "window", 2 * HOUR);
    bin("binary_sensor.bedroom_presence", "off", "Bedroom Presence", "bedroom", "occupancy", 4 * HOUR);
    bin("binary_sensor.office_presence", "on", "Office Presence", "office", "occupancy", 25 * MIN);
    bin("binary_sensor.office_window", "off", "Office Window", "office", "window", 9 * HOUR);
    bin("binary_sensor.kids_room_motion", "off", "Kids Room Motion", "kids_room", "motion", 35 * MIN);
    bin("binary_sensor.kids_room_window", "off", "Kids Room Window", "kids_room", "window", 20 * HOUR);

    // ---- batteries
    const batt = (id, v, name, area) => add(id, v, { friendly_name: name, device_class: "battery", unit_of_measurement: "%" }, { area, category: "diagnostic" });
    batt("sensor.bedroom_window_battery", 9, "Bedroom Window Sensor Battery", "bedroom");
    batt("sensor.kitchen_leak_battery", 64, "Kitchen Leak Sensor Battery", "kitchen");
    batt("sensor.living_room_remote_battery", 88, "Living Room Remote Battery", "living_room");
    batt("sensor.kids_room_motion_battery", 17, "Kids Room Motion Battery", "kids_room");

    // ---- covers
    const cover = (id, v, name, area, dc, pos, feat, tilt) => add(id, v, { friendly_name: name, device_class: dc, current_position: pos, supported_features: feat, ...(tilt != null ? { current_tilt_position: tilt } : {}) }, { area, changed: 3 * HOUR });
    cover("cover.living_room_blind", "open", "Living Room Blind", "living_room", "blind", 60, 207, 40);
    cover("cover.living_room_curtain", "closed", "Living Room Curtain", "living_room", "curtain", 0, 15);
    cover("cover.bedroom_blackout", "closed", "Bedroom Blackout Blind", "bedroom", "shade", 0, 15);
    cover("cover.office_blind", "open", "Office Blind", "office", "blind", 100, 15);
    cover("cover.kids_room_curtain", "open", "Kids Room Curtain", "kids_room", "curtain", 70, 15);
    add("cover.garage_door", "closed", { friendly_name: "Garage Door", device_class: "garage", supported_features: 3 }, { changed: 10 * HOUR });

    // ---- fans and air
    add("fan.bedroom_fan", "on", { friendly_name: "Bedroom Fan", percentage: 60, preset_modes: ["auto", "sleep", "turbo"], preset_mode: "sleep", oscillating: true, supported_features: 11 }, { area: "bedroom" });
    add("fan.bedroom_purifier", "off", { friendly_name: "Bedroom Purifier", preset_modes: ["auto", "sleep"], supported_features: 8 }, { area: "bedroom" });
    add("humidifier.kids_room_humidifier", "on", { friendly_name: "Kids Room Humidifier", humidity: 50, current_humidity: 45, min_humidity: 30, max_humidity: 80, available_modes: ["normal", "eco", "sleep"], mode: "sleep" }, { area: "kids_room" });
    add("fan.office_fan", "off", { friendly_name: "Office Fan", percentage: 0, supported_features: 1 }, { area: "office" });

    // ---- media
    const SF = 21437 | 2048;     // the usual set, and sources
    add("media_player.living_room_tv", "playing", { friendly_name: "Living Room TV", device_class: "tv", media_title: "Slow Horses", media_artist: "Season 4 · Episode 2", app_name: "Apple TV",
      entity_picture: art("#e98a5e", "#2a2350"), volume_level: 0.3, source: "Apple TV", source_list: ["Apple TV", "PlayStation", "HDMI 3"], supported_features: SF }, { area: "living_room", changed: 35 * MIN });
    add("media_player.living_room_soundbar", "on", { friendly_name: "Living Room Soundbar", device_class: "receiver", volume_level: 0.34, supported_features: SF }, { area: "living_room", changed: 35 * MIN });
    add("media_player.kitchen_speaker", "playing", { friendly_name: "Kitchen Speaker", device_class: "speaker", media_title: "So What", media_artist: "Miles Davis", media_album_name: "Kind of Blue",
      entity_picture: art("#4f8fe0", "#101828"), volume_level: 0.25, supported_features: SF }, { area: "kitchen", changed: 8 * MIN });
    add("media_player.bedroom_tv", "off", { friendly_name: "Bedroom TV", device_class: "tv", supported_features: SF }, { area: "bedroom", changed: 11 * HOUR });
    add("media_player.office_speaker", "idle", { friendly_name: "Office Speaker", device_class: "speaker", volume_level: 0.2, supported_features: SF }, { area: "office", changed: 3 * HOUR });
    add("media_player.kids_room_speaker", "paused", { friendly_name: "Kids Room Speaker", device_class: "speaker", media_title: "Twinkle Twinkle", media_artist: "Bedtime Songs",
      entity_picture: art("#f5b83d", "#3a2a55"), volume_level: 0.15, supported_features: SF }, { area: "kids_room", changed: 50 * MIN });

    // ---- scenes: a scene's state is when it last ran
    const scene = (id, name, area, icon, changed = 30 * HOUR) => add(id, ago(changed), { friendly_name: name, ...(icon ? { icon } : {}) }, { area });
    scene("scene.living_room_movie", "Living Room Movie", "living_room", "mdi:movie-open");
    scene("scene.living_room_reading", "Living Room Reading", "living_room", "mdi:book-open-variant");
    scene("scene.living_room_evening", "Living Room Evening", "living_room", "mdi:weather-sunset", 3 * HOUR);
    scene("scene.living_room_bright", "Living Room Bright", "living_room", "mdi:white-balance-sunny");
    scene("scene.kitchen_cooking", "Kitchen Cooking", "kitchen", "mdi:chef-hat");
    scene("scene.kitchen_late_snack", "Kitchen Late Snack", "kitchen", "mdi:weather-night");
    scene("scene.dining_room_dinner", "Dining Room Dinner", "dining_room", "mdi:silverware-fork-knife", 2 * HOUR);
    scene("scene.dining_room_candlelight", "Dining Room Candlelight", "dining_room", "mdi:candle");
    scene("scene.bedroom_wind_down", "Bedroom Wind Down", "bedroom", "mdi:weather-night");
    scene("scene.bedroom_wake_up", "Bedroom Wake Up", "bedroom", "mdi:weather-sunset-up");
    scene("scene.office_focus", "Office Focus", "office", "mdi:target");
    scene("scene.office_calls", "Office Calls", "office", "mdi:video");
    scene("scene.kids_room_bedtime", "Kids Room Bedtime", "kids_room", "mdi:sleep");
    scene("scene.kids_room_play", "Kids Room Play", "kids_room", "mdi:puzzle");
    scene("scene.party", "Party", null, "mdi:party-popper");

    // ---- security: a Nuki-like entrance lock on its own device (no area), a kitchen back door, the alarm
    device("dev_entrance", "Entrance Door", null, { manufacturer: "Nuki", model: "Smart Lock" });
    add("lock.entrance_door", "locked", { friendly_name: "Entrance Door", supported_features: 1, changed_by: "Gabriel" }, { device: "dev_entrance", platform: "nuki", changed: 3 * HOUR });
    add("binary_sensor.entrance_door_contact", "off", { friendly_name: "Entrance Door Contact", device_class: "door" }, { device: "dev_entrance", platform: "nuki", changed: 20 * MIN });
    add("sensor.entrance_door_battery", 84, { friendly_name: "Entrance Door Battery", device_class: "battery", unit_of_measurement: "%" }, { device: "dev_entrance", platform: "nuki", category: "diagnostic" });
    add("lock.back_door", "unlocked", { friendly_name: "Back Door" }, { area: "kitchen", changed: 25 * MIN });
    add("lock.shed", "locked", { friendly_name: "Shed" }, { changed: 30 * HOUR });
    add("alarm_control_panel.home_alarm", "armed_home", { friendly_name: "Home Alarm", supported_features: 15 }, { changed: 5 * HOUR });

    // ---- cameras: three through Frigate, one plain
    add("camera.front_door", "streaming", { friendly_name: "Front Door", entity_picture: still("#9db8d6", "#4b5563", "#2b2f36", "FRONT DOOR") }, { platform: "frigate" });
    add("camera.living_room", "streaming", { friendly_name: "Living Room", entity_picture: still("#f3c98b", "#5b4a3a", "#2d241c", "LIVING ROOM") }, { area: "living_room", platform: "frigate" });
    add("camera.kitchen", "streaming", { friendly_name: "Kitchen", entity_picture: still("#bfe3d0", "#3f5a4c", "#1f2a24", "KITCHEN") }, { area: "kitchen", platform: "frigate" });
    add("camera.garden", "idle", { friendly_name: "Garden", entity_picture: still("#a8c7f0", "#33503a", "#1b2a1e", "GARDEN") }, { platform: "generic" });

    // ---- people
    add("person.alex", "home", { friendly_name: "Alex", source: "device_tracker.alex_phone", entity_picture: face("#5a8fd6"), user_id: "person.alex" }, { changed: 3 * HOUR + 10 * MIN });
    add("device_tracker.alex_phone", "home", { battery_level: 78 }, { device: device("d_alex", "Alex's Phone") });
    add("sensor.alex_phone_battery", 78, { friendly_name: "Alex Phone Battery", device_class: "battery", unit_of_measurement: "%" }, { device: "d_alex", platform: "mobile_app", category: "diagnostic" });
    add("person.sam", "Work", { friendly_name: "Sam", source: "device_tracker.sam_phone", entity_picture: face("#c98bd9"), user_id: "person.sam" }, { changed: 40 * MIN });
    add("device_tracker.sam_phone", "Work", { battery_level: 14 }, {});
    add("zone.work", "1", { friendly_name: "Work", icon: "mdi:briefcase" }, {});
    add("person.jo", "not_home", { friendly_name: "Jo", source: "device_tracker.jo_phone", user_id: "person.jo" }, { changed: 25 * MIN });
    add("device_tracker.jo_phone", "not_home", { battery_level: 56 }, {});
    add("sensor.jo_travel_time", 12, { friendly_name: "Jo Travel Time", unit_of_measurement: "min" }, {});

    // ---- energy
    const energy = { device_class: "energy", state_class: "total_increasing", unit_of_measurement: "kWh" };
    add("sensor.house_energy", "4812.4", { ...energy, friendly_name: "House Energy" }, {});
    add("sensor.kitchen_oven_energy", "612.1", { ...energy, friendly_name: "Oven" }, { area: "kitchen" });
    add("sensor.living_room_tv_energy", "211.8", { ...energy, friendly_name: "TV" }, { area: "living_room" });
    add("sensor.living_room_ac_energy", "980.3", { ...energy, friendly_name: "Living Room AC" }, { area: "living_room" });
    add("sensor.office_heater_energy", "402.6", { ...energy, friendly_name: "Office Heater" }, { area: "office" });
    add("sensor.washer_energy", "140.2", { ...energy, friendly_name: "Washer" }, {});
    add("sensor.house_power", "1420", { friendly_name: "House Power", device_class: "power", unit_of_measurement: "W", state_class: "measurement" }, {});
    add("sensor.energy_cost", "3.47", { friendly_name: "Energy Cost Today", device_class: "monetary", unit_of_measurement: "€", state_class: "total" }, {});

    // ---- a robot vacuum, Roborock-shaped: everything on its device, by translation_key
    device("dev_robot", "Robot", null, { manufacturer: "Roborock", model: "S8" });
    const vac = (id, state, attributes, tk, category) => add(id, state, attributes, { device: "dev_robot", platform: "roborock", tk, category });
    vac("vacuum.robot", "docked", { friendly_name: "Robot", fan_speed: "balanced", fan_speed_list: ["quiet", "balanced", "turbo", "max"], supported_features: 4 | 8 | 16 | 32 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 });
    vac("sensor.robot_status", "charging_complete", { friendly_name: "Status", device_class: "enum" }, "status", "diagnostic");
    vac("sensor.robot_battery", "100", { friendly_name: "Robot Battery", device_class: "battery", unit_of_measurement: "%" }, "battery", "diagnostic");
    vac("sensor.robot_vacuum_error", "none", { friendly_name: "Vacuum error", device_class: "enum" }, "vacuum_error", "diagnostic");
    vac("sensor.robot_last_clean_begin", ago(5 * HOUR), { friendly_name: "Last clean begin", device_class: "timestamp" }, "last_clean_start", "diagnostic");
    vac("sensor.robot_last_clean_end", ago(4 * HOUR), { friendly_name: "Last clean end", device_class: "timestamp" }, "last_clean_end", "diagnostic");
    vac("sensor.robot_filter_time_left", "96", { friendly_name: "Filter time left", device_class: "duration", unit_of_measurement: "h" }, "filter_time_left", "diagnostic");
    vac("sensor.robot_main_brush_time_left", String(212 * 3600), { friendly_name: "Main brush time left", device_class: "duration", unit_of_measurement: "s" }, "main_brush_time_left", "diagnostic");
    vac("binary_sensor.robot_water_shortage", "off", { friendly_name: "Water shortage", device_class: "problem" }, "water_shortage", "diagnostic");
    vac("select.robot_mop_mode", "standard", { friendly_name: "Mop mode", options: ["standard", "deep", "fast"] }, "mop_mode", "config");
    vac("switch.robot_dust_emptying", "off", { friendly_name: "Empty bin" }, "dust_emptying");
    add("button.robot_vacuum", ago(26 * HOUR), { friendly_name: "Robot Vacuum" }, { device: "dev_robot", platform: "roborock" });
    add("button.robot_mop", "unknown", { friendly_name: "Robot Mop" }, { device: "dev_robot", platform: "roborock" });

    // ---- health: Watchman, a Zigbee bridge that dropped, a retrying cloud integration
    add("sensor.watchman_missing_entities", 2, { friendly_name: "Watchman Missing Entities",
      entities: [{ id: "light.old_hallway_lamp", state: "missing", occurrences: "/config/automations.yaml:12" }, { id: "sensor.old_garage_temp", state: "unavail", occurrences: "/config/scenes.yaml:4" }] }, { platform: "watchman" });
    add("sensor.watchman_missing_actions", 1, { friendly_name: "Watchman Missing Actions",
      services: [{ id: "script.old_wake_up", state: "missing", occurrences: "/config/automations.yaml:40" }] }, { platform: "watchman" });
    add("sensor.watchman_last_parse", ago(2 * HOUR), { friendly_name: "Watchman Last Parse", device_class: "timestamp" }, { platform: "watchman", tk: "last_parse", category: "diagnostic" });
    device("dev_z2m_bridge", "Zigbee2MQTT Bridge", null, { entry: "entry_mqtt", manufacturer: "Zigbee2MQTT" });
    add("binary_sensor.z2m_bridge_connection", "on", { friendly_name: "Z2M Bridge Connection", device_class: "connectivity" }, { device: "dev_z2m_bridge", platform: "mqtt" });
    for (const [k, name, area, down] of [["garden_sensor", "Garden Sensor", null, true], ["hall_switch", "Hall Switch", null, true], ["kids_room_button", "Kids Room Button", "kids_room", false]]) {
      device(`dev_z2m_${k}`, name, area, { via: "dev_z2m_bridge", entry: "entry_mqtt", manufacturer: "Aqara" });
      add(`sensor.${k}_state`, down ? "unavailable" : "ok", { friendly_name: `${name} State` }, { device: `dev_z2m_${k}`, platform: "mqtt", changed: 3 * HOUR });
      add(`sensor.${k}_linkquality`, down ? "unavailable" : "112", { friendly_name: `${name} Link Quality` }, { device: `dev_z2m_${k}`, platform: "mqtt", changed: 3 * HOUR });
    }
    for (let i = 1; i <= 3; i++) {
      device(`dev_tuya_${i}`, `Tuya Plug ${i}`, "office", { entry: "entry_tuya", manufacturer: "Tuya" });
      add(`switch.tuya_plug_${i}`, i < 3 ? "unavailable" : "off", { friendly_name: `Tuya Plug ${i}` }, { device: `dev_tuya_${i}`, platform: "tuya", changed: 45 * MIN });
    }
    add("sensor.dining_room_air_quality", "unavailable", { friendly_name: "Dining Room Air Quality" }, { area: "dining_room", changed: 30 * MIN });
    const entries = [
      { entry_id: "entry_mqtt", domain: "mqtt", title: "MQTT", state: "loaded", disabled_by: null },
      { entry_id: "entry_tuya", domain: "tuya", title: "Tuya", state: "setup_retry", disabled_by: null },
    ];

    return { states, entities, devices, areas, entries };
  }

  // h 0..360, s 0..1 -> [r, g, b]: how a lamp asked for a hue shows on screen
  const hsToRgb = (h, s, v = 1) => {
    h = ((h % 360) + 360) % 360;
    const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))); };
    return [f(5), f(3), f(1)];
  };

  window.SavvyDemo = Object.assign(window.SavvyDemo || {}, { makeHouse, hsToRgb, art });
})();
