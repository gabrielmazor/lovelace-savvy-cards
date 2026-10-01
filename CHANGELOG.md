# Changelog

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
