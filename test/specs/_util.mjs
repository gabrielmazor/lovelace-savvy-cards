// Helpers shared by the card specs.

// A spec whose timing is the point (a debounce window, a timeout) reads the clock plainly.
export function uncalm(page) { if (page.__wait) page.waitForTimeout = page.__wait; }

// Colours slide, text rolls and rows move now, so a spec that waits a fixed time and then reads the
// page should read it at rest: after every waitForTimeout the page's Motion is waited on as well.
export function calm(page) {
  const wait = page.__wait = page.__wait || page.waitForTimeout.bind(page);
  page.waitForTimeout = async (ms) => {
    await wait(ms);
    await page.waitForFunction(() => !window.__savvy?.Motion?.busy(), null, { timeout: 4000 }).catch(() => {});
  };
}
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.test-shots");

// A test page on the made-up house, in a theme, at a viewport width.
export async function openPage(browser, base, { theme = "dark", width = 1000, dpr = 2 } = {}) {
  const page = await browser.newPage({ viewport: { width: Math.max(width + 80, 480), height: 1400 }, deviceScaleFactor: dpr });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (theme === "light") {
    await page.addInitScript(() => new MutationObserver((_, o) => { if (document.body) { document.body.classList.add("light"); o.disconnect(); } })
      .observe(document, { childList: true, subtree: true }));
  }
  await page.goto(base + "page.html");
  await page.waitForFunction(() => window.__savvy && window.mount);
  calm(page);
  return { page, errors };
}

// true once every mounted card's springs have settled (the clock must go to sleep)
export async function idle(page, timeout = 4000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const busy = await page.evaluate(() => window.cards.filter((c) => (c._springs || []).some((s) => !s.idle)).length
      + (window.__savvy?.Motion?.busy() ? 1 : 0));
    if (!busy) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

// a screenshot of one mounted card into .test-shots/ (git-ignored), for a human look
export async function shot(page, name, index = 0) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const el = await page.evaluateHandle((i) => window.cards[i], index);
  await el.asElement().screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// center of an element inside a card's shadow root
export const centerOf = (page, index, selector) => page.evaluate(({ index, selector }) => {
  const r = window.cards[index].shadowRoot.querySelector(selector).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { index, selector });

// Sample a value in the page once per animation frame for `ms`. `read` is a function that runs
// inside the page (it may use window.__savvy, window.cards ...) and returns something small.
export async function frames(page, read, ms = 700) {
  return page.evaluate(({ src, ms }) => new Promise((resolve) => {
    const f = (0, eval)(`(${src})`), out = [], t0 = performance.now();
    const tick = () => { out.push(f()); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(out); };
    tick();
  }), { src: read.toString(), ms });
}

// wait until Motion has nothing left to do
export async function settle(page, timeout = 4000) {
  await page.waitForFunction(() => !window.__savvy.Motion.busy(), null, { timeout });
}

// Run `change` inside the page, then sample `read` once per frame for `ms` (starting in the same frame).
export async function afterChange(page, change, read, ms = 900) {
  return page.evaluate(({ chg, src, ms }) => new Promise((resolve) => {
    const c = (0, eval)(`(${chg})`), f = (0, eval)(`(${src})`), out = [], t0 = performance.now();
    c();
    const tick = () => { out.push(f()); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(out); };
    tick();
  }), { chg: change.toString(), src: read.toString(), ms });
}
