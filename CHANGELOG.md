# Changelog

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
