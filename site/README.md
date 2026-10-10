# Savvy Cards demo

A live dashboard you can play with in your browser: every Savvy card, on a made-up house, laid out the
way a real Home Assistant dashboard is. Nothing to download or install, and nothing is connected to a
real home.

**Open it: [savvy-cards.gabrielmazor.com](https://savvy-cards.gabrielmazor.com)**

## What you can try

- **The home page:** the home header, a tile per room, people. Tap a room to open it.
- **A page per room** (living room, kitchen, office, bedroom, bathroom, toilet): lights, climate, media,
  covers, locks, cameras, scenes and the room's activity.
- **Lights:** tap one to switch it, drag sideways to dim it, hold it for its details. Each room has a master
  switch for its lights.
- **Modes:** change the home mode (Daytime, Evening, Night, Sleep, Away) and every room in Sync follows;
  give a room its own mode (Cooking, Dining, Watching TV, Music, Focus...) and its lights change with it.
  Turn a TV on and its room goes to Watching TV.
- **Media:** pick what you watch, skip a song, move the volume, switch the soundbar's source.
- **Climate, security, admin:** set the A/C, lock a door, look through the cameras and system health.
- **Light and dark:** the switch at the top right.

Everything answers the way a house would, a moment after you tap, and every card on the page follows.
Reload the page to start over.

## Changing the demo

The demo is the real card code from `dist/`, running on a fake Home Assistant in `assets/hass.js`.
To preview a change locally:

```sh
node build.mjs                      # build the cards (repo root)
npm install --no-save @mdi/js       # the icons, once
node site/build.mjs --serve         # http://localhost:8080
```

| File | What it holds |
|---|---|
| `assets/house.js` | The house: rooms, devices, people, playlists with drawn covers |
| `assets/hass.js` | The fake Home Assistant: services, modes and room lighting, history, energy, logbook, Frigate |
| `assets/pages.js` | Every page and every card's config; the settings the cards share |
| `assets/ha-shim.js` | `ha-card`, `ha-icon`, `ha-state-icon`, and the drawn camera feeds |
| `assets/app.js` | Navigation, theme, the details panel, and the sections layout (three columns, one on a phone) |
| `assets/site.css` | The site's look, and the theme variables the cards read |
