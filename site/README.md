# Savvy Cards demo

A live dashboard you can play with in your browser: every Savvy card, on a made-up house, laid out the
way a real Home Assistant dashboard is. Nothing to download or install, and nothing is connected to a
real home.

**Open it: [savvy-cards.gabrielmazor.com](https://savvy-cards.gabrielmazor.com)**

## What you can try

- **The home page:** the home header, a tile per room, people. Tap a room to open it.
- **A page per room** (living room, kitchen, office, bedroom, bathroom, toilet): lights, climate, media,
  covers, locks, cameras and the room's activity.
- **Lights:** tap one to switch it, drag sideways to dim it, hold it for its details. Each room has a master
  switch for its lights, and the palette button beside it lists the room's scenes.
- **Modes:** change the home mode (Daytime, Evening, Night, Sleep, Away) and every room in Sync follows;
  give a room its own mode (Cooking, Dining, Watching TV, Music, Focus...) and its lights change with it.
  Turn a TV on and its room goes to Watching TV.
- **Media:** pick what you watch, skip a song, move the volume, switch the soundbar's source.
- **Climate, security, admin:** set the A/C, lock a door, look through the cameras and system health.
- **The living room camera follows the lights:** the lamp in the footage is the Arc Lamp. Switch it, dim it or
  change its warmth and the room on camera changes with it.
- **Light and dark:** the switch at the top right.

Everything answers the way a house would, a moment after you tap, and every card on the page follows.
Reload the page to start over.

The house lives on its own too, gently: every minute or so someone moves between rooms, cooks, takes a call,
showers, reads in bed or goes out for a walk, and the rooms' presence and modes follow. It holds back for a
minute whenever you use a card. Add `&still` to the address to stop it.

## Changing the demo

The demo is the real card code from `dist/`, running on a fake Home Assistant in `assets/hass.js`.
To preview a change locally:

```sh
node build.mjs                      # build the cards (repo root)
npm install --no-save @mdi/js       # the icons, once
node site/build.mjs --serve         # http://localhost:8080
```

The link preview (`assets/og.jpg`, with the touch icon `assets/icon-180.png`) is drawn from the real cards;
redraw it after the cards' look changes: `PLAYWRIGHT=$(npm root -g)/playwright node site/og.mjs`.

| File | What it holds |
|---|---|
| `assets/house.js` | The house: rooms, devices, people, playlists with drawn covers |
| `assets/hass.js` | The fake Home Assistant: services, modes and room lighting, the residents' own moments, history, energy, logbook, Frigate |
| `assets/pages.js` | Every page and every card's config; the settings the cards share |
| `assets/ha-shim.js` | `ha-card`, `ha-icon`, `ha-state-icon`, and the camera feeds (the living room's lamp relit from the house) |
| `assets/cams/` | The camera loops (MP4 and WebM), stills and review thumbnails, and the living room lamp's light map. Footage from [Mixkit](https://mixkit.co) under the Mixkit Free License |
| `assets/app.js` | Navigation, theme, the details panel, and the sections layout (three columns, one on a phone) |
| `assets/site.css` | The site's look, and the theme variables the cards read |
