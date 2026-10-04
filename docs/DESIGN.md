# Dashboard card design rules

The design system for Savvy Cards. Read this before building or changing a
card. Every rule here is already implemented in at least one card in
`src/cards/` or in the core (`src/core/`), so when in doubt, reuse the existing
code rather than reinventing it.

---

## 1. Non-negotiables

- **Vanilla JS web components.** One file per card family, no build step, no
  dependencies, no Lit. Shadow DOM, `customElements.define`, `window.customCards`
  registration.
- **Wrap the whole file in an IIFE**: `(() => { "use strict"; ... })();`. A
  top-level `const Spring` in one card and another in the next is a hard
  SyntaxError if Home Assistant loads the resource as a plain JavaScript file
  rather than a module, and the second card silently never registers.
- **No `localStorage`, no external CDNs, no network calls** except Home
  Assistant's own websocket and REST APIs.
- **Cards size to their content.** Never `height: 100%`, never a `min-height`
  tuned to a grid row, never `getGridOptions` rows that pin a height. Most
  dashboards now use the sections layout, so return `rows: "auto"` (the grid then
  sizes the card to its content), and a card next to a taller sibling must
  not stretch.
- **Install path** `/config/www/<name>.js`, registered as a module with a
  version query string (`?v=7`). Bump it on every change or the browser
  serves a stale card; see §7's caching note.
- **Ship only after looking at it.** Render in a headless browser with HA
  stubs, in both themes, at several widths, and drive every gesture
  programmatically. A card that was never rendered is not finished.

---

## 2. Motion

All motion is springs. No CSS transitions or keyframes on anything a finger
can touch.

### 2.1 The spring

Two parameters, the way Apple tunes them:

- **damping** 1.0 = critically damped, no overshoot. Below 1.0 overshoots.
- **response** seconds to reach the target. Not a duration; a spring has no
  fixed end.

```js
class Spring {           // x, v, target, group, eps
  tune({response, damping}) { const w = TAU/response; this.k = w*w; this.c = 2*damping*w; }
  to(target, motion)     // re-target, keeps current position and velocity
  snap(value)            // jump, kill velocity
  kick(dv, keep = 1)     // add velocity; keep is how much existing motion survives
  step(dt)               // fixed 1/240 substeps, snaps itself when idle
}
```

Fixed substeps (`STEP = 1/240`) keep the physics identical at 60Hz, 120Hz, and
after a stalled tab. Clamp frame `dt` to 0.05s so a backgrounded tab resumes
calmly instead of exploding.

### 2.2 The tuning table

| Use | damping | response |
| --- | --- | --- |
| Press feedback (pointer down) | 1.0 | 0.12 |
| Press release | 0.82 | 0.3 |
| Hold committed (springs back past rest) | 0.58 | 0.34 |
| Hold sink (sustained over the whole hold) | 1.0 | 0.5 |
| Pager / flick-driven travel | 0.86 | 0.42 |
| Segmented-control / picker pill | 0.82 | 0.34 |
| Generic UI (appear, dim, wake) | 1.0 | 0.4 |
| Rolling numbers and text | 1.0 | 0.5 |
| Value catching up to a drag | 1.0 | 0.34 |
| Light intensity, tint, colour | 1.0 | 0.6–0.75 |
| Popover/sheet opening | 0.82 | 0.38 |
| Popover/sheet closing | 1.0 | 0.24 |
| Graph drawing itself in | 1.0 | 0.7 |
| Scrub cursor | 1.0 | 0.1 |
| Slow idle spin-up (fan, spinner) | 1.0 | 1.6 |

**Bounce only after momentum or an explicit open/close gesture.** Overshoot on
a flicked page or an opening sheet feels right; overshoot on something that
just faded in feels wrong. Everything purely reactive is damping 1.0.

### 2.3 Bloom: a spring that rises and falls on its own

For event glows (a light switching, a badge waking) do not animate 0 to 1 to
0. A critically damped spring kicked from rest follows `x = v·t·e^(-wt)` and
peaks at `v/(w·e)`. Solve for the kick that lands on the peak you want and let
it fade by itself:

```js
const bloom = (spring, peak, motion) => {
  spring.to(0, motion);
  const w = TAU / motion.response;
  spring.kick(peak * w * Math.E * (1 - clamp(spring.x / peak)), 0.3);
};
```

### 2.4 One clock per file

