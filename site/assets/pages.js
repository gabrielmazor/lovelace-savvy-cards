// The demo dashboard: its pages, and on each page the cards, in sections.
//   A page: { id, title, nav (label), icon, sections: [section] }
//   A section: { wide?: true, title?: "...", grid?: n, cards: [[type, config], ...] }
// The home page shows every card in its compact layout; a room page and a domain page show
// them in full. Addresses are query strings (?p=lights), so the site works from any folder of
// any static host, and a refresh lands on the same page.
(() => {
  const D = window.SavvyDemo;

  const ROOMS = [
    { id: "living_room", name: "Living Room" },
    { id: "kitchen", name: "Kitchen" },
    { id: "dining_room", name: "Dining Room" },
    { id: "bedroom", name: "Bedroom" },
    { id: "office", name: "Office" },
    { id: "kids_room", name: "Kids Room" },
  ];
  const slug = (area) => area.replace(/_/g, "-");
  const WATCHMAN = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];

  // what every card on the dashboard shares, held once by the settings card (and found by the cards
  // through the dashboard's own config, as they find it in Home Assistant)
  const SETTINGS = {
    type: "custom:savvy-settings-card",
    pages: { home: "?p=home", lights: "?p=lights", climate: "?p=climate", media: "?p=media", security: "?p=security", health: "?p=health", room: "?p={slug}" },
    house: { control: "input_select.house_mode", weather: "weather.home" },
    health: { watchman: WATCHMAN, battery_threshold: 20 },
    room_order: ROOMS.map((r) => r.id),
    rooms: {
      living_room: { control: "input_select.living_room_scene", temperature: "sensor.living_room_temperature" },
      bedroom: { control: "input_select.bedroom_scene" },
    },
  };

  // ---- what a room has, so its page and the domain pages can be put together
  const ROOM = {
    living_room: { climate: "climate.living_room_ac", media: true, covers: true, cameras: ["camera.living_room"], lights: true, scenes: true, sources: true, vacuum: true },
    kitchen: { media: true, cameras: ["camera.kitchen"], lights: true, scenes: true, lock: "lock.back_door" },
    dining_room: { lights: true, scenes: true },
    bedroom: { climate: "climate.bedroom_ac", media: true, covers: true, fans: true, lights: true, scenes: true },
    office: { climate: "climate.office_heater", media: true, covers: true, fans: true, lights: true, scenes: true },
    kids_room: { climate: "climate.kids_room_ac", media: true, covers: true, fans: true, lights: true, scenes: true },
  };

  // the living room's media, the long way: several sources, and where their sound goes
  const LIVING_SOURCES = {
    name: "Living Room",
    video: [{ entity: "media_player.living_room_tv", name: "TV" }],
    audio: [{ entity: "media_player.living_room_soundbar", name: "Soundbar" }],
    video_output: "media_player.living_room_soundbar",
    presets: [{ entity: "script.good_night", name: "Good night" }],
  };

  function roomPage({ id, name }) {
    const r = ROOM[id];
    const left = [], middle = [], right = [];
    left.push(["savvy-section-title-card", { title: "Lights" }]);
    left.push(["savvy-lights-card", { area: id, ...(id === "living_room" ? { featured: ["light.living_room_ceiling"], chips: [{ entity: "switch.living_room_plug", name: "Plug" }] } : {}) }]);
    if (r.scenes) left.push(["savvy-scene-card", { area: id, title: "Scenes", strip: `^${name}\\s+` }]);
    if (r.climate) {
      middle.push(["savvy-section-title-card", { title: "Climate" }]);
      middle.push(["savvy-climate-card", { entity: r.climate, weather: "weather.home", fan_control: true }]);
    }
    if (r.fans) middle.push(["savvy-fan-card", { area: id }]);
    if (r.covers) middle.push(["savvy-cover-card", { area: id }]);
    middle.push(["savvy-graph-card", { title: "Air", entities: [
      { entity: `sensor.${id}_temperature`, name: "Temperature", thresholds: "temperature" },
      { entity: `sensor.${id}_humidity`, name: "Humidity" }] }]);
    if (r.media) {
      right.push(["savvy-section-title-card", { title: "Media" }]);
      right.push(["savvy-media-card", r.sources ? LIVING_SOURCES : { area: id }]);
    }
    right.push(["savvy-section-title-card", { title: "Activity" }]);
    right.push(["savvy-room-activity-card", { area: id }]);
    if (r.lock) right.push(["savvy-lock-card", { entity: r.lock, alarm: false, camera: false }]);
    if (r.cameras) right.push(["savvy-camera-card", { cameras: r.cameras }]);
    if (r.vacuum) right.push(["savvy-vacuum-card", { entity: "vacuum.robot", start: "button.robot_vacuum" }]);
    return {
      id: slug(id), area: id, title: name, nav: name, group: "rooms",
      sections: [
        { wide: true, cards: [["savvy-room-header-card", { area: id }]] },
        { cards: left }, { cards: middle }, { cards: right },
      ],
    };
  }

  const PAGES = [
    {
      id: "home", title: "Home", nav: "Home", group: "home",
      sections: [
        { wide: true, cards: [["savvy-home-header-card", { aggregate: true }]] },
        { wide: true, grid: 3, cards: ROOMS.map((r) => ["savvy-room-tile", { area: r.id }]) },
        { cards: [
          ["savvy-section-title-card", { title: "Around the house" }],
          ["savvy-people-card", { layout: "compact", title: "Family", people: ["person.alex", "person.sam", { entity: "person.jo", eta: "sensor.jo_travel_time" }] }],
          ["savvy-lights-card", { area: "living_room", layout: "compact" }],
          ["savvy-climate-card", { entity: "climate.living_room_ac", layout: "compact" }],
          ["savvy-scene-card", { area: "living_room", layout: "compact", strip: "^Living Room\\s+" }],
        ] },
        { cards: [
          ["savvy-section-title-card", { title: "Playing" }],
          ["savvy-media-card", { area: "kitchen", layout: "compact" }],
          ["savvy-media-card", { area: "kids_room", layout: "compact" }],
          ["savvy-fan-card", { area: "bedroom", layout: "compact" }],
          ["savvy-cover-card", { area: "living_room", layout: "compact" }],
          ["savvy-vacuum-card", { entity: "vacuum.robot", layout: "compact" }],
        ] },
        { cards: [
          ["savvy-section-title-card", { title: "Before you go" }],
          ["savvy-last-check-card", { mode: "leave", layout: "compact", area: ROOMS.map((r) => r.id) }],
          ["savvy-lock-card", { entities: ["lock.entrance_door", "lock.back_door"], layout: "compact", alarm: false, camera: false }],
          ["savvy-room-activity-card", { area: "living_room", layout: "compact" }],
          ["savvy-energy-card", { layout: "compact", total: "sensor.house_energy", power: "sensor.house_power", price: 0.28, currency: "EUR" }],
          ["savvy-story-card", { layout: "compact", filters: false, max_events: 5 }],
        ] },
      ],
    },
    ...ROOMS.map(roomPage),
    {
      id: "lights", title: "Lights", nav: "Lights", group: "domains",
      sections: [
        { wide: true, cards: [["savvy-home-header-card", { title: "Lights" }]] },
        ...[["living_room", "kitchen"], ["dining_room", "bedroom"], ["office", "kids_room"]].map((pair) => ({
          cards: pair.flatMap((a) => [["savvy-section-title-card", { area: a }], ["savvy-lights-card", { area: a }]]),
        })),
        { cards: [
          ["savvy-section-title-card", { title: "Outside" }],
          ["savvy-lights-card", { title: "Garden", lights: ["light.garden_string", "light.porch"] }],
          ["savvy-scene-card", { title: "Every scene", entities: ["scene.party"], area: ROOMS.map((r) => r.id), strip: "^(Living Room|Kitchen|Dining Room|Bedroom|Office|Kids Room)\\s+" }],
        ] },
      ],
    },
    {
      id: "climate", title: "Climate", nav: "Climate", group: "domains",
      sections: [
        { wide: true, cards: [["savvy-home-header-card", { title: "Climate" }]] },
        { cards: [["savvy-climate-card", { entity: "climate.living_room_ac", weather: "weather.home", fan_control: true }], ["savvy-climate-card", { entity: "climate.bedroom_ac", fan_control: true }]] },
        { cards: [["savvy-climate-card", { entity: "climate.office_heater" }], ["savvy-climate-card", { entity: "climate.kids_room_ac", fan_control: true }]] },
        { cards: [
          ["savvy-graph-card", { title: "Temperature", entities: ROOMS.map((r) => ({ entity: `sensor.${r.id}_temperature`, name: r.name, thresholds: "temperature" })) }],
          ["savvy-fan-card", { area: ["bedroom", "office", "kids_room"], title: "Fans and air" }],
          ["savvy-cover-card", { area: ROOMS.map((r) => r.id), title: "Blinds and curtains" }],
        ] },
      ],
    },
    {
      id: "media", title: "Media", nav: "Media", group: "domains",
      sections: [
        { wide: true, cards: [["savvy-home-header-card", { title: "Media" }]] },
        { cards: [["savvy-media-card", LIVING_SOURCES], ["savvy-media-card", { area: "kitchen" }]] },
        { cards: [["savvy-media-card", { area: "bedroom" }], ["savvy-media-card", { area: "office" }]] },
        { cards: [["savvy-media-card", { area: "kids_room" }], ["savvy-scene-card", { title: "Moods", entities: ["scene.living_room_movie", "scene.party", "scene.dining_room_candlelight", "scene.kids_room_bedtime"] }]] },
      ],
    },
    {
      id: "security", title: "Security", nav: "Security", group: "domains",
      sections: [
        { wide: true, cards: [["savvy-home-header-card", { title: "Security" }]] },
        { cards: [
          ["savvy-lock-card", { entity: "lock.entrance_door", alarm: "alarm_control_panel.home_alarm", camera: "camera.front_door" }],
          ["savvy-lock-card", { entities: ["lock.back_door", "lock.shed"], name: "Other doors", alarm: false, camera: false }],
          ["savvy-people-card", { title: "Family", people: ["person.alex", "person.sam", { entity: "person.jo", eta: "sensor.jo_travel_time" }] }],
        ] },
        { cards: [
          ["savvy-camera-card", { cameras: ["camera.front_door", "camera.living_room", "camera.kitchen", "camera.garden"] }],
          ["savvy-last-check-card", { mode: "leave", area: ROOMS.map((r) => r.id), max_rows: 6 }],
        ] },
        { cards: [
          ["savvy-story-card", { range: "24h" }],
          ...["living_room", "bedroom"].map((a) => ["savvy-room-activity-card", { area: a }]),
        ] },
      ],
    },
    {
      id: "health", title: "Health", nav: "Health", group: "domains",
      sections: [
        { wide: true, cards: [["savvy-home-header-card", { title: "Health" }]] },
        { cards: [["savvy-system-health-card", { watchman: WATCHMAN, max_rows: 12 }]] },
        { cards: [
          ["savvy-energy-card", { total: "sensor.house_energy", consumers: ["sensor.living_room_ac_energy", "sensor.kitchen_oven_energy", "sensor.office_heater_energy", "sensor.living_room_tv_energy", "sensor.washer_energy"], power: "sensor.house_power", price: 0.28, currency: "EUR" }],
          ["savvy-energy-card", { range: "week", by: "room", total: "sensor.house_energy", consumers: ["sensor.living_room_ac_energy", "sensor.kitchen_oven_energy", "sensor.office_heater_energy", "sensor.living_room_tv_energy", "sensor.washer_energy"], price: 0.28, currency: "EUR" }],
        ] },
        { cards: [
          ["savvy-graph-card", { title: "House", entities: [{ entity: "sensor.house_power", name: "Power" }, { entity: "sensor.outdoor_temperature", name: "Outside", thresholds: "temperature" }, { entity: "sensor.energy_cost", name: "Cost today" }, { entity: "sensor.watchman_last_parse", name: "Checked" }] }],
          ["savvy-entity-card", { entity: "person.alex", chips: [{ entity: "switch.living_room_plug", name: "Plug", icon: "mdi:power-plug", color: "blue" }, { entity: "sensor.alex_phone_battery", name: "Phone" }] }],
          ["savvy-settings-card", { ...SETTINGS, type: undefined }],
        ] },
      ],
    },
  ];

  // the dashboard as Home Assistant would describe it: a view per page, the settings card on the home view
  const DASHBOARD = {
    title: "Savvy demo",
    views: PAGES.map((p) => ({ title: p.title, path: p.id, cards: p.id === "home" ? [SETTINGS] : [] })),
  };

  D.ROOMS = ROOMS;
  D.PAGES = PAGES;
  D.DASHBOARD = DASHBOARD;
  D.pageFor = (id) => PAGES.find((p) => p.id === id) || PAGES[0];
})();
