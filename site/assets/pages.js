// The demo dashboard, laid out the way a real one is: Home Assistant "sections" views of up to three
// columns. Every page here is a view, every block a section, in the same order and with the same
// options a real home's dashboard uses; only the devices are made up.
//   A page:    { id, title, nav, group, max_columns, sections: [section] }
//   A section: { column_span?: n, cards: [[type, config], ...] }   config.grid_options as in Home Assistant
// Addresses are query strings (?p=lights), so the site works from any folder of any static host, and a
// refresh lands on the same page.
(() => {
  const D = window.SavvyDemo;

  const ROOMS = D.ROOM_LIST.map(([id, name, icon]) => ({ id, name, icon }));
  const slug = (area) => area.replace(/_/g, "-");
  const page = (p) => `?p=${p}`;
  const WATCHMAN = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
  const MODES = ["off", "cool", "heat"];
  const subtitle = (name, to) => ["savvy-section-title-card", { name, heading_style: "subtitle", ...(to ? { navigation_path: page(to) } : {}) }];

  // what every card on the dashboard shares, held once by the settings card (and found by the cards
  // through the dashboard's own config, as they find it in Home Assistant)
  const SETTINGS = {
    type: "custom:savvy-settings-card",
    pages: { home: page("home"), lights: page("lights"), climate: page("climate"), media: page("media"), security: page("security"), health: page("admin"), room: page("{slug}") },
    house: { control: "input_select.home_mode", weather: "weather.home", security: "lock.front_door", tap: "list" },
    health: { watchman: WATCHMAN, battery_threshold: 20, warn_above: 10, group_by: "hub", watchman_last_run: "sensor.watchman_last_report" },
    ignore: { entities: ["binary_sensor.living_room_camera_person", "binary_sensor.kitchen_camera_motion"] },
    room_order: ROOMS.map((r) => r.id),
    rooms: Object.fromEntries(ROOMS.map((r) => [r.id, {
      page: page(slug(r.id)), control: `input_select.${r.id}_mode`, light_state: `input_boolean.${r.id}_auto_lights`,
      ...(r.id === "living_room" ? { temperature: "sensor.living_room_ac_room_temperature" } : {}),
    }])),
    layout: "full",
    aggregate: ["presence"],
    admin_only: ["health_badges"],
    design: { state_glow: true, animations: true },
  };

  // ---- the media of each room, as the dashboard describes it
  const LIVING_MEDIA = {
    area: "living_room",
    video: [
      { entity: "media_player.living_room_streamer", icon: "mdi:apple" },
      { entity: "media_player.living_room_console", icon: "mdi:sony-playstation" },
      { entity: "media_player.living_room_tv" },
    ],
    video_output: "media_player.living_room_soundbar",
    audio: [{ entity: "media_player.living_room_soundbar", name: "Soundbar", icon: "mdi:soundbar" }],
    volume_step: 1,
    labels: {},
    name: "Media",
  };
  const BEDROOM_MEDIA = {
    area: "bedroom", name: "Media", volume_step: 1,
    video: [{ entity: "media_player.bedroom_streamer", icon: "mdi:apple" }, { entity: "media_player.bedroom_tv" }],
    video_output: "media_player.bedroom_tv",
    audio: [{ entity: "media_player.bedroom_speaker" }],
  };
  const SCREEN_SYNC = [{ entity: "input_boolean.living_room_screen_sync", icon: "mdi:lightbulb-auto", name: "Screen sync", show_state: false }];
  const speak = (player) => ({ action: "tts.speak", data: { message: "$MSG", media_player_entity_id: player, entity_id: "tts.home_cloud" } });

  // ---- the lights of each room, in the order the dashboard keeps them
  const ORDER = {
    living_room: ["light.living_room_ceiling", "light.living_room_arc_lamp", "light.living_room_sconces", "light.living_room_light_bar", "light.living_room_tv_glow", "light.living_room_candle"],
    kitchen: ["light.kitchen_ceiling", "light.kitchen_pendant", "light.kitchen_passage", "light.kitchen_counter_strip", "light.kitchen_plinth"],
    office: ["light.office_ceiling", "light.office_shelf_lamps", "light.office_screen_glow", "light.office_desk_strip", "light.office_task_lamp", "light.office_key_light"],
    bedroom: ["light.bedroom_ceiling", "light.bedroom_left_bedside", "light.bedroom_right_bedside"],
  };
  const lights = (area, extra = {}) => ["savvy-lights-card", { area, columns: 2, ...(ORDER[area] ? { order: ORDER[area] } : {}), ...extra }];
  const climate = (area, extra = {}) => ["savvy-climate-card", { area, hvac_modes: MODES, default_hvac_mode: "cool", name: "Climate", grid_options: { rows: "auto" }, ...extra }];
  const SLEEP_TIMER = { entity: "timer.bedroom_ac_sleep", presets: ["30", "60", "120", "240", "480"] };

  // ---- appliances
  const entity = (cfg) => ["savvy-entity-card", { show_since: false, ...cfg }];
  const VACUUM = "vacuum.robot";
  const DISHWASHER = entity({ name: "Dishwasher", color: "amber", entity: "binary_sensor.dishwasher_running" });
  const WASHER = entity({ name: "Washer", color: "amber", entity: "binary_sensor.washer_running" });
  const ZAPPER = entity({ name: "Bug Zapper", color: "purple", entity: "switch.kitchen_bug_zapper" });
  const HEATER = entity({ name: "Water Heater", color: "red", entity: "switch.water_heater", tap_action: { action: "toggle" } });
  const KETTLE = entity({ name: "Boil kettle", color: "blue", entity: "button.kettle_boil", icon: "mdi:kettle-steam", show_state: false });

  // ---- home: the header, the rooms as tiles, the people, then each room in compact cards
  const HOME = {
    id: "home", title: "Home", nav: "Home", group: "home", max_columns: 3,
    sections: [
      { column_span: 3, cards: [
        ["savvy-home-header-card", { grid_options: { columns: "full" }, chips: [{ entity: "alarm_control_panel.home_alarm", show_state: true }] }],
        ...ROOMS.map((r) => ["savvy-room-tile", { area: r.id, grid_options: { rows: "auto" } }]),
        ["savvy-people-card", { battery: false, layout: "full", grid_options: { columns: "full" }, direction: "horizontal", people: [{ entity: "person.maya" }, { entity: "person.ben" }], columns: 2 }],
      ] },
      { cards: [
        ["savvy-section-title-card", { area: "living_room" }],
        lights("living_room", { layout: "compact", order: undefined }),
        climate("living_room", { layout: "compact" }),
        ["savvy-media-card", { ...LIVING_MEDIA, layout: "compact" }],
      ] },
      { cards: [
        ["savvy-section-title-card", { area: "kitchen" }],
        lights("kitchen", { layout: "compact", title: "Lights" }),
        ["savvy-media-card", { area: "kitchen", name: "Media", layout: "compact", volume_step: 1 }],
      ] },
      { cards: [
        ["savvy-section-title-card", { area: "office" }],
        lights("office", { layout: "compact", title: "Lights" }),
        climate("office", { layout: "compact" }),
      ] },
      { cards: [
        ["savvy-section-title-card", { area: "bedroom" }],
        lights("bedroom", { layout: "compact", title: "Lights" }),
        climate("bedroom", { layout: "compact" }),
        ["savvy-media-card", { ...BEDROOM_MEDIA, layout: "compact" }],
      ] },
      { cards: [
        ["savvy-section-title-card", { area: "bathroom" }],
        lights("bathroom", { layout: "compact", title: "Lights" }),
        ["savvy-media-card", { area: "bathroom", name: "Media", layout: "compact", volume_step: 1 }],
      ] },
      { cards: [
        ["savvy-section-title-card", { area: "toilet" }],
        lights("toilet", { layout: "compact", title: "Lights" }),
      ] },
      { cards: [
        subtitle("Appliances"),
        ["savvy-vacuum-card", { entity: VACUUM, layout: "compact" }],
        WASHER, DISHWASHER, ZAPPER, HEATER, KETTLE,
      ] },
    ],
  };

  // ---- a room: its header across the top, then its lights, climate, media, cameras and appliances
  const header = (area) => ({ column_span: 3, cards: [["savvy-room-header-card", { area, grid_options: { columns: "full" } }]] });
  const camera = (area) => ({ cards: [subtitle("Security", "security"), ["savvy-camera-card", { area, recordings: "inline" }]] });
  const roomPage = (id, sections) => {
    const r = ROOMS.find((x) => x.id === id);
    return { id: slug(id), area: id, title: r.name, nav: r.name, group: "rooms", max_columns: 3, sections: [header(id), ...sections] };
  };
  const ROOM_PAGES = [
    roomPage("living_room", [
      { cards: [subtitle("Lights", "lights"), lights("living_room", { title: "Lights" }), ["savvy-scene-card", { area: "living_room", title: "Scenes", layout: "compact" }]] },
      { cards: [subtitle("Climate", "climate"), climate("living_room", { hvac_modes: [...MODES, "fan_only"] })] },
      { cards: [subtitle("Media", "media"), ["savvy-media-card", { ...LIVING_MEDIA, chips: SCREEN_SYNC }]] },
      camera("living_room"),
    ]),
    roomPage("kitchen", [
      { cards: [subtitle("Lights", "lights"), lights("kitchen", { title: "Lights" })] },
      { cards: [subtitle("Media", "media"), ["savvy-media-card", { area: "kitchen", name: "Media", volume_step: 1, tts: speak("media_player.kitchen_speaker"),
        presets: [{ entity: "input_button.kitchen_radio_jazz", name: "Jazz radio" }, { entity: "input_button.kitchen_radio_news", name: "Morning news" }] }]] },
      camera("kitchen"),
      { cards: [
        subtitle("Appliances"),
        ["savvy-vacuum-card", { entity: VACUUM, start: "button.robot_vacuum", rooms: "auto", battery_warn: 40, battery_critical: 20 }],
        DISHWASHER,
        entity({ name: "Monthly cost", color: "amber", entity: "sensor.dishwasher_monthly_cost" }),
        ZAPPER, KETTLE,
      ] },
    ]),
    roomPage("office", [
      { cards: [subtitle("Lights", "lights"), lights("office", { title: "Lights" }), ["savvy-scene-card", { area: "office", title: "Scenes" }]] },
      { cards: [subtitle("Climate", "climate"), climate("office")] },
      { cards: [
        subtitle("Appliances"),
        entity({ color: "amber", entity: "switch.bike_charger_1" }),
        entity({ color: "amber", entity: "switch.bike_charger_2" }),
        entity({ color: "amber", entity: "sensor.bike_charger_monthly_cost", name: "Monthly cost" }),
      ] },
    ]),
    roomPage("bedroom", [
      { cards: [subtitle("Lights", "lights"), lights("bedroom", { title: "Lights" })] },
      { cards: [subtitle("Climate", "climate"), climate("bedroom", { timer: SLEEP_TIMER })] },
      { cards: [subtitle("Media", "media"), ["savvy-media-card", { ...BEDROOM_MEDIA, tts: speak("media_player.bedroom_speaker") }]] },
    ]),
    roomPage("bathroom", [
      { cards: [subtitle("Lights", "lights"), lights("bathroom", { title: "Lights" })] },
      { cards: [subtitle("Media", "media"), ["savvy-media-card", { area: "bathroom", name: "Media", volume_step: 1, tts: { action: "notify.bathroom_speaker", data: "$MSG" } }]] },
      { cards: [
        subtitle("Appliances"),
        HEATER,
        entity({ name: "Heater cost", color: "green", entity: "sensor.water_heater_monthly_cost" }),
        WASHER,
        entity({ name: "Washer cost", color: "green", entity: "sensor.washer_monthly_cost" }),
      ] },
    ]),
    roomPage("toilet", [
      { cards: [subtitle("Lights", "lights"), lights("toilet", { title: "Lights" })] },
    ]),
  ];

  // ---- the domain pages the home header's chips open
  const homeHeader = { column_span: 3, cards: [["savvy-home-header-card", { grid_options: { columns: "full" } }]] };
  const graph = (area, title) => ({ column_span: 3, cards: [["savvy-graph-card", {
    entities: [{ entity: `sensor.${area}_temperature`, name: "Temperature" }, { entity: `sensor.${area}_humidity`, name: "Humidity" }],
    hours_to_show: 24, ranges: ["6", "24", "72"], title, grid_options: { columns: "full" } }]] });
  const level = (warn, bad) => [{ value: 0, level: "good" }, { value: warn, level: "warn" }, { value: bad, level: "bad" }];

  const DOMAIN_PAGES = [
    {
      id: "lights", title: "Lights", nav: "Lights", group: "domains", max_columns: 3,
      sections: [homeHeader, ...ROOMS.map((r) => ({ cards: [["savvy-lights-card", { area: r.id, columns: 2, title: r.name, title_path: page(slug(r.id)) }]] }))],
    },
    {
      id: "climate", title: "Climate", nav: "Climate", group: "domains", max_columns: 3,
      sections: [
        homeHeader,
        { cards: [climate("living_room", { name: "Living Room" })] },
        { cards: [climate("office", { name: "Office" })] },
        { cards: [climate("bedroom", { name: "Bedroom", timer: { entity: "timer.bedroom_ac_sleep", select: "input_select.bedroom_ac_sleep_length" } })] },
        graph("kitchen", "Kitchen"), graph("bathroom", "Bathroom"), graph("toilet", "Toilet"),
      ],
    },
    {
      id: "media", title: "Media", nav: "Media", group: "domains", max_columns: 3,
      sections: [
        homeHeader,
        { cards: [["savvy-media-card", { ...LIVING_MEDIA, name: "Living Room", chips: SCREEN_SYNC }]] },
        { cards: [["savvy-media-card", { area: "kitchen", name: "Kitchen", volume_step: 1, tts: { action: "tts.speak" } }]] },
        { cards: [["savvy-media-card", { ...BEDROOM_MEDIA, name: "Bedroom", tts: { action: "tts.speak" } }]] },
        { cards: [["savvy-media-card", { area: "bathroom", volume_step: 1, tts: { action: "notify.bathroom_speaker" }, name: "Bathroom" }]] },
      ],
    },
    {
      id: "security", title: "Security", nav: "Security", group: "domains", max_columns: 3,
      sections: [
        homeHeader,
        { cards: [["savvy-lock-card", { entity: "lock.front_door", layout: "full", battery_warn: 40, unlocked_warn: 5, camera_view: "hidden" }]] },
        { column_span: 2, cards: [["savvy-camera-card", { area: "kitchen", grid_options: { columns: "full" }, recordings: "inline", columns: "auto",
          cameras: [{ entity: "camera.living_room", area: "living_room" }, { entity: "camera.kitchen", area: "kitchen" }] }]] },
        { cards: [["savvy-room-activity-card", { name: "Home", layout: "full", alarm: "none",
          chips: [{ entity: "sensor.people_home" }, { entity: "sensor.people_asleep" }, { entity: "switch.lock_bridge_plug" }] }]] },
        ...["living_room", "kitchen", "office", "bathroom", "toilet"].map((a) => ({ cards: [["savvy-room-activity-card", { area: a, alarm: "" }]] })),
      ],
    },
    {
      id: "admin", title: "Admin", nav: "Admin", group: "domains", max_columns: 3,
      sections: [
        homeHeader,
        { cards: [
          ["savvy-settings-card", { ...SETTINGS, type: undefined }],
          ["savvy-system-health-card", { source: "all", grid_options: { columns: "full" }, battery_threshold: 20, warn_above: 5, columns: 3, title: "System Health" }],
          ["savvy-graph-card", { title: "System Connectivity", columns: 2, grid_options: { columns: "full" }, entities: [
            { entity: "binary_sensor.internet", name: "Internet", state_color: true },
            { entity: "binary_sensor.cloud_link", name: "Cloud link", state_color: true },
            { entity: "sensor.uptime", name: "Last restart", state_color: false, icon: "mdi:restart" },
            { entity: "sensor.last_boot", name: "Last reboot", icon: "mdi:power" }] }],
          ["savvy-story-card", { max_events: 10 }],
        ] },
        { cards: [
          ["savvy-graph-card", { title: "System Performance", hours_to_show: 24, ranges: ["6", "24", "720"], columns: 2, grid_options: { columns: "full" }, entities: [
            { entity: "sensor.server_cpu", name: "CPU", icon: "mdi:chip", state_color: false, thresholds: level(70, 90) },
            { entity: "sensor.server_memory", name: "RAM", icon: "mdi:memory", thresholds: level(6, 7) },
            { entity: "sensor.server_load_5m", name: "Load", thresholds: level(2.5, 4) },
            { entity: "sensor.server_swap", name: "Memory swap", icon: "mdi:memory-arrow-down", thresholds: level(10, 50) },
            { entity: "sensor.server_cpu_temperature", thresholds: level(65, 78) },
            { entity: "sensor.server_disk", name: "Storage", thresholds: level(190, 220) }] }],
          ["savvy-energy-card", { total: "sensor.grid_since_last_bill", by: "device", layout: "full", exclude: ["sensor.grid_meter_reading"], price: 0.18, currency: "EUR" }],
        ] },
        { cards: [
          ["savvy-graph-card", { title: "Utility Costs", hours_to_show: 720, columns: 2, ranges: ["720", "2160", "8760"], grid_options: { columns: "full" }, entities: [
            { entity: "sensor.next_electricity_bill", smooth: true, thresholds: level(250, 400) },
            { entity: "sensor.next_water_bill", smooth: true, thresholds: level(80, 150) },
            { entity: "sensor.water_heater_monthly_cost", smooth: true, icon: "mdi:water-boiler", thresholds: level(20, 40) },
            { entity: "sensor.dishwasher_monthly_cost", smooth: true, icon: "mdi:dishwasher", thresholds: level(20, 40) },
            { entity: "sensor.washer_monthly_cost", smooth: true, icon: "mdi:washing-machine", thresholds: level(20, 40) },
            { entity: "sensor.bike_charger_monthly_cost", smooth: true, icon: "mdi:bicycle-electric", thresholds: level(20, 40) }] }],
        ] },
      ],
    },
  ];

  const PAGES = [HOME, ...ROOM_PAGES, ...DOMAIN_PAGES];

  // the dashboard as Home Assistant would describe it: a view per page, the settings card on the admin view
  const DASHBOARD = {
    title: "Savvy demo",
    views: PAGES.map((p) => ({ title: p.title, path: p.id, cards: p.id === "admin" ? [SETTINGS] : [] })),
  };

  D.ROOMS = ROOMS;
  D.PAGES = PAGES;
  D.DASHBOARD = DASHBOARD;
  D.pageFor = (id) => PAGES.find((p) => p.id === id) || PAGES[0];
})();