A single module-level `Clock` with one `requestAnimationFrame` loop and a
`Set` of jobs. A job returns `false` to unsubscribe. The loop stops entirely
when the set empties. Cards add themselves on any state change or gesture and
fall out when everything is idle. Offscreen cards (via `IntersectionObserver`)
stop painting; slow idle drift (spin, wander) may run at 30fps.

### 2.5 Painting

- Only `transform` and `opacity` are animated. Never layout properties.
- Every DOM write goes through a **write-through cache** (`put`, `attr`,
  `text`) that compares against the last value and skips unchanged writes.
- Springs carry a **group** name. Each frame collects dirty groups and paints
  only those sections. Never repaint the whole card because one spring moved.
- `ha-card` ships `transition: all`. Always override it:
  `transition: background-color 240ms ease, border-color 240ms ease;`
  Otherwise every spring frame lags a third of a second behind.

---

## 3. Gestures

### 3.1 The contract

- **Feedback on pointer-down, commit on pointer-up.** Never wait for `click`
  to show that something was pressed.
- **8–10px of slop.** A press that travels further is a drag or a scroll:
  spring the press back and swallow the click.
- **1:1 tracking.** A dragged value follows the finger exactly. Snap to steps
  only on release, if at all.
- **A bar with no thumb engages on sideways intent, and tracks relatively.**
  A press alone changes nothing: the bar takes over only once the finger
  has moved past slop *and* more sideways than up or down, and from there
  the value moves 1:1 from where it was, never jumping to where the finger
  landed. Capture the pointer on press so the release is always seen. A
  value that jumped on `pointerdown` changed the A/C and the volume every
  time a scroll started on the bar (climate-card, media-card).
- **Rubber-band at boundaries**, never a hard stop:
  `rubber(over, dim, c = 0.55) => over*dim*c / (dim + c*|over|)`
- **Project momentum on release.** Land where the flick is going, not where
  the finger left: `project(v) => (v/1000) * 0.998 / (1 - 0.998)`, then hand
  the release velocity to the spring.
- **Hold is 500ms**, with a `medium` haptic and a `pop` spring on commit. The
  element sinks visibly for the whole hold so the wait is legible.
- **Double-tap is 250ms** and is only paid for where a double-tap actually
  exists. A card with no double-tap action commits immediately.

### 3.2 Arbitration between competing gestures

This is where cards break. The rules:

- A press handler must **not** `stopPropagation` on pointerdown. Both the
  button and the pager track the pointer; whichever reaches its threshold
  first wins, and the loser cancels cleanly. Swiping from on top of a button
  pages the card and does not fire the button.
- A control that **owns** a drag axis (a slider) does `stopPropagation` on
  pointerdown so a parent pager or scroller never sees it.
- A pager releases its claim the instant another gesture sets
  `this._dragging`, and springs back to the current page.
- Vertical intent is always returned to the page so the dashboard still
  scrolls: claim the pointer only when `|dx| > |dy|` after slop.
- Where two gestures share an axis on the same element (chart scrub vs. page
  swipe), disambiguate with a **~140ms dwell**: move early and it is a swipe,
  hold still and it becomes a scrub, with a `selection` haptic to mark the
  switch.
- A card-level tap ignores clicks whose `composedPath()` contains a control
  class, and disarms on any movement past slop.

### 3.3 Haptics

`window.dispatchEvent(new CustomEvent("haptic", {detail}))`. The companion
apps turn it into a real haptic; elsewhere it is a no-op.

- `selection` per detent crossed on a slider, per segment change, per cycle
  step, per opened/closed popover.
- `light` on toggles and page landings.
- `medium` on a committed hold or a "bigger" confirmed action (e.g. a
  double-tap that forces every light off).

Nothing else. Over-feedback trains you to ignore all of it.

### 3.4 Keyboard and pointer parity

Every tappable thing is a real `button` or has `role="button"` with
`tabindex`. Enter and Space act; arrow keys drive sliders.
`e.detail === 0` identifies a synthesized click from a keyboard or screen
reader and always commits, since it never produced pointer events.
`:focus-visible` outlines in the card's accent colour.

---

## 4. Optimism and write discipline

Automations and physical devices (an A/C, a games console) round-trip with real latency,
so the card answers first.

- **Optimistic toggles:** flip the glyph and start the animation immediately,
  record the expected result, and reconcile when HA reports back. Expire the
  guess after a few seconds so a failed call does not leave a lie on screen.
- **Never replay an animation** that the optimistic path already played.
  Record direction and timestamp; if the real event matches within the
  window, skip it.
