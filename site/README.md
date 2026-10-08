# Savvy Cards demo site

A live demo of every Savvy card on a made-up house: six rooms with their lights, climate,
media, covers, fans and cameras; pages for lights, climate, media, security and health; a
home page with the compact layouts. Every card is the real code from `dist/`, running on a
fake Home Assistant (`assets/hass.js`) that answers taps the way a house would.

## Run it

```sh
node build.mjs                      # build the cards (repo root)
npm install --no-save @mdi/js       # the icons, once
node site/build.mjs --serve         # http://localhost:8080
```

`site/build.mjs` fills `site/vendor/` (the built cards and the icon map); that folder is not
committed. After it runs, `site/` is a complete static site: put it on any host.

## Put it on your domain

GitHub Pages: in the repo's Settings, Pages, choose "GitHub Actions" as the source, then run
the **Demo site** workflow from the Actions tab. Add your domain under Settings, Pages, and
point a CNAME record (www) or A records (apex) at GitHub as that page explains.

Any other static host (Netlify, Cloudflare Pages, a plain server): build as above and
publish the `site/` folder. Pages are addresses like `?p=living-room`, so no rewrite rules
are needed.

## What is where

| File | What it holds |
|---|---|
| `assets/house.js` | The house: rooms, devices, people, playlists with drawn covers |
| `assets/hass.js` | The fake Home Assistant: services, history, energy, logbook, Frigate |
| `assets/pages.js` | Every page and every card's config; the settings the cards share |
| `assets/ha-shim.js` | `ha-card`, `ha-icon`, `ha-state-icon`, and the drawn camera feeds |
| `assets/app.js` | Navigation, theme, the details panel |
| `assets/site.css` | The site's look, and the theme variables the cards read |
