// The demo house: six rooms, the lights, climate, media, locks, cameras, appliances, people,
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

  // What the players play: real titles, a cover drawn for each album or show, and how long each runs.
  // Covers are generated (no artwork is copied): a palette and a composition per album, and its name.
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const cover = (album, [a, b, c], kind = "music") => {
    const h = hash(album), shapes = [];
    for (let i = 0; i < 5; i++) {
      const x = 40 + ((h >> (i * 3)) % 320), y = 40 + ((h >> (i * 5 + 1)) % 260), r = 30 + ((h >> (i * 2 + 2)) % 90);
      shapes.push(`<circle cx='${x}' cy='${y}' r='${r}' fill='${i % 2 ? c : b}' fill-opacity='${0.18 + (i % 3) * 0.1}'/>`);
    }
    const label = album.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const type = kind === "tv"
      ? `<text x='28' y='76' font-family='-apple-system,Segoe UI,Roboto,sans-serif' font-size='40' font-weight='800' letter-spacing='-1.5' fill='#fff'>${label}</text>`
      : `<text x='28' y='48' font-family='-apple-system,Segoe UI,Roboto,sans-serif' font-size='18' font-weight='600' fill='#fff' fill-opacity='.85'>${label}</text>`;
    // the name sits at the top: a card draws its own caption along the bottom of the artwork
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs>
<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient>
<linearGradient id='f' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#000' stop-opacity='.35'/><stop offset='.4' stop-color='#000' stop-opacity='0'/></linearGradient></defs>
<rect width='400' height='400' fill='url(#g)'/>${shapes.join("")}<rect width='400' height='400' fill='url(#f)'/>${type}</svg>`)}`;
  };
  const track = (title, artist, album, dur, palette, extra = {}) => ({ title, artist, album, dur, art: cover(album, palette, extra.kind), ...extra });
  const KOB = ["#1f4e8c", "#0b1a2e", "#6fa8dc"], TIMEOUT = ["#d9472b", "#2a1a12", "#f2c14e"], GIANT = ["#e8b43a", "#1e1a14", "#c0392b"];
  const DEBBY = ["#7b5ea7", "#1b1430", "#c9b8e8"], APOLLO = ["#0e1b2c", "#03060c", "#5b7db1"], AIRPORTS = ["#dcd6c8", "#7d7a70", "#ffffff"];
  const SPACES = ["#2f3e46", "#0f1416", "#84a98c"], BLUE = ["#2b4c7e", "#0d1b2a", "#a9c7e8"], LULL = ["#f5b83d", "#3a2a55", "#ffd9a0"];
  const PLAYLISTS = {
    "media_player.living_room_streamer": [
      track("Good News About Hell", "Severance · Season 1, Episode 1", "Severance", 3360, ["#2c6e8f", "#0a1a24", "#bfe3f0"], { kind: "tv", app: "Apple TV+" }),
      track("Failure's Contagious", "Slow Horses · Season 1, Episode 1", "Slow Horses", 2880, ["#6b705c", "#1c1d18", "#d4a373"], { kind: "tv", app: "Apple TV+" }),
      track("System", "The Bear · Season 1, Episode 1", "The Bear", 1680, ["#1d3557", "#0b0f19", "#e63946"], { kind: "tv", app: "Hulu" }),
      track("Anjin", "Shōgun · Episode 1", "Shōgun", 4200, ["#7f1d1d", "#120606", "#f5d0a9"], { kind: "tv", app: "Hulu" }),
      track("Pilot", "Ted Lasso · Season 1, Episode 1", "Ted Lasso", 1800, ["#f2c14e", "#1f4e8c", "#ffffff"], { kind: "tv", app: "Apple TV+" }),
    ],
    "media_player.kitchen_speaker": [
      track("So What", "Miles Davis", "Kind of Blue", 562, KOB),
      track("Blue in Green", "Miles Davis", "Kind of Blue", 337, KOB),
      track("Take Five", "The Dave Brubeck Quartet", "Time Out", 324, TIMEOUT),
      track("Naima", "John Coltrane", "Giant Steps", 261, GIANT),
      track("Waltz for Debby", "Bill Evans Trio", "Waltz for Debby", 420, DEBBY),
      track("Freddie Freeloader", "Miles Davis", "Kind of Blue", 586, KOB),
    ],
    "media_player.bedroom_speaker": [
      track("An Ending (Ascent)", "Brian Eno", "Apollo", 266, APOLLO),
      track("1/1", "Brian Eno", "Ambient 1: Music for Airports", 1021, AIRPORTS),
      track("Says", "Nils Frahm", "Spaces", 529, SPACES),
      track("On the Nature of Daylight", "Max Richter", "The Blue Notebooks", 380, BLUE),
    ],
    "media_player.bathroom_speaker": [
      track("Here Comes the Sun", "The Beatles", "Abbey Road", 185, ["#3d6b8f", "#14202b", "#f2d16b"]),
      track("Lovely Day", "Bill Withers", "Menagerie", 254, ["#d98b3a", "#2a1a0e", "#f5e1b8"]),
      track("Dreams", "Fleetwood Mac", "Rumours", 257, ["#8a7a6a", "#1e1a16", "#e8dccb"]),
      track("September", "Earth, Wind & Fire", "The Best of Earth, Wind & Fire", 215, ["#c0392b", "#1a0b08", "#f1c40f"]),
    ],
    "media_player.bedroom_tv": [
      track("The Dundies", "The Office · Season 2, Episode 1", "The Office", 1320, ["#4a6fa5", "#141c2b", "#e0e6ef"], { kind: "tv", app: "Peacock" }),
      track("Diversity Day", "The Office · Season 1, Episode 2", "The Office", 1320, ["#4a6fa5", "#141c2b", "#e0e6ef"], { kind: "tv", app: "Peacock" }),
    ],
  };
  // the attributes a player shows for a track, at a position (seconds)
  const nowPlaying = (t, position = 0) => ({
    media_title: t.title, media_artist: t.artist, media_album_name: t.kind === "tv" ? undefined : t.album, media_series_title: t.kind === "tv" ? t.album : undefined,
    media_content_type: t.kind === "tv" ? "tvshow" : "music", app_name: t.app, entity_picture: t.art,
    media_duration: t.dur, media_position: position, media_position_updated_at: new Date().toISOString(),
  });

  // the rooms, in the order the dashboard lists them
  const ROOM_LIST = [
    ["living_room", "Living Room", "mdi:sofa"], ["kitchen", "Kitchen", "mdi:silverware-fork-knife"], ["office", "Office", "mdi:desk"],
    ["bedroom", "Bedroom", "mdi:bed-king"], ["bathroom", "Bathroom", "mdi:shower"], ["toilet", "Toilet", "mdi:toilet"],
  ];

  function makeHouse() {
    const states = {}, entities = {}, devices = {};
    const areas = Object.fromEntries(ROOM_LIST.map(([area_id, name, icon]) => [area_id, { area_id, name, icon }]));

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
      if (o.members) a.entity_id = o.members;
      if (on) {
        if (modes.includes("onoff")) a.color_mode = "onoff";
        else {
          a.brightness = Math.round((o.pct ?? 70) * 2.55);
          if (o.hs && modes.includes("hs")) { a.color_mode = "hs"; a.hs_color = o.hs; a.rgb_color = window.SavvyDemo.hsToRgb(o.hs[0], o.hs[1] / 100); }
          else if (modes.includes("color_temp")) { a.color_mode = "color_temp"; a.color_temp_kelvin = o.k ?? 2700; }
          else a.color_mode = "brightness";
        }
      }
      add(id, on ? "on" : "off", a, { area, changed: o.changed ?? 50 * MIN, hidden: o.hidden });
    };
    // living room: six, one of them a group of two sconces
    light("light.living_room_ceiling", "Living Room Ceiling", "living_room", COLOR, true, { pct: 78, k: 3000, icon: "mdi:ceiling-light" });
    light("light.living_room_arc_lamp", "Living Room Arc Lamp", "living_room", TEMP, true, { pct: 35, k: 2400, icon: "mdi:floor-lamp" });
    light("light.living_room_sconce_left", "Living Room Sconce Left", "living_room", DIM, true, { pct: 45, icon: "mdi:wall-sconce-round", hidden: true });
    light("light.living_room_sconce_right", "Living Room Sconce Right", "living_room", DIM, true, { pct: 45, icon: "mdi:wall-sconce-round", hidden: true });
    light("light.living_room_sconces", "Living Room Sconces", "living_room", DIM, true, { pct: 45, icon: "mdi:wall-sconce-round", members: ["light.living_room_sconce_left", "light.living_room_sconce_right"] });
    light("light.living_room_light_bar", "Living Room Light Bar", "living_room", COLOR, false, { icon: "mdi:led-strip" });
    light("light.living_room_tv_glow", "Living Room TV Glow", "living_room", ["hs"], true, { pct: 55, hs: [268, 70], icon: "mdi:television-ambient-light" });
    light("light.living_room_candle", "Living Room Candle", "living_room", ONOFF, true, { icon: "mdi:candle" });
    // kitchen: five, in the order the dashboard asks for
    light("light.kitchen_ceiling", "Kitchen Ceiling", "kitchen", ONOFF, true, { icon: "mdi:ceiling-light" });
    light("light.kitchen_pendant", "Kitchen Pendant", "kitchen", TEMP, true, { pct: 90, k: 3500, icon: "mdi:ceiling-light-multiple" });
    light("light.kitchen_passage", "Kitchen Passage", "kitchen", DIM, false, { icon: "mdi:track-light" });
    light("light.kitchen_counter_strip", "Kitchen Counter Strip", "kitchen", ["hs"], true, { pct: 60, hs: [32, 55], icon: "mdi:led-strip" });
    light("light.kitchen_plinth", "Kitchen Plinth", "kitchen", ["hs"], false, { icon: "mdi:led-strip-variant" });
    // office: six, one a group of shelf lamps
    light("light.office_ceiling", "Office Ceiling", "office", DIM, true, { pct: 70, icon: "mdi:ceiling-light" });
    light("light.office_shelf_lamp_1", "Office Shelf Lamp 1", "office", TEMP, true, { pct: 50, k: 2700, icon: "mdi:lamp", hidden: true });
    light("light.office_shelf_lamp_2", "Office Shelf Lamp 2", "office", TEMP, true, { pct: 50, k: 2700, icon: "mdi:lamp", hidden: true });
    light("light.office_shelf_lamps", "Office Shelf Lamps", "office", TEMP, true, { pct: 50, k: 2700, icon: "mdi:bookshelf", members: ["light.office_shelf_lamp_1", "light.office_shelf_lamp_2"] });
    light("light.office_screen_glow", "Office Screen Glow", "office", COLOR, true, { pct: 40, hs: [205, 75], icon: "mdi:monitor-shimmer" });
    light("light.office_desk_strip", "Office Desk Strip", "office", ["hs"], true, { pct: 30, hs: [300, 60], icon: "mdi:led-strip-variant" });
    light("light.office_task_lamp", "Office Task Lamp", "office", TEMP, true, { pct: 100, k: 5000, icon: "mdi:desk-lamp" });
    light("light.office_key_light", "Office Key Light", "office", TEMP, false, { icon: "mdi:spotlight-beam" });
    // bedroom: three
    light("light.bedroom_ceiling", "Bedroom Ceiling", "bedroom", DIM, false, { icon: "mdi:ceiling-light" });
    light("light.bedroom_left_bedside", "Bedroom Left Bedside", "bedroom", TEMP, true, { pct: 22, k: 2200, icon: "mdi:lamp" });
    light("light.bedroom_right_bedside", "Bedroom Right Bedside", "bedroom", TEMP, false, { icon: "mdi:lamp" });
    // bathroom and toilet
    light("light.bathroom_ceiling", "Bathroom Ceiling", "bathroom", ONOFF, false, { icon: "mdi:ceiling-light" });
    light("light.bathroom_mirror", "Bathroom Mirror", "bathroom", TEMP, true, { pct: 80, k: 4000, icon: "mdi:mirror-rectangle" });
    light("light.bathroom_night_strip", "Bathroom Night Strip", "bathroom", ["hs"], false, { icon: "mdi:led-strip" });
    light("light.toilet_ceiling", "Toilet Ceiling", "toilet", ONOFF, false, { icon: "mdi:ceiling-light" });
    light("light.toilet_night_light", "Toilet Night Light", "toilet", DIM, true, { pct: 15, icon: "mdi:weather-night" });

    // ---- helpers: the house's mode and each room's, and whether a room's lights run themselves
    add("input_select.home_mode", "Evening", { friendly_name: "Home Mode", options: ["Home", "Evening", "Night", "Away", "Guests"] }, {});
    const MODES = { living_room: ["Auto", "Relax", "Movie", "Reading", "Party"], kitchen: ["Auto", "Cooking", "Dinner", "Clean"], office: ["Auto", "Focus", "Calls", "Off"],
      bedroom: ["Auto", "Wind Down", "Sleep", "Wake Up"], bathroom: ["Auto", "Bright", "Night"], toilet: ["Auto", "Night"] };
    const NOW = { living_room: "Movie", kitchen: "Auto", office: "Focus", bedroom: "Wind Down", bathroom: "Auto", toilet: "Night" };
    for (const [a, name] of ROOM_LIST) {
      add(`input_select.${a}_mode`, NOW[a], { friendly_name: `${name} Mode`, options: MODES[a] }, { area: a });
      add(`input_boolean.${a}_auto_lights`, a === "bathroom" ? "off" : "on", { friendly_name: `${name} Auto Lights`, icon: "mdi:lightbulb-auto" }, { area: a });
    }
    add("input_boolean.living_room_screen_sync", "on", { friendly_name: "Screen Sync", icon: "mdi:television-ambient-light" }, { area: "living_room" });
    add("input_button.kitchen_radio_jazz", ago(20 * HOUR), { friendly_name: "Jazz Radio", icon: "mdi:radio" }, { area: "kitchen" });
    add("input_button.kitchen_radio_news", ago(30 * HOUR), { friendly_name: "Morning News", icon: "mdi:radio" }, { area: "kitchen" });

    // ---- climate: three ACs; the bedroom's has a sleep timer
    const ac = { hvac_modes: ["off", "cool", "heat", "fan_only", "dry", "auto"], fan_modes: ["low", "medium", "high", "auto"], fan_mode: "auto", min_temp: 16, max_temp: 30, target_temp_step: 0.5, supported_features: 393 };
    add("climate.living_room_ac", "cool", { ...ac, friendly_name: "Living Room AC", temperature: 22, current_temperature: 23.4, current_humidity: 48, hvac_action: "cooling" }, { area: "living_room", changed: 90 * MIN });
    add("climate.office_ac", "heat", { ...ac, friendly_name: "Office AC", temperature: 21.5, current_temperature: 20.6, current_humidity: 42, hvac_action: "heating", fan_mode: "low" }, { area: "office", changed: 2 * HOUR });
    add("climate.bedroom_ac", "off", { ...ac, friendly_name: "Bedroom AC", temperature: 21, current_temperature: 21.8, current_humidity: 52, hvac_action: "off" }, { area: "bedroom", changed: 9 * HOUR });
    add("timer.bedroom_ac_sleep", "idle", { friendly_name: "Bedroom AC Sleep", duration: "1:00:00", icon: "mdi:timer-outline" }, { area: "bedroom" });
    add("input_select.bedroom_ac_sleep_length", "1 hour", { friendly_name: "Bedroom AC Sleep Length", options: ["30 minutes", "1 hour", "2 hours", "4 hours", "8 hours"] }, { area: "bedroom" });

    // ---- sensors in every room
    const sensor = (id, v, name, area, dc, unit, extra = {}) => add(id, v, { friendly_name: name, device_class: dc, unit_of_measurement: unit, state_class: "measurement", ...extra }, { area });
    const temps = { living_room: 23.6, kitchen: 24.9, office: 20.6, bedroom: 21.5, bathroom: 24.2, toilet: 22.8 };
    const hums = { living_room: 47, kitchen: 53, office: 42, bedroom: 51, bathroom: 68, toilet: 55 };
    for (const [a, t] of Object.entries(temps)) {
      sensor(`sensor.${a}_temperature`, t, `${areas[a].name} Temperature`, a, "temperature", "°C");
      sensor(`sensor.${a}_humidity`, hums[a], `${areas[a].name} Humidity`, a, "humidity", "%");
    }
    sensor("sensor.living_room_ac_room_temperature", 23.4, "Living Room AC Room Temperature", "living_room", "temperature", "°C");
    add("sensor.outdoor_temperature", 17.2, { friendly_name: "Outdoor Temperature", device_class: "temperature", unit_of_measurement: "°C", state_class: "measurement" }, {});
    add("weather.home", "partlycloudy", { friendly_name: "Home", temperature: 17, humidity: 62, wind_speed: 11 }, {});

    // presence, doors, windows, leaks
    const bin = (id, v, name, area, dc, changed) => add(id, v, { friendly_name: name, device_class: dc }, { area, changed });
    bin("binary_sensor.living_room_presence", "on", "Living Room Presence", "living_room", "occupancy", 12 * MIN);
    bin("binary_sensor.living_room_balcony_door", "off", "Living Room Balcony Door", "living_room", "door", 47 * MIN);
    bin("binary_sensor.kitchen_motion", "on", "Kitchen Motion", "kitchen", "motion", 3 * MIN);
    bin("binary_sensor.kitchen_leak", "off", "Kitchen Leak", "kitchen", "moisture", 6 * HOUR);
    bin("binary_sensor.office_presence", "on", "Office Presence", "office", "occupancy", 25 * MIN);
    bin("binary_sensor.office_window", "off", "Office Window", "office", "window", 9 * HOUR);
    bin("binary_sensor.bedroom_window", "on", "Bedroom Window", "bedroom", "window", 2 * HOUR);
    bin("binary_sensor.bedroom_presence", "off", "Bedroom Presence", "bedroom", "occupancy", 4 * HOUR);
    bin("binary_sensor.bathroom_motion", "off", "Bathroom Motion", "bathroom", "motion", 35 * MIN);
    bin("binary_sensor.bathroom_leak", "off", "Bathroom Leak", "bathroom", "moisture", 20 * HOUR);
    bin("binary_sensor.toilet_motion", "off", "Toilet Motion", "toilet", "motion", 15 * MIN);

    // ---- batteries
    const batt = (id, v, name, area) => add(id, v, { friendly_name: name, device_class: "battery", unit_of_measurement: "%" }, { area, category: "diagnostic" });
    batt("sensor.bedroom_window_battery", 9, "Bedroom Window Sensor Battery", "bedroom");
    batt("sensor.kitchen_leak_battery", 64, "Kitchen Leak Sensor Battery", "kitchen");
    batt("sensor.living_room_remote_battery", 88, "Living Room Remote Battery", "living_room");
    batt("sensor.bathroom_motion_battery", 17, "Bathroom Motion Battery", "bathroom");

    // ---- media: the living room's streamer, console and TV play through the soundbar; the TV is an LG
    const SF = 21437 | 2048 | 2;     // the usual set, sources, and seek
    const P = PLAYLISTS;
    add("media_player.living_room_streamer", "playing", { friendly_name: "Living Room Streamer", device_class: "tv", ...nowPlaying(P["media_player.living_room_streamer"][0], 1260),
      volume_level: 0.3, supported_features: SF }, { area: "living_room", changed: 35 * MIN });
    add("media_player.living_room_console", "off", { friendly_name: "Living Room Console", volume_level: 0.5, supported_features: SF }, { area: "living_room", changed: 20 * HOUR });
    add("media_player.living_room_tv", "on", { friendly_name: "Living Room TV", device_class: "tv", volume_level: 0.12, sound_output: "external_arc", source: "HDMI 1",
      source_list: ["HDMI 1", "HDMI 2", "Live TV"], supported_features: SF }, { area: "living_room", platform: "webostv", changed: 35 * MIN });
    add("media_player.living_room_soundbar", "on", { friendly_name: "Living Room Soundbar", device_class: "receiver", volume_level: 0.34, sound_mode: "Movie", supported_features: SF }, { area: "living_room", changed: 35 * MIN });
    add("media_player.kitchen_speaker", "playing", { friendly_name: "Kitchen Speaker", device_class: "speaker", ...nowPlaying(P["media_player.kitchen_speaker"][0], 96),
      volume_level: 0.25, supported_features: SF }, { area: "kitchen", changed: 8 * MIN });
    add("media_player.bedroom_streamer", "off", { friendly_name: "Bedroom Streamer", device_class: "tv", volume_level: 0.2, supported_features: SF }, { area: "bedroom", changed: 11 * HOUR });
    add("media_player.bedroom_tv", "off", { friendly_name: "Bedroom TV", device_class: "tv", volume_level: 0.18, supported_features: SF }, { area: "bedroom", changed: 11 * HOUR });
    add("media_player.bedroom_speaker", "paused", { friendly_name: "Bedroom Speaker", device_class: "speaker", ...nowPlaying(P["media_player.bedroom_speaker"][0], 62),
      volume_level: 0.15, supported_features: SF }, { area: "bedroom", changed: 50 * MIN });
    add("media_player.bathroom_speaker", "idle", { friendly_name: "Bathroom Speaker", device_class: "speaker", volume_level: 0.3, supported_features: SF }, { area: "bathroom", changed: 3 * HOUR });

    // ---- scenes: a scene's state is when it last ran
    const scene = (id, name, area, icon, changed = 30 * HOUR) => add(id, ago(changed), { friendly_name: name, ...(icon ? { icon } : {}) }, { area });
    scene("scene.living_room_movie", "Movie", "living_room", "mdi:movie-open", 40 * MIN);
    scene("scene.living_room_reading", "Reading", "living_room", "mdi:book-open-variant");
    scene("scene.living_room_evening", "Evening", "living_room", "mdi:weather-sunset", 3 * HOUR);
    scene("scene.living_room_bright", "Bright", "living_room", "mdi:white-balance-sunny");
    scene("scene.office_focus", "Focus", "office", "mdi:target", 2 * HOUR);
    scene("scene.office_calls", "Calls", "office", "mdi:video");
    scene("scene.office_evening", "Evening", "office", "mdi:weather-sunset");

    // ---- security: a smart lock on its own device (no area), the alarm, a plug that powers the lock's bridge
    device("dev_front_door", "Front Door", null, { manufacturer: "Lockly", model: "Smart Lock" });
    add("lock.front_door", "locked", { friendly_name: "Front Door", supported_features: 1, changed_by: "Maya" }, { device: "dev_front_door", platform: "demo_lock", changed: 3 * HOUR });
    add("binary_sensor.front_door_contact", "off", { friendly_name: "Front Door Contact", device_class: "door" }, { device: "dev_front_door", platform: "demo_lock", changed: 20 * MIN });
    add("sensor.front_door_battery", 84, { friendly_name: "Front Door Battery", device_class: "battery", unit_of_measurement: "%" }, { device: "dev_front_door", platform: "demo_lock", category: "diagnostic" });
    add("switch.lock_bridge_plug", "on", { friendly_name: "Lock Bridge Plug", icon: "mdi:power-plug" }, {});
    add("alarm_control_panel.home_alarm", "armed_home", { friendly_name: "Alarm", supported_features: 15 }, { changed: 5 * HOUR });
    add("sensor.people_home", 2, { friendly_name: "People Home", icon: "mdi:home-account", state_class: "measurement" }, {});
    add("sensor.people_asleep", 0, { friendly_name: "People Asleep", icon: "mdi:sleep", state_class: "measurement" }, {});

    // ---- cameras: two through Frigate
    add("camera.living_room", "streaming", { friendly_name: "Living Room", entity_picture: still("#f3c98b", "#5b4a3a", "#2d241c", "LIVING ROOM") }, { area: "living_room", platform: "frigate" });
    add("camera.kitchen", "streaming", { friendly_name: "Kitchen", entity_picture: still("#bfe3d0", "#3f5a4c", "#1f2a24", "KITCHEN") }, { area: "kitchen", platform: "frigate" });
    bin("binary_sensor.living_room_camera_person", "off", "Living Room Camera Person", "living_room", "occupancy", 70 * MIN);
    bin("binary_sensor.kitchen_camera_motion", "on", "Kitchen Camera Motion", "kitchen", "motion", 2 * MIN);

    // ---- people
    add("person.maya", "home", { friendly_name: "Maya", source: "device_tracker.maya_phone", entity_picture: face("#5a8fd6"), user_id: "person.maya" }, { changed: 3 * HOUR + 10 * MIN });
    add("device_tracker.maya_phone", "home", { battery_level: 78 }, { device: device("d_maya", "Maya's Phone") });
    add("person.ben", "home", { friendly_name: "Ben", source: "device_tracker.ben_phone", entity_picture: face("#c98bd9"), user_id: "person.ben" }, { changed: 40 * MIN });
    add("device_tracker.ben_phone", "home", { battery_level: 41 }, {});

    // ---- appliances: on / off cycles, plugs, a kettle, and what each costs a month
    bin("binary_sensor.washer_running", "on", "Washer", "bathroom", "running", 35 * MIN);
    bin("binary_sensor.dishwasher_running", "off", "Dishwasher", "kitchen", "running", 4 * HOUR);
    add("switch.kitchen_bug_zapper", "on", { friendly_name: "Bug Zapper", icon: "mdi:bug" }, { area: "kitchen", changed: 6 * HOUR });
    add("switch.water_heater", "off", { friendly_name: "Water Heater", icon: "mdi:water-boiler" }, { area: "bathroom", changed: 2 * HOUR });
    add("button.kettle_boil", ago(9 * HOUR), { friendly_name: "Kettle Boil" }, { area: "kitchen" });
    add("switch.bike_charger_1", "on", { friendly_name: "Bike Charger 1", icon: "mdi:bicycle-electric" }, { area: "office", changed: 3 * HOUR });
    add("switch.bike_charger_2", "off", { friendly_name: "Bike Charger 2", icon: "mdi:bicycle-electric" }, { area: "office", changed: 26 * HOUR });
    const cost = (id, v, name, area, icon) => add(id, v, { friendly_name: name, device_class: "monetary", unit_of_measurement: "€", state_class: "total", icon }, { area });
    cost("sensor.dishwasher_monthly_cost", "6.80", "Dishwasher Monthly Cost", "kitchen", "mdi:dishwasher");
    cost("sensor.washer_monthly_cost", "9.40", "Washer Monthly Cost", "bathroom", "mdi:washing-machine");
    cost("sensor.water_heater_monthly_cost", "27.10", "Water Heater Monthly Cost", "bathroom", "mdi:water-boiler");
    cost("sensor.bike_charger_monthly_cost", "3.20", "Bike Charger Monthly Cost", "office", "mdi:bicycle-electric");
    cost("sensor.next_electricity_bill", "214.60", "Next Electricity Bill", null, "mdi:flash");
    cost("sensor.next_water_bill", "62.30", "Next Water Bill", null, "mdi:water");

    // ---- energy: the meter since the last bill, and what each appliance used
    const energy = { device_class: "energy", state_class: "total_increasing", unit_of_measurement: "kWh" };
    add("sensor.grid_since_last_bill", "612.4", { ...energy, friendly_name: "Grid Since Last Bill" }, {});
    add("sensor.grid_meter_reading", "48120.7", { ...energy, friendly_name: "Grid Meter Reading" }, {});
    add("sensor.living_room_ac_energy", "980.3", { ...energy, friendly_name: "Living Room AC" }, { area: "living_room" });
    add("sensor.office_ac_energy", "402.6", { ...energy, friendly_name: "Office AC" }, { area: "office" });
    add("sensor.bedroom_ac_energy", "355.0", { ...energy, friendly_name: "Bedroom AC" }, { area: "bedroom" });
    add("sensor.water_heater_energy", "720.9", { ...energy, friendly_name: "Water Heater" }, { area: "bathroom" });
    add("sensor.dishwasher_energy", "181.2", { ...energy, friendly_name: "Dishwasher" }, { area: "kitchen" });
    add("sensor.washer_energy", "140.2", { ...energy, friendly_name: "Washer" }, { area: "bathroom" });
    add("sensor.bike_charger_energy", "64.5", { ...energy, friendly_name: "Bike Charger" }, { area: "office" });
    add("sensor.house_power", "1420", { friendly_name: "House Power", device_class: "power", unit_of_measurement: "W", state_class: "measurement" }, {});

    // ---- the server: connectivity, uptime and how hard it is working
    bin("binary_sensor.internet", "on", "Internet", null, "connectivity", 3 * 24 * HOUR);
    bin("binary_sensor.cloud_link", "on", "Cloud Link", null, "connectivity", 30 * HOUR);
    add("sensor.uptime", ago(2 * 24 * HOUR + 5 * HOUR), { friendly_name: "Uptime", device_class: "timestamp" }, {});
    add("sensor.last_boot", ago(9 * 24 * HOUR), { friendly_name: "Last Boot", device_class: "timestamp" }, {});
    const sys = (id, v, name, unit, dc) => add(id, v, { friendly_name: name, unit_of_measurement: unit, state_class: "measurement", ...(dc ? { device_class: dc } : {}) }, { category: "diagnostic" });
    sys("sensor.server_cpu", 23, "Server CPU", "%");
    sys("sensor.server_memory", 4.1, "Server Memory", "GiB", "data_size");
    sys("sensor.server_load_5m", 0.9, "Server Load (5m)", "");
    sys("sensor.server_swap", 3, "Server Swap", "%");
    sys("sensor.server_cpu_temperature", 52, "Server CPU Temperature", "°C", "temperature");
    sys("sensor.server_disk", 96.4, "Server Disk", "GiB", "data_size");

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
    add("sensor.watchman_last_report", ago(2 * HOUR), { friendly_name: "Watchman Last Report", device_class: "timestamp" }, { platform: "watchman", tk: "last_parse", category: "diagnostic" });
    device("dev_z2m_bridge", "Zigbee2MQTT Bridge", null, { entry: "entry_mqtt", manufacturer: "Zigbee2MQTT" });
    add("binary_sensor.z2m_bridge_connection", "on", { friendly_name: "Z2M Bridge Connection", device_class: "connectivity" }, { device: "dev_z2m_bridge", platform: "mqtt" });
    for (const [k, name, area, down] of [["balcony_sensor", "Balcony Sensor", null, true], ["hall_switch", "Hall Switch", null, true], ["bathroom_button", "Bathroom Button", "bathroom", false]]) {
      device(`dev_z2m_${k}`, name, area, { via: "dev_z2m_bridge", entry: "entry_mqtt", manufacturer: "Aqara" });
      add(`sensor.${k}_state`, down ? "unavailable" : "ok", { friendly_name: `${name} State` }, { device: `dev_z2m_${k}`, platform: "mqtt", changed: 3 * HOUR });
      add(`sensor.${k}_linkquality`, down ? "unavailable" : "112", { friendly_name: `${name} Link Quality` }, { device: `dev_z2m_${k}`, platform: "mqtt", changed: 3 * HOUR });
    }
    for (let i = 1; i <= 3; i++) {
      device(`dev_tuya_${i}`, `Smart Plug ${i}`, "office", { entry: "entry_tuya", manufacturer: "Tuya" });
      add(`switch.smart_plug_${i}`, i < 3 ? "unavailable" : "off", { friendly_name: `Smart Plug ${i}` }, { device: `dev_tuya_${i}`, platform: "tuya", changed: 45 * MIN });
    }
    add("sensor.toilet_air_quality", "unavailable", { friendly_name: "Toilet Air Quality" }, { area: "toilet", changed: 30 * MIN });
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

  window.SavvyDemo = Object.assign(window.SavvyDemo || {}, { makeHouse, hsToRgb, art, PLAYLISTS, nowPlaying, ROOM_LIST });
})();