- **Throttle continuous writes.** During a drag, send at most every
  350–400ms; the release always sends. Never fire a service call per
  pointermove.
- **The drag owns the value** while it is happening. Incoming state updates
  must not yank the number out from under the finger.

---

## 5. Visual language

### 5.1 Type

System font stack, overridable per card with a CSS variable
(`--room-card-font-family`, etc.). `font-variant-numeric: tabular-nums`
everywhere so digits do not jitter. Tracking is size-specific:

| Role | size / line-height | weight | tracking |
| --- | --- | --- | --- |
| Hero numeral | 52 / 0.92 | 600 | -0.035em |
| Hero numeral (compact) | 25 / 1 | 600 | -0.022em |
| Card title | 15 / 20 | 600 | -0.014em to -0.016em |
| Card title (large layouts) | 18–20 / 23–26 | 650 | -0.022em to -0.024em |
| Status / secondary line | 12–13 / 16–18 | 500 | -0.003em to -0.008em |
| Control label (segment, chip, pill) | 12–13 / 16 | 550–600 | -0.004em to -0.008em |
| Readout value | 13.5–14 / 17 | 600–650 | -0.01em to -0.012em |
| Small label / caption | 10.5–11 / 13–14 | 500–650 | +0.006em to +0.05em (all-caps captions use the high end + uppercase) |

Large text gets negative tracking, small text gets slightly positive.
Hierarchy comes from weight plus size plus leading as a set, not size alone.

### 5.2 Spacing and shape

4px scale. Card padding 12–16px (12 for compact). `--ha-card-border-radius` for
the card itself, and always about 1.7× that for the continuous-corner variant.
Continuous corners where supported:

```css
@supports (corner-shape: squircle) {
  ha-card { corner-shape: squircle; border-radius: calc(var(--radius) * 1.7); }
}
```

**Two shapes, two jobs.** What a thing looks like tells you what you can do with it:

| | Shape | Sizes | For |
|---|---|---|---|
| **Badge** | circle | S 28 (icon 16), M 36 (20), L 44 (22) | the icon of a thing: a room, light, lock, player, entity, a row in a popup, a chip's disc |
| **Control** | rounded square | S 32 (radius 11, icon 18), L 40 (radius 13, icon 21) | anything you press: power, swatch, step, transport, the header's home button and health cog, a popup's close, bulk and page buttons |

Chips are pills with two heights, 24 and 32. A compact layout picks the next size
down (S or M), never a size of its own. The tokens are `--b-s/-m/-l` and `--c-s/-l`,
defined once (`DESIGN_TOKENS` in `core/00-base.js`, repeated on the popup sheet), and the
spec `design-language` fails a card that draws a badge or control outside them.
The room tile's liquid drop is a badge of its own (L, 44) and keeps its look.

**Tones.** A badge or control is the well (6% of the text colour) when idle, 16% of its
state colour when on (`--mix-on`), 18% of amber or red when it is an alert
(`--mix-alert`). No card picks its own percentages.

### 5.3 Colour

- Inherit HA theme variables (`--primary-text-color`, `--secondary-text-color`,
  `--card-background-color`). Never hardcode a background or a text colour.
- Derive surfaces from the text colour so they work on any theme:
  `color-mix(in oklab, var(--primary-text-color) 6%, transparent)` for a
  "well", 9% for a hairline border.
- **Colour is reserved for energy and alerts.** Doors, covers and windows light up
  in the text colour. Lights, climate, media, leak, and alarm get a hue. The room
  activity card is the one exception: its states carry their own colour (presence
  the accent, open or unlocked amber, alerts red) unless `colored_states: false`.
- **Amber and red are one pair everywhere:** `--warn-rgb`, `--bad-rgb` (and `--good-rgb`),
  with `TONE` for the places that need a hex string. No card spells its own.
- **The state glow.** A soft radial wash in the top corner of the card, in the colour of
  what it is doing: a lit light, a locked door (green), an unlocked one (amber), music
  playing, heating, cleaning, an alert. Nothing when idle, at most 10% when
  active, one spring for colour and strength (`Motion.glow`, `stateGlow()`), snapping
  under reduced motion. It is on by default; `state_glow: false` on a card, or
  `design.state_glow: false` in the Savvy settings, turns it off. Cards without a
  state (graphs, headers, the camera, the settings card) have none, and a scene card
  has none because a scene is a moment, not a state.
