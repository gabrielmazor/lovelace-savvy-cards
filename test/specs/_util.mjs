// Helpers shared by the card specs.
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
  return { page, errors };
}

// true once every mounted card's springs have settled (the clock must go to sleep)
export async function idle(page, timeout = 4000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const busy = await page.evaluate(() => window.cards.filter((c) => (c._springs || []).some((s) => !s.idle)).length);
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
