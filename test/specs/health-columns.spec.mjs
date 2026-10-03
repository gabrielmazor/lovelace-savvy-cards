// savvy-system-health-card: a column per category when the card is wide, one list per column, and a
// short list never keeps the page from scrolling.
import { openPage, idle } from "./_util.mjs";

const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];

const geometry = `(el) => {
  const R = el.shadowRoot, boxes = [...R.querySelectorAll(".rows")];
  const head = R.getElementById("head").getBoundingClientRect(), card = R.querySelector("ha-card").getBoundingClientRect();
  return { n: boxes.length, xs: new Set(boxes.map((b) => Math.round(b.getBoundingClientRect().x))).size, headW: Math.round(head.width), cardW: Math.round(card.width),
    titles: boxes.map((b) => b.querySelector(".gt")?.textContent) };
}`;

export default async function ({ browser, base, check }) {
  const engine = browser.browserType().name();
  for (const theme of ["dark", "light"]) {
    const tag = `[${theme}]`;
    const { page, errors } = await openPage(browser, base, { theme, width: 1000 });
    await page.setViewportSize({ width: 1100, height: 1300 });
    const r = await page.evaluate(async ({ W, geometry }) => {
      const geo = eval(geometry);
      const mk = (cfg, w) => window.mount("savvy-system-health-card", cfg, w);
      const cards = { narrow: mk({ watchman: W }, 320), mid: mk({ watchman: W }, 560), wide: mk({ watchman: W }, 1000), two: mk({ watchman: W, columns: 2 }, 1000),
        one: mk({ watchman: W, columns: 1 }, 1000), noW: mk({}, 1000), batt: mk({ source: "battery" }, 1000), offline: mk({ source: "offline" }, 1000) };
      await new Promise((res) => setTimeout(res, 500));
      return Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, geo(v)]));
    }, { W, geometry });
    check(`${tag} narrow stays stacked`, r.narrow.n === 3 && r.narrow.xs === 1, JSON.stringify(r.narrow));
    check(`${tag} a medium card shows two columns, a wide one three, in order`, r.mid.xs === 2 && r.wide.xs === 3
      && JSON.stringify(r.wide.titles) === JSON.stringify(["Watchman", "Offline devices", "Low batteries"]), JSON.stringify([r.mid, r.wide]));
    check(`${tag} columns caps them, 1 keeps them stacked`, r.two.xs === 2 && r.one.xs === 1, JSON.stringify([r.two.xs, r.one.xs]));
    check(`${tag} without Watchman sensors there are two columns; one source is one column`, r.noW.n === 2 && r.noW.xs === 2 && r.batt.n === 1 && r.batt.xs === 1 && r.offline.xs === 1, JSON.stringify([r.noW, r.batt, r.offline]));
    check(`${tag} the title and pill span the whole card`, r.wide.headW >= r.wide.cardW - 40, JSON.stringify(r.wide));

    // one list per column, each with its own rows limit; nothing is re-appended on an update
    const s = await page.evaluate(async () => {
      const patch = {};
      for (let i = 0; i < 12; i++) patch["sensor.gone_" + i] = { state: "unavailable", attributes: { friendly_name: "Gone " + i } };
      for (let i = 0; i < 12; i++) patch["sensor.batt_" + i] = { state: String(3 + i), attributes: { device_class: "battery", friendly_name: "Battery " + i, unit_of_measurement: "%" } };
      window.setStates(patch);
      const el = window.mount("savvy-system-health-card", { watchman: ["sensor.watchman_missing_entities"], max_rows: 3, group_by: "none" }, 1000);
      await new Promise((res) => setTimeout(res, 500));
      const boxes = [...el.shadowRoot.querySelectorAll(".rows")];
      const info = () => boxes.map((b) => ({ over: b.hasAttribute("data-overflow"), h: Math.round(b.clientHeight), sh: b.scrollHeight, top: b.scrollTop }));
      const before = info();
      boxes[1].scrollTop = 80;
      let moved = 0;
      const mo = new MutationObserver((l) => { moved += l.reduce((a, m) => a + m.addedNodes.length + m.removedNodes.length, 0); });
      mo.observe(el.shadowRoot, { childList: true, subtree: true });
      window.setStates({ "sensor.living_room_temperature": "22.5" });
      await new Promise((res) => setTimeout(res, 300));
      mo.disconnect();
      return { before, after: info(), moved, same: boxes.every((b, i) => b === [...el.shadowRoot.querySelectorAll(".rows")][i]) };
    });
    check(`${tag} each column keeps its own rows limit and scrolls on its own`, s.before.filter((b) => b.over).length >= 2 && s.before.every((b) => b.h <= 3 * 38 + 2)
      && s.after[1].top === 80 && s.after[0].top === 0 && s.after[2].top === 0, JSON.stringify(s));
    check(`${tag} a state update re-appends nothing`, s.moved === 0 && s.same, JSON.stringify(s));

    // the cog's popup stays stacked
    const pop = await page.evaluate(async () => {
      const c = window.mount("savvy-home-header-card", { health: { watchman: ["sensor.watchman_missing_entities"] }, lights: false, climate: false, media: false, security: false }, 1000);
      await new Promise((res) => setTimeout(res, 400));
      c._showHealth();
      await new Promise((res) => setTimeout(res, 600));
      const card = window.__savvy.portalRoot().querySelector("savvy-system-health-card");
      const boxes = [...card.shadowRoot.querySelectorAll(".rows")];
      return { n: boxes.length, xs: new Set(boxes.map((b) => Math.round(b.getBoundingClientRect().x))).size };
    });
    check(`${tag} the cog's health popup is one column`, pop.n >= 2 && pop.xs === 1, JSON.stringify(pop));
    await page.keyboard.press("Escape");

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // a short list lets the page scroll over it; a long one keeps its own scroll
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    await page.setViewportSize({ width: 500, height: 700 });
    await page.evaluate(() => {
      document.body.style.minHeight = "5000px";
      document.getElementById("stage").style.paddingTop = "400px";
      window.mount("savvy-system-health-card", { watchman: ["sensor.watchman_missing_entities"], max_rows: 250 }, 420);
    });
    await page.waitForTimeout(500);
    const css = await page.evaluate(() => {
      const box = window.cards[0].shadowRoot.querySelector(".rows");
      return { overflow: box.hasAttribute("data-overflow"), contain: getComputedStyle(box).overscrollBehaviorY };
    });
    check("[wheel] a list that does not scroll does not claim the gesture", !css.overflow && css.contain === "auto", JSON.stringify(css));
    const p = await page.evaluate(() => { const r = window.cards[0].shadowRoot.querySelector(".row").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(500);
    const y = await page.evaluate(() => Math.round(window.scrollY));
    check("[wheel] the wheel over a short health card scrolls the page", y > 100, String(y));
    check("[wheel] no errors", errors.length === 0, errors.join(" | "));
    await page.close();

    if (engine === "chromium") {
      const ctx = await browser.newContext({ viewport: { width: 500, height: 700 }, hasTouch: true, isMobile: true });
      const t = await ctx.newPage();
      await t.goto(base + "page.html");
      await t.waitForFunction(() => window.__savvy && window.mount);
      await t.evaluate(() => {
        document.body.style.minHeight = "5000px";
      document.getElementById("stage").style.paddingTop = "400px";
        window.mount("savvy-system-health-card", { watchman: ["sensor.watchman_missing_entities"], max_rows: 250 }, 420);
      });
      await t.waitForTimeout(500);
      // the swipe starts inside the visible page whatever the fonts of this machine make of the layout
      const q = await t.evaluate(() => {
        const r = window.cards[0].shadowRoot.querySelector(".row").getBoundingClientRect();
        return { x: r.x + r.width / 2, y: Math.min(r.y + r.height / 2, innerHeight - 40), vh: innerHeight, row: Math.round(r.y) };
      });
      const cdp = await ctx.newCDPSession(t);
      await cdp.send("Input.synthesizeScrollGesture", { x: q.x, y: q.y, yDistance: -300, speed: 800, gestureSourceType: "touch" });
      await t.waitForTimeout(600);
      const ty = await t.evaluate(() => Math.round(window.scrollY));
      check("[touch] a swipe starting on a short health card scrolls the page", ty > 100, `${ty} (swipe from ${JSON.stringify(q)})`);
      await ctx.close();
    }
  }
}
