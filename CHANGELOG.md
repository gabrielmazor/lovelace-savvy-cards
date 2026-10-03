# Changelog

## Unreleased

- **The health cog's popup has its page button whenever it has a target page**, like the four chips.
- **Home button and control can be switched off in the editor** ("Show home button", "Show control"),
  even when the Savvy settings supply a home page and a control. No more `control: ""` in YAML.
- **No home button on the home page itself.**
- **The lock card is calmer.** The name is the title and the state a coloured status line under it, the
  card washes only when something is off, a closed door is just an icon, and the alarm is a quieter row.
- **The settings' ignore list reaches every card.** `ignore.entities` used to apply only to the home header chips;
  room headers, section titles, tiles, room activity, locks, lights, scenes and vacuums now leave those entities out
  of their own discovery too (badges, presence, door and temperature slots, merged sensors). Named and pinned
  entities still show, and a card's own `exclude: false` opts out.
- **A README rewritten around setup**: install, how cards find things, which pages they expect, and the same layout for every card (a picture, every option in a table, the smallest config, a full example).
- **The test runner ends with the list of failing checks**, and in CI it annotates them and writes them to the job summary. The CI actions moved to checkout@v5 and setup-node@v5.

## 0.9.1

The lock, the health card and the rooms, tidied together.

- **The lock's icon is the handle.** In a popup the lock is one line: its own icon slides across the
  row, which becomes the track while you drag (a fill, the stops named "Unlock" and "Open", the icon
  turning into what the slide would do). Past the first stop it does the opposite of what the lock is
  now; the end, held until a ring fills, opens the latch. The handle always comes back to the start; a
  tap only nudges it. On the lock card the big icon at the top is the handle and the separate track
  row is gone.
- **Lock card.** The alarm's arm modes slide sideways instead of running off the card. `layout`
  (Full or Compact) is in the editor. `alarm_view` and `camera_view` (`compact`, the default, `full`,
  `hidden`): a compact alarm is one line whose chevron slides the modes open, a compact camera is a
  slim row with an **Open camera** button; the popup it opens is the camera card with its recordings.
  The battery is an icon by level and the percent, amber below 40, red at 15. `hide_alarm`,
  `hide_camera` and `false` still hide them.
- **System health counts by cause.** A Watchman item whose entity belongs to a device that is already
  an issue is folded into that device's row ("2 dashboard references broken") and counts once; Watchman's
  line says what is its own ("1 missing entity, 3 from offline devices", "all from offline devices"),
  and only what nothing explains is listed and counted. The pill and the home header's cog agree.
