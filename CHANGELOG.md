# Changelog

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