- **A tinted accent drives the card.** Expose it as an RGB triplet custom
  property (`--accent: 90 169 224`) so `rgb(var(--accent) / 0.16)` works for
  fills, glows, and focus rings.
- On dark themes, light-emitting layers use `mix-blend-mode: plus-lighter` so
  they add light rather than painting over the card.
- A top-edge inset highlight on dark only:
  `inset 0 1px 0 rgb(255 255 255 / 0.05)`.

**Interpolated scales must have neighbours close in hue**, or the blend
passes through mud. A thermal ramp (blue, teal, green, amber, orange, red)
interpolates cleanly in plain RGB. Never place blue directly next to orange
in a scale that gets interpolated.

Mode and state palettes are keyed **case- and separator-insensitively**
(`norm(v) = lowercase, collapse [\s_-]+`) so `Movie Time`, `movie_time`, and
`movie time` all hit the same entry. Always allow a per-card override in
config (`mode_colors`, `mode_icons`). The palette lives once, in
`shared.js` (`MODE_COLORS`, `MODE_ICONS`), and `room-card`,
`room-heading-card`, `home-overview-card` and `room-overview-card` all read
it, so a mode looks identical everywhere it appears. Change a mode colour
there. Each card also keeps a copy as its standalone fallback; keep those
identical to `shared.js` when you change it.

### 5.4 Depth

Translucency and dimming, not borders. A page being left dims; a
scrolled-past edge gets a mask gradient, not a 1px rule. Overflowing rows
fade out:

```css
mask-image: linear-gradient(to right, transparent 0, #000 26px);
```

---

## 6. Layout and responsiveness

- `container-type: inline-size` on `ha-card`, and `@container` queries for
  every breakpoint. Never media queries: the card does not know the
  viewport, it knows its own width.
- Known breakpoints in use: 220 / 260 / 280 / 300 / 320 / 330 / 340 / 380 /
  420 / 440 / 460 / 680px, chosen per card as the point a specific element
  stops fitting, not a fixed global set.
- Degrade by **dropping labels before truncating them**. Segmented controls
  go icon-only, readout tiles lose their caption line, titles wrap onto
  their own row. An ellipsis is a last resort, and on a room name it's
  avoided entirely in favour of giving the title more of the row (§6.1).
- No `flex-wrap` on badge or chip rows; overflow is masked (or, per §6.1,
  made to scroll) instead.

### 6.1 The right-aligned-content-that-overflows trap

A right-aligned (`justify-content: flex-end`) row that overflows spills off
its **start** edge. Browsers create no scrollable area on that side, so
`row.scrollWidth > row.clientWidth` reads `false` even while content is
clipped and unreachable. This shipped once before it was caught by
measuring the actual rendered widths of the children.

