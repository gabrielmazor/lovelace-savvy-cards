# Changelog

## Unreleased

- **A new look, the same cards:** the default design is rebuilt around one surface per card. Icons stand bare instead
  of on tinted discs (an alert keeps its disc), rows replace boxes inside boxes, titles are larger, group names are in
  sentence case, and readouts are words on one line that wraps instead of truncating. Every option, gesture and popup
  is kept; glass and matte sit on the new layout.
- **Lights: the row is the control.** Tap a light's row to switch it, drag sideways to dim it (from the level it had,
  so a scroll never changes it), hold for its details; the dot opens warmth and colour. The level fills the row in the
  lamp's own colour. Featured lights now take the full width (the option had no visible effect before).
- **Climate:** the target alone in the middle, a step either side, a fine rail with a knob, modes as words with a dot
  that slides between them, and the fan button says what it is ("Fan auto").
- **Media and vacuum:** one solid key per card, in the text colour: play while a player is playing, the vacuum's Start.
- **Live demo:** `site/` is a static site with every card on a made-up house of six rooms (`node site/build.mjs --serve`).

## 0.19.1

- **Loading, not offline:** while Home Assistant or one of its integrations is still coming up, the home header's cog
  is a loading ring with no count, and the health card (and its popup) says "Home Assistant is starting…",
  "Reconnecting…" or "Loading integrations: Zigbee, MQTT" instead of a wall of offline devices, with Show anyway.
  It follows the connection, the core's own state and the integrations whose setup is in progress, not a timer
  (`startup_wait: false` turns it off).
- **Popup titles lead to the page:** when a popup has a page to go to, tapping its title goes there too, with or
  without the button at the bottom.
- **Matte, flatter:** no bevels, embossing or stacked shadows; flat planes told apart by tone and a hairline edge,
  a quiet lift only under cards and popups. Popups and menus are matte too. The lit wash stays.
- **Section title:** `filled` is now `background` (the old name still works), and in matte a title without one is clear,
  as in plain and glass.

## 0.19.0

- **Matte design (optional):** `design: matte` on a card, or `design: { style: matte }` in the settings card for all of
  them. The same layout as plain and glass in a solid, tactile material: opaque surfaces derived from the theme's card
  colour, raised tiles with a top highlight and a soft neutral shadow, embossed icon discs, controls that look pressed
  in while on. A lit tile is painted by its state colour (chroma capped so different colours sit in one family), strongest
  at the icon with a thin coloured edge on its side, and stronger the brighter the lamp. No blur, no transparency.
  Popups and menus follow. Plain stays the default and is unchanged.

## 0.18.2

- **Glass, rethought:** after Apple's liquid glass. A tinted, saturated pane that stays distinct from what is behind it
  (it used to melt into the background, most of all at the right edge): a bright specular sheen from the top-left, a rim
  lit at the top-left and bottom-right and dim between, an inner glow towards the edges, deeper soft shadows, and a highlight
  that follows the pointer. Tiles are raised glass of their own. Popups and menus use the same material, denser.
- **Entity:** the card's glow and icon take the entity's own colour (a light's own colour, a kind's colour) instead of
  always blue. `color` on the card overrides it, and now works with colour names and variables too (they used to fall
  back to blue).

## 0.18.1

- **Room tile:** all of its animations can be turned off, `animations: false` on a tile, or `design: { animations: false }` in
  the settings card for every room tile (on by default). A badge's halo is no longer cut by the row's edge.
- **Room light badge:** it takes the entity's own icon instead of a fixed light switch; a badge you configure still
  picks its own.
- **Media (compact):** the player's icon, name and buttons sit in the same tile as in the full layout.

## 0.18.0

- **Glass design (optional):** `design: glass` on a card, or `design: { style: glass }` in the settings card for
  all of them. A frosted surface where every lit thing is a light source: the icon of a lit light, a person at home, a
  playing player, a running thermostat throws its colour into its own tile (an ambient bleed with falloff, a
  core at the icon, a rim light on the nearest edge), stronger the brighter the lamp. Shows on a black
  dashboard; the blur needs a wallpaper or gradient behind the cards. Popups follow their card. Off for reduced
  transparency. Plain stays the default and looks as before.
- **Every design:** the thermostat's target and its plus and minus buttons are one tile, and each media player's
  icon, name and buttons are one tile with its volume below it.
