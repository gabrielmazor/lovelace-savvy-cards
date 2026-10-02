// Going to the page that is already open does nothing (pushing the same path makes the dashboard
// rebuild the view and the page jumps back to the top); any other page still navigates.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { width: 420 });
  const r = await page.evaluate(() => {
    history.replaceState({}, "", "/lovelace/admin");
    const seen = [];
    window.addEventListener("location-changed", () => seen.push(location.pathname + location.search));
    const push = history.pushState;
    let pushes = 0;
    history.pushState = function (...a) { pushes++; return push.apply(this, a); };
    const N = window.__savvy.navigate;
    const log = [];
    const step = (name, fn) => { const p0 = pushes; fn(); log.push([name, pushes - p0, location.pathname + location.search]); };
    step("same path", () => N("/lovelace/admin"));
    step("trailing slash", () => N("/lovelace/admin/"));
    step("relative to here", () => N("admin"));
    step("another page", () => N("/lovelace/lights"));
    step("relative another page", () => N("security"));
    step("same page, another query", () => N("/lovelace/security?tab=2"));
    step("same page and query", () => N("/lovelace/security?tab=2"));
    // an action does the same through the shared helper
    const host = document.createElement("div");
    step("navigate action, same page", () => window.__savvy.runAction(host, window.hass, { action: "navigate", navigation_path: "/lovelace/security?tab=2" }, {}));
    step("navigate action, other page", () => window.__savvy.runAction(host, window.hass, { action: "navigate", navigation_path: "/lovelace/home" }, {}));
    history.pushState = push;
    return { log, events: seen.length };
  });
  const by = Object.fromEntries(r.log.map(([n, c, p]) => [n, { c, p }]));
  check("the page that is open is not pushed again, with or without a trailing slash or a relative path",
    by["same path"].c === 0 && by["trailing slash"].c === 0 && by["relative to here"].c === 0, JSON.stringify(r.log));
  check("another page navigates, absolute or relative", by["another page"].c === 1 && by["another page"].p === "/lovelace/lights"
    && by["relative another page"].c === 1 && by["relative another page"].p === "/lovelace/security", JSON.stringify(r.log));
  check("another query is another page; the same query is not", by["same page, another query"].c === 1 && by["same page and query"].c === 0, JSON.stringify(r.log));
  check("a navigate action follows the same rule", by["navigate action, same page"].c === 0 && by["navigate action, other page"].c === 1, JSON.stringify(r.log));
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
