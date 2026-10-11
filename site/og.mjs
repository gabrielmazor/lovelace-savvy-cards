// Draws the demo's share image (assets/og.jpg, 1200×630 at 2x) and its touch icon (assets/icon-180.png) from the
// real cards: it serves site/, opens the demo, and stages a few of its live cards beside the name.
//   node site/build.mjs && PLAYWRIGHT=$(npm root -g)/playwright node site/og.mjs
// Run it again after the cards' look changes; the two images are committed.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PLAYWRIGHT || "playwright", "/"));
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const file = path.join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2, colorScheme: "dark" });
await page.goto(`${base}?p=home&still`);
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const pick = (sel, n = 0) => document.querySelectorAll(sel)[n];
  const cards = {
    tile: pick("savvy-room-tile", 0),
    tile2: pick("savvy-room-tile", 2),
    lights: pick("savvy-lights-card", 0),
    climate: pick("savvy-climate-card", 0),
    media: pick("savvy-media-card", 0),
  };
  const mark = document.querySelector(".brand svg").outerHTML;
  document.body.innerHTML = "";
  document.documentElement.dataset.theme = "dark";
  const style = document.createElement("style");
  style.textContent = `
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: #0d0e12; }
    .og { position: relative; width: 1200px; height: 630px; overflow: hidden; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
      background:
        radial-gradient(620px 420px at 78% 18%, rgb(245 184 61 / 0.30), transparent 70%),
        radial-gradient(560px 460px at 92% 96%, rgb(132 98 255 / 0.32), transparent 72%),
        radial-gradient(520px 380px at 6% 110%, rgb(88 142 233 / 0.20), transparent 70%),
        linear-gradient(160deg, #15161c 0%, #0d0e12 60%); }
    .og::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.06;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
    .copy { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; gap: 22px; z-index: 2; color: #f4f4f6; }
    .logo { display: flex; align-items: center; gap: 16px; }
    .logo i { width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center; color: #f5b83d;
      background: linear-gradient(160deg, #26262c, #18181c); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08), 0 10px 30px rgb(0 0 0 / 0.4); }
    .logo svg { width: 36px; height: 36px; }
    .logo b { font-size: 24px; font-weight: 600; letter-spacing: -0.01em; color: #c9c9d1; }
    h1 { margin: 0; font-size: 76px; line-height: 0.98; font-weight: 750; letter-spacing: -0.045em; }
    h1 span { background: linear-gradient(100deg, #ffd27a, #f5b83d 45%, #e8844f); -webkit-background-clip: text; background-clip: text; color: transparent; }
    p { margin: 0; font-size: 27px; line-height: 1.32; font-weight: 450; letter-spacing: -0.012em; color: #b9bac4; }
    .row { display: flex; align-items: center; gap: 10px; margin-top: 6px; white-space: nowrap; }
    .pill { flex: none; display: inline-flex; align-items: center; gap: 9px; height: 42px; padding: 0 17px; border-radius: 99px; font-size: 18px; font-weight: 600; letter-spacing: -0.005em; }
    .pill.live { background: #f5b83d; color: #1a1408; }
    .pill.live::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: #1a1408; box-shadow: 0 0 0 4px rgb(26 20 8 / 0.18); }
    .pill.url { background: rgb(255 255 255 / 0.07); color: #d7d8de; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.10); }
    .stage { position: absolute; left: 545px; top: -30px; width: 760px; height: 720px; perspective: 1700px; z-index: 1; }
    .plane { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(16deg) rotateY(-20deg) rotateZ(6deg) scale(0.9); transform-origin: 30% 50%; }
    .slot { position: absolute; border-radius: 22px; box-shadow: 0 30px 60px rgb(0 0 0 / 0.55), 0 8px 18px rgb(0 0 0 / 0.35); }
    .slot > * { display: block; }
  `;
  document.head.appendChild(style);
  const og = document.createElement("div");
  og.className = "og";
  og.innerHTML = `
    <div class="copy">
      <div class="logo"><i>${mark}</i><b>For Home Assistant</b></div>
      <h1>Savvy<br><span>Cards</span></h1>
      <p>Dashboard cards that find your rooms, lights, climate and media by themselves.</p>
      <div class="row"><span class="pill live">Live demo</span><span class="pill url">savvy-cards.gabrielmazor.com</span></div>
    </div>
    <div class="stage"><div class="plane"></div></div>`;
  document.body.appendChild(og);
  const plane = og.querySelector(".plane");
  const place = (el, x, y, w, z = 0) => {
    if (!el) return;
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;transform:translateZ(${z}px)`;
    el.style.width = "100%";
    slot.appendChild(el);
    plane.appendChild(slot);
  };
  place(cards.lights, 40, 150, 430, 0);
  place(cards.tile, 500, 120, 240, 40);
  place(cards.tile2, 500, 256, 240, 30);
  place(cards.climate, 60, 400, 420, 60);
  place(cards.media, 500, 400, 420, 90);
});
await page.waitForTimeout(1800);
// a JPEG at 2x: sharp on a phone, and small enough (well under 300 KB) for every app's link preview
await page.screenshot({ path: path.join(SITE, "assets/og.jpg"), type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: 1200, height: 630 } });

// the touch icon: the mark on its dark plate, as a phone's home screen shows it
const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(`<body style="margin:0;background:#1b1b1d">${fs.readFileSync(path.join(SITE, "assets/favicon.svg"), "utf8").replace("<svg ", '<svg width="180" height="180" ')}</body>`);
await icon.screenshot({ path: path.join(SITE, "assets/icon-180.png"), clip: { x: 0, y: 0, width: 180, height: 180 } });

await browser.close();
server.close();
console.log("wrote assets/og.jpg and assets/icon-180.png");