- **Entity:** in glass the whole card is the lit tile, at the card's own size.
- **Lights:** `include` (Also show) names lights that discovery skips, such as one an integration files under settings or diagnostics.
- **Section title:** stays clear in glass unless it is `filled`.

## 0.17.3

- **Vacuum:** the routine buttons are as wide as each other and sit on the same columns as the tiles below them
  (they were sized by their words, so they came out different widths and off the grid).

## 0.17.2

- **Entity:** a tap on the main entity now does what the entity does: toggles a light, switch, fan or
  automation, presses a button, runs a script or scene; a person or sensor still opens more-info. Hold opens
  more-info. `navigation_path` still makes a tap navigate, and `tap_action`/`hold_action` still replace both.
- **Health popup:** the corner glow is drawn by the popup itself, so it fades smoothly under the title
  instead of being cut by it.

## 0.17.1

- **People, side by side:** two columns whatever the width (it fell back to one column on a phone), three on a
  wide card, or `columns` to choose. A long place name wraps under the name instead of being cut.

## 0.17.0

- **People:** `direction: horizontal` puts people side by side (wrapping on narrow cards). The icon of the
  place they are at, the zone's own, sits beside the location text.
- **Energy:** a Tariff entity picker in the editor (`tariff`) and a separate fixed price (`price`, used when
  there is no tariff or it is unavailable). The older `price: sensor.x` still works.
- **Covers:** `controls: slider` puts the position bar on each row instead of the arrows (a garage door or
  gate without a position keeps its arrow). `covers` gives a cover its own name and icon.
- **Entity card:** a long name or state no longer runs out of the card; it wraps inside it.

## 0.16.0

- **New card: Energy** (`custom:savvy-energy-card`). Today, this week or this month against the same
  stretch before it, a bar for every hour or day, the live power and the biggest consumers (by device or
  by room). The cost is each hour's energy times that hour's price (a number, or a tariff sensor), read
  from Home Assistant's long-term statistics. Tap a bar for that hour or day. The ignore list in the Savvy
  settings applies.

## 0.15.0

- **New card: Fans** (`custom:savvy-fan-card`). The fans, air purifiers and humidifiers of a room as the
  popup's rows, with All off. A fan has its speed, its preset modes and oscillation; a humidifier its
  target humidity and modes. A running fan's icon turns, faster at a higher speed (in the card and the
  popup). The ignore list in the Savvy settings applies.

## 0.14.0

- **New card: People** (`custom:savvy-people-card`). Who is home: avatars with a green ring when home,
  where each person is and for how long, the phone's battery (found through their phone) and, while they
  are away, the time to get home from a sensor you give it. Home first. A compact row of avatars too. The
  ignore list in the Savvy settings applies.

## 0.13.0

- **New card: Covers** (`custom:savvy-cover-card`). The blinds, shutters, curtains, awnings, garage and
  gate of a room as the same rows the covers popup uses, with Open all and Close all. Filter by kind,
  include and exclude, a compact layout, and the ignore list from the Savvy settings.
- **Tilt** for covers with slats: a tilt bar behind the chevron, in the card and in the popup.
- **Garage and gate ask twice.** A garage door or a gate shows "Tap again to open" on the first tap and
  opens on the second (in the card and in the popup). Closing is one tap. Open all leaves them out.

## 0.12.0