The fix, used in `room-heading-card.js`: measure children directly to detect
overflow, and once it overflows, **switch the row to start-alignment with
real horizontal scrolling**, resting scrolled to the end (so the
most-frequently-used item, at the visual end, is what's in view at rest).
Re-pin to the end only when the content actually changes size, not on every
frame, so it never fights a user's manual scroll, and defer the pin a frame
(plus a short settle timeout) since making the attribute for `overflow-x` a
CSS `data-overflow` selector must land before `scrollWidth` is meaningful.

```js
_fitBadges() {
  const row = this._el.badges;
  let content = 0;
  for (const child of row.children) {
    if (child.hidden) continue;
    const cs = getComputedStyle(child);
    content += child.getBoundingClientRect().width
      + (parseFloat(cs.marginInlineStart) || 0) + (parseFloat(cs.marginInlineEnd) || 0);
  }
  const over = content > row.clientWidth + 1;
  row.toggleAttribute("data-overflow", over);
  if (over && Math.abs(this._lastWidth - content) > 1) this._pinEnd(row);
  this._lastWidth = over ? content : 0;
}
```

Also watch negative horizontal margins used for hit-area padding
(`margin: -6px`) on a row inside a flex container: they extend the box past
its logical edge and can push a parent page into horizontal scroll on a
phone. Use `margin: -6px 0` (vertical only) when the horizontal room isn't
actually needed.

---

## 7. Home Assistant integration

- **Discover, do not enumerate.** Use `hass.entities` and `hass.devices` to
  find what is in an area, filtered by domain and `device_class`. Skip
  `hidden`, `disabled_by`, and `entity_category` entities. Cache against the
  registry object's identity, since it only changes on config edits:
  ```js
  if (this._reg === h.entities && this._regD === h.devices) return this._ids;
  ```
- **Anything security-relevant is opt-in**, never discovered. Locks are
  named explicitly or they do not appear.
- Use `ha-state-icon` with `hass` + `stateObj` so icons follow the entity's
  own state (weather day/night, device classes) instead of a hardcoded
  mapping table.
- Use `hass.formatEntityState(stateObj[, state])` for user-facing state
  text, wrapped in try/catch with a title-cased fallback for older cores.
- Read units from `hass.config.unit_system` and the entity's own
  `unit_of_measurement`. Never assume Celsius.
- History: `hass.callWS({type: "history/history_during_period",
  minimal_response: true, no_attributes: true})`, falling back to the REST
  `history/period` path. Parse both row shapes (`s`/`lu` and
  `state`/`last_changed`). Append the live value so the line runs to now.
  Resample into fixed buckets (~120) rather than drawing raw rows.
- `setConfig` can be called repeatedly on a live element by the visual
  editor. Keep the shadow root in a separate field
  (`this._shadow || (this._shadow = this.attachShadow(...))`) and rebuild in
  place; calling `attachShadow` twice throws.
- Fire `hass-more-info` as a composed bubbling `CustomEvent`; navigate with
  `history.pushState` plus a `location-changed` event.
- **A device or entity may not be its own power switch.** A lamp behind a
  smart plug, a source whose sound comes out of a different box: let
  config declare the relationship (`power:`, `output:`, `volume:` pointing
  at another entity) and make every state read and every write go through
  that declared entity instead of the "obvious" one. See `lights-card.js`'s
  `power:` option and `media-card.js`'s `output`/`_volumeOwner`.

---

## 8. Popovers: mode pickers and colour pickers

Three cards (`home-overview-card`, `room-heading-card`, `lights-card`) open a
sheet from a pill or swatch: a mode picker or a colour/warmth picker. Same
pattern every time:

- **`position: fixed`, not absolute**, and placed *outside* `ha-card` in the
  DOM. `ha-card` sets `container-type`, which makes it a containing block for
  absolutely-positioned children, so a sheet taller than the card gets clipped
  and its lower options become unreachable. This shipped once (the mode
  picker on a 125px-tall overview card) before being caught.
- Positioned in JS against the anchor's `getBoundingClientRect()` on open,
  clamped to the viewport, with `transform-origin` set to the anchor's centre
  (`--ox` custom property) so it visibly grows out of what was tapped.
- An invisible scrim (`opacity: 0` even when "open") still captures a
  pointerdown to close, so a tap anywhere outside is a dismissal without
  visually dimming the rest of the page, since a heading-level control dimming an
  entire dashboard section would be too heavy-handed.
- Closes on: outside pointerdown (deferred one frame past open, so the
  opening tap doesn't immediately close it), `Escape`, `scroll`, and
  `resize`. All four listeners are added on open and fully removed on close
  and on `disconnectedCallback`, or they leak.
- Content inside the sheet only shows the rows relevant to *this* entity
  (e.g. a temperature-only light shows no hue/saturation strip), never a
  fixed set of controls regardless of capability.

---

## 9. Group / master controls

A "turn everything on/off" control for a room (lights, or a set of anything)
follows one of two shapes:

- **No dedicated helper**: tap toggles based on whether *any* member is on
  (`some(id => isOn(id))`): all-off if anything is on, all-on otherwise.
- **A dedicated helper is configured** (e.g. an `input_boolean` that
  drives the room's lighting automations): a single tap toggles *that*
  helper, and a double-tap is a distinct, more forceful action: force
  every light off directly, regardless of the helper's state, with its own
  `medium` haptic to mark it as the bigger action. Implement the double-tap
  as a short (~250ms) commit delay on the single-tap path, exactly as a
  card-level double-tap-to-toggle is implemented elsewhere; both share the
  same "don't pay for the delay unless the feature exists" rule from §3.1.

---

## 10. Compact variants and visual editors

### 10.1 Compact variants

A smaller version of a card is a **layout option of the same card**, not a
second element: `layout: compact` in config, a dropdown in the editor.
`setConfig` reads `this._compact = config.layout === "compact"`, and compact
mode strips bands and controls down in `_build()` / `_update()` behind
`if (this._compact)` branches; it never duplicates markup or logic the full
card already has. (The pre-Savvy cards shipped `-mini` element names; one
name per card keeps the card picker and the docs half the size.)

### 10.2 Visual (UI) editors

Where a card benefits from one (currently `lights-card`, for reordering
lights):

```js
class ThingCard extends HTMLElement {
  static getConfigElement() { return document.createElement("thing-card-editor"); }
}
class ThingCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._render(); }
  set hass(hass) { this._hass = hass; this._render(); }
  _emit(next) {
    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: next }, bubbles: true, composed: true,
    }));
    this._render();
  }
}
```

If the editor needs to show the card's own computed result (e.g. "which
lights did discovery find, in what order"), instantiate a throwaway instance
of the real card class and call its internal methods directly
(`new ThingCard(); probe._config = ...; probe._ordered()`) rather than
reimplementing the discovery logic a second time in the editor. The editor
must never write anything the card can't already read back out of config:
what you see in the editor is exactly what the card will render.

---

## 11. States that must not be forgotten

Every card handles all of these, and each one gets a test:

- entity missing from `hass.states` entirely
- entity `unavailable` or `unknown`: say so, grey and disable the controls,
  leave unrelated entities on the card live
- attribute missing (no target temperature, no brightness, no history, no
  colour mode)
- the recorder has nothing for an entity: explain it in place, do not draw
  an empty chart
- imperial units, and steps of 1 instead of 0.5
- a value that makes a control meaningless (target at min or max disables
  the stepper; a light with `onoff` only gets no slider at all)
- an entity reachable only through another declared entity (§7's last
  bullet) being itself unavailable while the thing it controls is fine, and
  vice versa

---

## 12. Accessibility

- `prefers-reduced-motion: reduce` means values change without travelling:
  snap the springs, express press feedback as opacity instead of scale,
  cross-fade instead of sliding. A popover's open/close spring is the one
  exception worth keeping animated even under reduced motion, since it's a
  state change the person needs to track, not decoration; snap everything
  else.
- `prefers-contrast: more` raises border and secondary-text contrast and
  lifts idle opacities.
- `aria-label` on every control including its current value,
  `aria-pressed`/`aria-selected` on toggles and options,
  `aria-valuemin/max/now` on sliders, `aria-hidden` on decorative layers and
  hidden pages, `tabIndex = -1` on anything invisible so it leaves the tab
  order.
- **Focus rings are for keyboard users.** Touch browsers treat a tapped
  `role="button"` as `:focus-visible`, which left an outline on whatever
  was last touched. Each card file tracks the last input (a navigation key
  vs. a pointer) and mirrors it onto its host as `[kbd]`; every focus ring,
  outline or box-shadow, is drawn only under `:host([kbd])`, and a plain
  `:focus` gets `outline: none` otherwise. Text inputs keep their focus
  style.

---

## 13. Configuration style

- Sensible defaults; almost everything optional. `entity` or `area` is
  usually the only required key.
- Accept a bare string wherever an object is accepted
  (`timer: timer.x` and `timer: {entity: timer.x, select: input_select.y}`
  both work; a `lights:` list item can be `light.x` or
  `{entity: light.x, power: switch.y}`).
- Never assume an entity-id convention. Everything is discovered through the
  area, device and entity registries and `device_class`; config can name any
  entity explicitly.
- Every palette, scale, and threshold overridable from YAML
  (`mode_colors`, `mode_icons`, `temperature_scale`, `humidity_color`, …).
- A compact variant is `layout: compact` on the same card (§10.1), never a
  second element name.

---

## 14. Test checklist before shipping

Run in headless Chromium against stub `ha-card` / `ha-icon` / `ha-state-icon`
elements and a mock `hass` (see `test/README.md` and `test/ha-stubs.js`):

1. Both themes, at least three widths including the narrowest realistic one.
2. Every tap, hold, double-tap, drag, and swipe, asserting the exact service
   calls and events.
3. Gesture arbitration: swipe starting on a button, drag-away-to-cancel,
   vertical scroll passthrough.
4. Keyboard: Enter and Space on every control, arrow keys on sliders.
5. All of §11's broken states.
6. `prefers-reduced-motion`.
7. The animation loop reaches zero active springs when nothing is moving.
8. No console errors, and `node --check` on the file.
9. Step springs frame-by-frame for anything physical (fills, drops, fans),
   and interrupt an animation mid-flight to confirm it blends instead of
   jumping.
10. If the card opens a popover (§8): confirm it isn't clipped by an
    ancestor's `container-type`, and that all four dismiss paths (outside
    tap, Escape, scroll, resize) both close it and remove their listeners.