- **Known problems.** `ignore: { devices, entities }` on the health card, the cog, or once in the Savvy
  settings (`health.ignore`, which adds to the card's own): they leave every count, list and low-battery
  line, and wait in one collapsed "Known · N" line under Offline devices.
- **Aggregate.** `aggregate: true` (or a list of kinds: presence, door, window, leak, smoke, gas), in the
  Savvy settings or on a card, shows each room's sensors of those kinds once: occupied if any one is, since
  the first of those that are on came on. In the security popup its chevron lists the sensors behind it.
  The ignore lists, pinned `entities` and sensors you name are never merged. Off by default.
- **Home header, one row.** With no control chip the header is a single row: the home button, the four
  chips, then the weather and the health cog at the end; it slides sideways, with a fade, when it is
  wider than the card. With a control chip it stays two rows.
- **Tests and tools.** A new spec per piece; `test/icons.js` has the icons they draw.

## 0.9.0

Everything that changes now moves, with the same tactile spring feel as a press.

- **Motion.** Four shared pieces, used by every card and popup (see the README's Motion section):
  colours slide instead of switching, words roll and counts tick, rows, badges, chips and tiles
  slide to their places as others come and go, and changes that land together ripple one after
  another. Turn a room's lights off and the tiles' colours cascade, the pill slides, and "3 of 6
  on" ticks down to "All off". Everything is interruptible (flip it back mid-way and it continues
  from where it is), nothing animates a first paint or a card that isn't on screen, and reduced
  motion lands everything at once.
- **What moves:** light orbs, pills and power buttons; chips and badges (their discs, their dim,
  their order); media transport and rows; climate modes and readouts; lock banners, door and
  battery chips; room activity events, readings and banners; health pills, rows and columns;
  graph levels and tiles; entity pills; scene tiles; the control pill's colour; popup rows, their
  sections and the switch knob; icons that swap pop.
- **Popup switch.** The knob now rolls between its two ends with a spring.
- **Tests.** A motion spec samples frames after a change (in-between values, interruption,
  settling, cascade order, reduced motion), and page.waitForTimeout in the specs also waits for
  the motion to finish.

## 0.8.0

- **Lock**: a new card for a door. The state is the biggest thing on it, a glow behind it follows
  (green locked, amber unlocked, red open or jammed), and the lock is the popups' three-stop track
  at full size: slide to unlock, slide back to lock, past Unlocked drag to the end and hold until
  the ring fills to open the latch. It shows the door contact and the battery (found on the lock's
  device, or named), who last changed it and when, warns when a locked lock has its door open, and
  nudges "Unlocked for 25 min" with a Lock now button. Optional: the house alarm with its arm modes
  (disarming and codes stay in more-info), and a live camera that opens a popup above the page.
  Several locks get a row each and a "Lock all"; `layout: compact` is one row per lock. Full visual
  editor. With no lock named it shows the Savvy settings' security entity.
- **Room activity knows locks.** A room's lock reads "Locked" or "Unlocked" with how long, turns amber
  while unlocked and the alarm is armed (like an open door), has a `lock` option and shows up in the
  history page and in `exclude_kinds`. New `include` (and the Savvy settings' room `include`) adds
  entities that have no area, such as the lock of a front door.
- **Media editor wording.** A source's `output` is "Sound output" and the card's `video_output` is
  "Sound output for all sources", each with a line saying what it does; the README says it in the
  same words.
- **The chip row no longer re-appends its chips on every update**, on every card that has one.

## 0.7.4

- **System health in columns.** With `source: all` the categories (Offline devices, Low
  batteries, Watchman) sit side by side when the card is wide enough, each with its own title,
  line, facts and list; a narrow card stacks them as before. They are at least about 240 px wide
  each. `columns` caps the number (`1` keeps them stacked); a card with no Watchman sensors has
  two. Each column scrolls on its own with `max_rows`. The cog's health popup stays one column.
- **A short list no longer swallows the scroll.** The health card's list claimed the wheel and touch
  gestures even when it had nothing to scroll (with `max_rows: 250` it never does), so the page
  would not scroll while the pointer or finger was over the card. It now claims them only when it
  really scrolls. The row of chips under the home header had the same trouble with vertical swipes;
  it now lets them through.
- **Going to the page you are already on does nothing.** Pushing the same path makes the dashboard
  rebuild the view, and the page jumps to the top. Every navigate action, and the lights and vacuum
  cards, now skip it; another page, or another query, still navigates.
- **The security popup lists who is about and the safety sensors.** Presence, motion and
  occupancy sensors are read-only rows ("Detected", "Clear", and when it last changed); leak,
  smoke, gas and carbon monoxide sensors are listed too, and while one is tripped the chip says
  so ("Leak", "Smoke", "2 alerts") in red and that row is pinned right after the locks, red. Presence
  and motion never change the chip. They follow `exclude`, `exclude_areas`, the sort and the room
  order like everything else.
- **The footer button is off unless it has an action.** The system health card showed a "Run" button
  whenever `action` existed in its config, and the editor writes `action: { tap_action: { action: none } }`
  as soon as the Footer button section is touched, so the button appeared on its own and did nothing. It
  now needs a `tap_action` that is not `none` (or the older `service` form); an empty `action`, `none`
  or a label alone makes no button, and the editor no longer saves an empty `action`. If your config has
  one of those, you can delete it.
- **The lights chip says "All off"** when no light is on (it said "Off"), next to "3 on" when some are; the lights
  card's header already said it. The room header, section title and room tile don't count lights, so
  they have nothing to change.
- **Section title badges.** From the right edge going left: the temperature, presence, the door,
  the window (always there when the room has them, dimmed while idle), then whatever else is
  active, growing leftwards so the always-there ones never move; pinned entities lead on the left.
- **No Light badge from the settings.** The room's `light_state` in the Savvy settings is no longer
  pinned as a badge on the section title and the room header. It still feeds the lights card's pill
  and the room tile's toggle; to show it as a badge, pin it under `entities`.

## 0.7.3

- **Icons**: no entity ever shows a bookmark again. Home Assistant's state icon falls back to
  one when it can't work out an icon (custom integrations, late-loading translations,
  domains it doesn't know). Every Savvy card now picks the icon itself: the entity's own
  `icon`, then its registry icon, then a built-in table by domain, device class and state
  (doors open and closed, batteries by level, locks, covers, weather, and so on), and a
  question mark for a domain nobody knows. This covers the popups and every card that shows
  an entity.
- **Power is always the last control.** In the media card (full and compact) a power
  button that was built before the transport, because the player only reported power at first,
  sat leftmost; the order is now fixed: previous, play, next, power. The popups follow the same
  rule (the media row's extra line, the climate row), and a list of modes puts Off last (your own
  `hvac_modes` keeps your order). In right-to-left languages it ends up on the left.

## 0.7.2

One order for your rooms.

- **Room order.** `room_order`, a list of area ids, sets the order of the rooms in the home
  header's popups (listed rooms first, in that order; the rest by name; "No room" last) and in
  the room header's row of other rooms. Set it once in the Savvy settings, on the home header
  (all four chips), or on one chip: the chip's own wins over the card's, and the card's over the
  settings'. The room header's own `room_order` (or the older `order`) still wins there.
- **Editors.** The settings card has a Room order list, starting as the Rooms' order, with an
  "Add every room to the order" button; the Rooms entries follow the order, in the editor and in
  the YAML. The home header has the same list, and a field per chip for its own.

## 0.7.1

Popups get smaller and tidier.

- **One line per row.** Every row in a popup is a single line: the entity, its main control on
  the right (a switch, play / pause, a − target + stepper, open / close, the alarm's state),
  and a chevron when there is more. The chevron opens one extra line (transport and volume,
  the modes, brightness, stop and position, the arm modes, speed); one is open at a time, and it
  opens with a spring. The lock keeps its track on a line of its own, slimmer, always there.
- **The switch knob is centred.** The popup stylesheet had no reset for its buttons, so the
  browser's own border and padding pushed the knob down and to the right. Every popup button now
  starts from nothing, and the switch is smaller (38 x 22) and exact at any pixel ratio.
- **Bulk actions.** All off for lights and climate, Pause all for media, Lock all for security,
  beside the sort switch, acting on exactly what the popup lists. `bulk_action: false` hides it.
- **The health cog's page button is off by default.** Turn it on with `popup_button: true`.

## 0.7.0

- **Savvy settings**: a new card that holds what you'd repeat on every card: your pages
  (home, lights, climate, media, security, health and a pattern for rooms), the house
  control and weather, the health options, what to ignore, and each room's control,
  light helper, temperature, humidity, page, name and icon. Place it once, anywhere on
  the dashboard, and every Savvy card on every page takes what it needs from it. A
  card's own options always win, then the room's, then the global ones, then
  auto-discovery. Lists (ignored entities, a room's include and exclude) add to a
  card's own.
- Home header: with `house.tap: navigate` a tap on a chip goes to its page and hold lists
  what it counts. A chip with its own `hold_action` keeps its tap on the list.
- Every card's editor shows what it takes from the settings at the top, under **From
  Savvy settings**.
- The settings are read from the dashboard's config, once per page load, and kept in the
  browser: later loads show them with no wait and nothing flashes. They refresh when the
  page returns after five minutes, and follow the settings card live while it is edited.

## 0.6.2

The popups get controls instead of switches.

- **The lock track.** A lock in a popup is a track with three stops, Locked, Unlocked and
  Open. Slide the knob to the middle to unlock and back to lock; a tap does nothing. Open (the
  latch) is past Unlocked: drag to the end, hold until the ring fills, then let go. The row
  says "Unlocking…", "Opening…" or "Jammed" and when it last changed. A lock that can't open
  has two stops. Keyboard: arrows lock and unlock, Enter held opens.
- **Controls per kind.** Media players: power, previous, play / pause, next, mute and a
  volume bar with − and +. Climate: the target with − and +, and Off, Cool, Heat and what
  else the unit has. Lights: a brightness bar. Covers: open, stop, close and a position
  bar. Alarm panels: the arm modes (disarming and codes go to more-info). Fans: a speed
  bar. What an entity can't do isn't shown.
- **Ignore.** The home header's four chips take `exclude` (entities) and `exclude_areas`
  (rooms). They apply to the count as well as the popup.
- **Sort.** A popup lists by room under headings (entities with no room under "No room"), or
  by latest change, with a Room | Recent switch at its top that remembers your choice per
  chip. `sort` sets the default, `sort_toggle: false` hides the switch. The alarm and the
  locks stay on top of the security popup.
- **Fixed.** The popup's own stylesheet had no rule for hidden elements, so a control the
  entity can't use could still show.

## 0.6.1

The health card, on a real house: when Zigbee2MQTT stopped, every device showed up on its
own instead of collapsing under the bridge.

- **Offline means half or more.** A device is offline when half or more of its entities are
  unavailable, not only when all are: devices keep an entity or two when a bridge stops.
  Fewer is still "partly offline". A hub whose own connectivity sensor reads off counts as
  offline, and takes every device behind it that has anything unavailable.
- **Integration rows.** An integration that Home Assistant reports as failed or retrying, or
  whose devices are mostly offline with no hub to blame, is one row ("Tuya, retrying
  setup"). A hub is blamed before its integration; a hub of a failed integration sits
  inside it. The config entries are read once in a while and a refusal (they may be
  admin-only) is silent; the rows are then inferred from the devices.
- **New wording.** The sections are **Offline devices**, **Low batteries** and **Watchman**,
  with Watchman's own words ("3 missing entities, 1 missing action", "Nothing missing") and
  "All devices online". `source: offline` works as well as `unavailable`.
- **Run report.** A chip in the Watchman section asks Watchman for a new report
  (`watchman.report`, `parse_config: true` by default; `watchman_report` sets the data,
  `watchman_button: false` hides it). The home header's cog popup has it too.
- **Locks in the security popup.** The popup now always lists every lock, in any state. It
  used to list only what was open, which dropped a locked lock whenever a window was open.
- **Taps follow tap_action.** On the home header's four chips and the health cog,
  `navigation_path` no longer makes a tap navigate. Tap and hold both open the list, unless
  `tap_action` / `hold_action` say otherwise; `navigation_path` only feeds the popup's page
  button. To make a tap go to a page, give the chip `tap_action: { action: navigate, ... }`.

## 0.6.0

Names that say what a card is for, a page button in the popups, and a control chip that is
no longer only for selects. **This one changes ids and a key: see Migrating.**

- **Renamed cards.** The picker groups them: Home header, Room activity, Room header,
  Room tile, Section title, System health.
- **Page button in the popups.** Holding a chip on the home header lists what it counts;
  the popup now has a button pinned under the list that opens the chip's page. Its page is
  the chip's `navigation_path`, or else the page its tap or hold
  action already navigates to. `popup_button: false` hides it, `popup_label` words it. The
  health cog's popup has one as well.
- **Control.** `mode` is now `control`, and takes any entity. A select or input_select
  opens the picker as before; a button, script or scene runs on tap; a switch or
  input_boolean toggles; anything else opens its more-info. `control_tap_action`,
  `control_hold_action` and `control_double_tap_action` (or `control: { entity, name, icon,
  color, tap_action, ... }`) override it. The room tile shows its control read only.
- **Editor labels.** One or two words, with the detail in the helper text, and the same
  everywhere: Target page, Tap action, Hold action, Custom chips, Entity override,
  Home button, Battery alert, Red threshold, Grouping, Hub threshold, Ignored integrations,
  Control, Caption.
- Entity-list popups no longer re-append every row on each state update.

### Migrating from 0.5

| Was | Is |
|---|---|
| `custom:savvy-home-card` | `custom:savvy-home-header-card` |
| `custom:savvy-health-card` | `custom:savvy-system-health-card` |
| `custom:savvy-room-card` | `custom:savvy-room-header-card` |
| `custom:savvy-heading-card` | `custom:savvy-section-title-card` |
| `custom:savvy-snapshot-card` | `custom:savvy-room-activity-card` |
| `mode: input_select.x` (home header, room header, section title, room tile) | `control: input_select.x` |

Nothing else changes: `mode_label`, `mode_icons` and `mode_colors` keep their names.

## 0.5.0

The health card says what's wrong instead of listing entities.

- **Offline devices, not offline entities.** Every unavailable entity of a device is one
  issue, the device ("2 of 9 entities unavailable" when only some are down, offline for
  how long when all are). Entities with no device stay single rows.
- **Hubs.** When a hub is down (a Zigbee bridge, a coordinator, anything other devices are
  attached to), the devices behind it are one issue: "Zigbee2MQTT Bridge offline, 34
  devices". It also rolls up a hub that is up when every device behind it is down. Needs
  `group_min` devices (default 3); a partial device never rolls up. `group_by: hub |
  device | none` turns it down or off.
- **One count.** The card's pill and the home card's cog count issues with the same
  engine: a hub, a device or a loose entity is one each.
- **Tap to open.** Hubs and devices expand to what's under them; an entity opens its
  more-info; holding a device opens its page in Home Assistant. What is open stays open.
- **New words.** Sections are Offline, Low batteries and Broken references (Watchman's
  missing entities and actions are references in your configuration that don't exist).
  Each says what's wrong ("3 devices offline", "2 batteries low") or ticks off what's
  fine ("Everything is online", "All batteries fine", "No broken references").
- **`details: true`** adds a facts line under every section and area and integration on the
  rows.

## 0.4.0

- **Scenes**: a new card. Point it at an area (or several) and it lists every scene
  there as a tile: tap runs it, hold opens its details, and a scene lights for a few
  seconds after it runs. Names lose the room's name by default, or whatever `strip` (a
  regular expression) matches. Pin scenes from elsewhere, exclude some, one row of pills
  with `layout: compact`. Full visual editor.
- **Graph**: a tile can chart one attribute of an entity (`attribute: humidity` on a
  weather entity), with its own history.
- **Scrolling**: the health, graph, entity, snapshot and scene cards no longer re-append
  every row and tile on each state update. On a busy system that pulled the element under
  a finger or a wheel out of the page several times a second and could cancel a scroll.

## 0.3.0

The rest of the collection: five more cards on the Savvy core.

- **Media**: a room's players found from the area (speakers the output, the rest the
  sources): artwork, a source picker, transport, volume that only moves on a sideways
  drag, presets, text to speech, an alarm clock; a compact layout.
- **Camera**: the area's cameras, side by side or a swipe apart. Frigate turns itself on
  when the cameras come from it: alerts, a motion timeline, synced recordings.
- **Snapshot**: a security glance at a room, with how long ago everything happened, alerts
  that wash the card, and a history page to scrub; a compact layout.
- **Entity**: one entity (a person gets their picture and zone) with its chips.
- **Graph**: tiles that graph numbers and read out everything else; long-term statistics
  past a week.
- **Health**: an empty category says "All good" with a tick, under its name, as a single
  list does.
- **Editors**: every "where to go" field is Home Assistant's own page picker, called
  "Navigate to on tap".

## 0.2.2

- **Popups sit above the whole page.** They were drawn inside the card, and dashboards
  that wrap cards in transformed boxes (Home Assistant's do) clipped the backdrop to the
  card: a tap outside didn't close the popup, and could press what was underneath. Now a
  tap outside closes it and goes no further, a scroll outside closes it without moving
  the page, and scrolling inside a list never carries on into the page. The same for the
  mode picker. A popup also goes when its card leaves the page.
- **The climate list shows a fan per unit, turning while the unit runs** (and stopping
  where it is when it's switched off).
- **Home: the Lights chip counts every light**: with an area or without, lights set up
  in YAML, and hidden group members; light groups (HA's and Hue's) are left out so
  nothing counts twice. It used to count only lights assigned to an area.
- **Media reads "Not playing"** whenever a player isn't playing (idle, paused, on,
  standby, off): the Media chip, the room header's row and the badges.

## 0.2.1

- **Home: the mode is never guessed.** A new home card started with a mode picked by its
  entity id, so the editor listed that entity's options before any was chosen. It now
  starts empty; the mode icons and colours appear once you choose an input_select, filled
  from its options.

## 0.2.0

The room cards: four more on the Savvy core.

- **Home**: the home dashboard's header. The house mode (a picker of its options), the
  weather, the health cog (exactly what the Health card lists, which holding it shows),
  and four chips that count by themselves, no helpers needed: lights on, the average
  indoor temperature, what's playing, security (the alarm, else what's open). Each can be
  turned off or pointed at an entity; hold one for the entities it counts.
- **Room**: a room page's header: mode, temperature, everything the room has (pinned
  first, the rest discovered, idle ones dimmed), your chips, and a row to every other room.
- **Heading**: a room's section heading: name and icon from the area, mode, temperature,
  and badges for what's going on.
- **Room tile**: a room at a glance, with the liquid drop that fills with the room's
  light, from the area's own lights; double tap for the lights, hold for their list.
- **Modes, everywhere**: `mode:` takes any input_select or select. Every option gets an
  icon and colour from the mode dictionary; the editor lists the options to set your own.
- **Badges: pinned, then discovered**: `entities:` always shows, in your order;
  `auto_discover` adds what the area has; `exclude_kinds`, `include`, `exclude`.
- **Keyboard**: Enter on something inside a tappable card (a badge on a tile) now only
  presses that, not the card too.

## 0.1.2

- **Health: every category always shows** in the default `all` list, with its count or
  "All good" (Watchman when its sensors are set), so an empty list reads as good news
  rather than a missing section.
- **Health: when Watchman last checked** ("Checked 2 h ago"), from Watchman's own "last
  parse" sensor, found through the registry; `watchman_last_run` names another or hides it.

## 0.1.1

- **Editor: typing no longer loses the cursor after every character** (most visible in
  Safari). Home Assistant answers each change by handing the config back, and the editor
  rebuilt its form on the echo, replacing the field being typed in. It now ignores its
  own echo, only hands HA's form a new schema when the schema really changed, and keeps
  list rows (chips) in place while you type in them.

## 0.1.0

The first four cards, on the shared Savvy core.

- **Lights**: every light in one or more areas, each with only the controls it supports;
  an on/off pill that can hold an entity of your own; featured lights; order them in the
  editor; chips.
- **Climate**: finds the area's unit; readings from the unit itself unless you give
  sensors; history with the unit's on/off band; timer; chips; a compact layout.
- **Vacuum**: any robot vacuum, deepest for Roborock: live job, map, rooms in order,
  routines, modes, dock, maintenance; a compact one-row layout.
- **Health**: unavailable entities, low batteries and Watchman issues, grouped under one
  count.
- Every option in the visual editor; sliders that only move on a deliberate sideways
  drag; keyboard-only focus rings.