- **New card: Home story** (`custom:savvy-story-card`). What happened at home, in plain sentences: who
  arrived and left, doors and windows, locks (and who unlocked from the app), motion, a room's lights as
  one span with its hours, players starting, alarms and leaks. Repeats merge into one line ("7 times,
  07:10 to 07:40"), lines are grouped by part of the day, and chips filter by All, People, Security and
  Rooms. The range is today, the last 24 hours or **while you were away** (since the last person left).
  It asks the logbook only for the kinds of things it shows and refreshes every minute while visible. The
  ignore list in the Savvy settings applies.

## 0.11.0

- **New card: Last check** (`custom:savvy-last-check-card`). The last look before you leave or go to bed.
  It finds what would be left behind (lights, players, climate, fans, unlocked locks, an open garage or
  gate), lists it by room, and one slide turns it all off, with a tick on each row as Home Assistant
  confirms it. Rows can be ticked off for this run. Open doors and windows stay on the list as things that
  need you (`block: true` refuses to run while they are open). It never unlocks. `then` runs a scene, a
  script or an alarm arming after a clean run. Routines: `leave` and `goodnight`. The ignore list in the
  Savvy settings applies.

## 0.10.8

- **System health: Dismissed is its own section**, at the bottom, listing everything you put aside with a
  Bring back button (it says whether it is a Watchman item, an offline device or a battery).
- **Choose and order the sections.** `categories` lists the sections to show in the order you want
  (Watchman, Offline devices, Low batteries, Dismissed); the editor has a tick list. Hidden sections still
  count.
- **The summary line sits under its title** (for example "3 missing entities, all from offline
  devices") and wraps, so it is read in full instead of being cut.

## 0.10.7

- **Fine scrubbing on the recordings timeline.** Press the bar and drag as before; drag up and the same
  width covers less of the day: the whole day, 6 hours, 1 hour, then 10 minutes. The label shows the zone
  and, in the close zones, seconds. Movement is relative to where the zone changed, so nothing jumps; you
  feel a tick on every zone change. On a computer Shift is fine and Alt is close; Shift+arrow moves 10
  seconds and Page Up / Page Down an hour.
- **Climate timer with durations.** The timer chip lists durations (`presets`, default 15, 30, 60 and 120
  minutes) and starts your `timer` helper with the one you pick. While it runs, a tap offers +15 min,
  pause / resume and cancel; hold still opens the helper. The old `select` keeps working when no
  durations are set. The helper only counts down: keep the automation on `timer.finished` that turns the
  unit off, and drop the one that started the timer from the input select.
- **Health cog.** When the count is kept from non-admins (`admin_only`), the cog now looks like any other
  button for them: no alert colour either.

## 0.10.6

- **The glow is the colour of the icon.** On every card with a state glow, the corner wash now takes the
  colour its own icon has. On the lights card it works like the room tile: the first colour light that is
  on gives its own colour, and white or warm-white lights glow in the amber of their icons instead of
  coming out white. The colour slides when the lights change. The vacuum glow follows the card's accent.

## 0.10.5

- **Sound on the cameras.** Cameras stay muted, as before. When a stream carries sound, a speaker button
  appears next to full screen on the live view and in the control bar of the recordings player. One tap
  turns the sound on, for one picture at a time. It goes back to muted when the picture restarts, the
  card leaves the screen, a popup closes or the browser tab is hidden. It only shows when the stream has
  sound (the camera has to send it). `audio_button: false` hides it; the editor has "Sound button". The
  lock card's camera popup gets it too. (`remember_sound` is not offered: a browser only allows sound
  after a tap, so a remembered choice could never be applied.)
- **README, media card.** A new screenshot first in the media section: four video sources (console, TV,
  streamer, PC) with a soundbar and speakers as sound outputs, and the `video`, `audio`, `output` and
  `video_output` options explained in plain words.

## 0.10.4

A title with a link on every card, off unless you set it.

- **`title_path` (Title link) on every card.** A page that opens when you tap the card's title. Only the
  words are the link: pressing anywhere else on the card does what it always did, and pressing the words does
  not also do the card's own thing. The page you are already on is a no-op. Keyboard: Enter or Space.
- **Cards that show a name make that name the link** (climate, media, vacuum, entity, lights, scenes, lock,
  system health, graph, room activity). `title` is another way to write `name` there.
- **Cards that show no name get a title line** when `title` is set: home header, room header and camera.
- **Not changed:** the room tile (the whole tile already goes to its page) and the section title (it already
  had `navigation_path`; `title_path` and `title` are accepted as the same thing). The settings card takes a
  `title` and no link.
- A lock card with a title or a title link shows its header for a single lock too.

## 0.10.3

The graph card has colours of its own.

- **Any colour on a threshold.** `thresholds: [{ value: 0, color: blue }, { value: 25, color: orange }]` takes
  an HA colour name, a hex value or `rgb(...)`. The old `level: good | warn | bad` is unchanged.
- **Smooth colours.** `smooth: true` blends the line, the fill, the dot and the tile through the colours
  between the thresholds, instead of switching at each one. A colour change slides as before and snaps with
  reduced motion.
- **Presets.** `thresholds: temperature` runs blue, teal, green, amber, red (written in °C, converted for a
  °F sensor, smooth by default); `humidity` and `battery` are stepped.
- **One colour.** `color: teal` on a tile with no thresholds replaces the accent.
- **A colour scale editor.** The raw thresholds field is a list: a preset select, an Add threshold button, and
  a value, colour and level for each row. The list editor now supports lists inside an item.

## 0.10.2

The room activity card: no alarm unless you ask, and its states in colour.

- **The alarm is opt-in.** The card no longer finds an alarm panel by itself. Name one with `alarm:
  alarm_control_panel.home`, or write `alarm: auto` for the house's first panel; then the armed pill shows and
  an open door or window while it is armed (presence while armed away) turns red. Without it there is no pill
  and nothing escalates. If you relied on the old behaviour, add `alarm: auto`.
- **States have their own colour, alarm or not.** Presence is the accent, an open door or window and an
  unlocked lock are amber, an alert is red (a leak blue); closed, locked and clear stay grey. The status line
  and the card's soft corner wash follow the strongest state. `colored_states: false` (editor toggle "Coloured
  states") keeps it all grey.

## 0.10.1

A dismiss button on the health card, and admin-only visibility.

- **Dismiss a health row.** Every offline issue, low battery and Watchman item has a small button that puts it
  aside for you. It leaves every count (the card's, its categories', the home header's cog and its popup) and
  waits in a collapsed "Dismissed · N" line at the foot of its category; each dismissed row has a Bring back
  button. It is personal, kept in your Home Assistant profile (`frontend/set_user_data`, so it follows you to
  your other devices, no admin needed) and in the browser when that is not available. A dismissal forgets
  itself when the problem is gone, so it returns if it breaks again, and a problem that grows (one more entity
  goes down) comes back by itself. Matching is by entity, so a hub dismissed on one card stays dismissed on a
  card that groups by device. `dismiss: false` hides the buttons (editor: "Dismiss button", on by default).
  `health.ignore` in the settings stays the shared, permanent list, in its own "Known" line.
- **Admin only.** `admin_only: [health_cog, health_badges]` in the Savvy settings (a checkbox list in its editor)
  keeps the health cog, or only its count, from people who are not administrators. Everyone sees everything
  unless it is listed. A home header can set its own `admin_only` (a list, `true` for both, `false` for nothing)
  and it wins over the settings. Without the cog the one-row header leaves no gap. A user Home Assistant does not
  describe counts as an administrator, so nothing is hidden by mistake. A card can only hide itself: it does not
  lock a page.

## 0.10.0

One design language for every card.

- **Circles for things, rounded squares for controls.** The icon of a room, light, lock, player, entity or popup row is a
  circle of one of three sizes (28, 36, 44); anything you press (power, swatch, step, transport, the header's home button and
  health cog, a popup's close, bulk and page buttons) is a rounded square of one of two (32, 40). The lights, media, climate,
  room activity, scene, vacuum, settings and popup icons moved to it; compact layouts take the next size down.
- **One set of tones.** Idle is the well, on is 16% of the state colour, an alert 18% of amber or red, everywhere. Amber and red
  are one pair (`--warn-rgb`, `--bad-rgb`) instead of five copies.
- **A state glow.** A soft corner wash in the colour of what the card is doing: lit lights (their colour), a locked door
  (green), unlocked (amber), open (red), music playing, heating or cooling, cleaning, a problem, issues in the health card, the
  room tile's drop. Nothing when idle, 10% at most, one spring. On by default; `state_glow: false` on a card or
  `design: { state_glow: false }` in the settings card turns it off, and each editor has the toggle.
- Under the hood: the design tokens (`--b-s/-m/-l`, `--c-s/-l`, `--mix-on`, `--mix-alert`) live once in `core/00-base.js` and on
  the popup sheet, `Motion.glow` does the glow, and a new spec (`design-language`) fails a card or popup that draws a badge or
  control outside them. `docs/DESIGN.md` 5.2 and 5.3 describe the rules.

## 0.9.2

- **Pages are found by name.** A dashboard view called `lights`, `climate`, `media` or `security` is the page for that chip
  and its popup button, and a view named after a room (`living-room`, or its name) is the room's page for room tiles, section
  titles and the room header's row. What you write in a card or the settings card wins, `pages: { lights: false }` turns one
  off, two views claiming one name means no guess, and the health page is still yours to set. A found page never changes what
  a tap does. The editors say "found automatically", and the settings card lists what it found.
- **Lights cards share an order.** A lights card with no `order` takes the one from the first lights card for the same room
  that has one, anywhere on the dashboard. The editor says which card it reads from and has an **Unlink** button, and
  `sync_order: false` keeps a card independent.
- **The lights tile changes colour as one move.** The orb, its icon and the tile used to drift apart (the icon waited on the
  old colour until the last frame); they now share one start and finish together in about a third of a second, for every card
  that fades colours. A tap shows its result at once and moves back if Home Assistant has not followed within two seconds.
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
