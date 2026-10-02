// The bulk action at the top of a popup, next to the Room | Recent switch: All off for lights and
// climate, Pause all for media, Lock all for security. It acts on exactly what the popup lists
// (so what a chip ignores is left alone), only on what still needs it, and bulk_action: false hides it.
import { openPage } from "./_util.mjs";

const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(500); };
const chipAt = (page, card, i) => page.evaluate(({ card, i }) => { const el = window.cards[card].shadowRoot.querySelectorAll("#chips .chip")[i]; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { card, i });
const close = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(450); };
const bulk = (page) => page.evaluate(() => {
  const b = window.__savvy.portalRoot().querySelector(".sv-bulk");
  const tools = window.__savvy.portalRoot().querySelector(".sv-tools");
  if (!b || b.hidden || !tools || tools.hidden) return null;
  const r = b.getBoundingClientRect();
  return { label: b.textContent.trim(), disabled: b.hasAttribute("disabled"), aria: b.getAttribute("aria-label"), x: r.x + r.width / 2, y: r.y + r.height / 2,
    seg: !!tools.querySelector(".sv-seg:not([hidden])"), rows: [...window.__savvy.portalRoot().querySelectorAll(".sv-row")].map((x) => x.dataset.id), solo: tools.hasAttribute("data-solo") };
});
const rawCalls = (page) => page.evaluate(() => window.raw.map(([d, s, data, t]) => ({ d, s, data, ids: [].concat(t?.entity_id || []).sort() })));
const clear = (page) => page.evaluate(() => { window.raw.length = 0; });

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 560], ["light", 360]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width: width + 80, height: 1300 });
    await page.evaluate((width) => {
      window.raw = [];
      const orig = window.hass.callService;
      window.hass.callService = (d, s, data, t) => { window.raw.push([d, s, data, t]); return orig(d, s, data, t); };
      window.mount("savvy-home-header-card", { health: false }, width);                                                                          // 0: defaults
      window.mount("savvy-home-header-card", { health: false, lights: { exclude: ["light.porch"], exclude_areas: ["bedroom"] } }, width);         // 1: ignoring
      window.mount("savvy-home-header-card", { health: false, lights: { bulk_action: false }, security: { bulk_action: false } }, width);         // 2: no bulk
      window.mount("savvy-home-header-card", { health: false, lights: { sort_toggle: false } }, width);                                          // 3: bulk without the sort switch
      localStorage.clear();
    }, width);
    await page.waitForTimeout(500);
    const on = await page.evaluate(() => window.__savvy.houseLights(window.hass).on.slice().sort());

    // ---- lights: All off, for exactly the lights that are on and listed
    await hold(page, await chipAt(page, 0, 0));
    const l = await bulk(page);
    check(`${tag} the lights popup has an "All off" action beside the sort switch`, l && l.label === "All off" && !l.disabled && l.seg, JSON.stringify(l));
    await clear(page);
    await page.mouse.click(l.x, l.y);
    await page.waitForTimeout(250);
    const calls = await rawCalls(page);
    check(`${tag} it turns off every listed light that is on, in one call`, calls.length === 1 && calls[0].d === "light" && calls[0].s === "turn_off" && JSON.stringify(calls[0].ids) === JSON.stringify(on), JSON.stringify([calls, on]));
    await close(page);

    // ---- ignoring: what the chip leaves out is left alone
    await hold(page, await chipAt(page, 1, 0));
    const li = await bulk(page);
    await clear(page);
    await page.mouse.click(li.x, li.y);
    await page.waitForTimeout(250);
    const ci = await rawCalls(page);
    check(`${tag} ignored lights and rooms are not touched`, ci.length === 1 && !ci[0].ids.includes("light.porch") && !ci[0].ids.some((id) => /bedroom/.test(id)) && ci[0].ids.length > 0 && ci[0].ids.length < on.length, JSON.stringify([ci, on]));
    check(`${tag} ...and it acts on what the popup lists`, ci[0].ids.every((id) => li.rows.includes(id)), JSON.stringify([ci[0].ids, li.rows]));
    await close(page);

    // ---- climate, media, security
    await hold(page, await chipAt(page, 0, 1));
    const cl = await bulk(page);
    await clear(page);
    await page.mouse.click(cl.x, cl.y);
    await page.waitForTimeout(250);
    const cc = await rawCalls(page);
    check(`${tag} climate: All off, for the units that are running`, cl.label === "All off" && cc.length === 1 && cc[0].d === "climate" && cc[0].s === "turn_off" && JSON.stringify(cc[0].ids) === JSON.stringify(["climate.living_room_ac"]), JSON.stringify([cl, cc]));
    await close(page);

    await hold(page, await chipAt(page, 0, 2));
    const m = await bulk(page);
    await clear(page);
    await page.mouse.click(m.x, m.y);
    await page.waitForTimeout(250);
    const mc = await rawCalls(page);
    check(`${tag} media: Pause all, for the players that are playing`, m.label === "Pause all" && mc.length === 1 && mc[0].d === "media_player" && mc[0].s === "media_pause"
      && JSON.stringify(mc[0].ids) === JSON.stringify(["media_player.kitchen_speaker", "media_player.living_room_tv"]), JSON.stringify([m, mc]));
    await close(page);

    await hold(page, await chipAt(page, 0, 3));
    const s = await bulk(page);
    await clear(page);
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(250);
    const sc = await rawCalls(page);
    check(`${tag} security: Lock all, only for the locks that are not locked`, s.label === "Lock all" && sc.length === 1 && sc[0].d === "lock" && sc[0].s === "lock" && JSON.stringify(sc[0].ids) === JSON.stringify(["lock.back_door"]), JSON.stringify([s, sc]));
    // nothing left to do: the action is off
    await page.evaluate(() => { window.setStates({ "lock.back_door": "locked" }); window.cards[0]._list.render(window.hass); });
    await page.waitForTimeout(200);
    const done = await bulk(page);
    await clear(page);
    await page.evaluate(() => window.__savvy.portalRoot().querySelector(".sv-bulk").click());
    check(`${tag} with every lock locked the action is disabled and does nothing`, done?.disabled === true && (await rawCalls(page)).length === 0, JSON.stringify(done));
    await close(page);
    await page.evaluate(() => window.setStates({ "lock.back_door": "unlocked" }));

    // ---- bulk_action: false
    await hold(page, await chipAt(page, 2, 0));
    const hidden = await bulk(page);
    const sortStill = await page.evaluate(() => !!window.__savvy.portalRoot().querySelector(".sv-tools .sv-seg:not([hidden])"));
    check(`${tag} bulk_action: false hides it; the sort switch stays`, hidden === null && sortStill, JSON.stringify([hidden, sortStill]));
    await close(page);
    await hold(page, await chipAt(page, 2, 3));
    check(`${tag} bulk_action: false on security hides it too`, (await bulk(page)) === null);
    await close(page);

    // ---- without the sort switch the action stands alone, at the end of the line
    await hold(page, await chipAt(page, 3, 0));
    const solo = await bulk(page);
    check(`${tag} sort_toggle: false leaves the bulk action alone at the end of its line`, solo && !solo.seg && solo.solo, JSON.stringify(solo));
    await close(page);

    // ---- popups that don't name one: a list that is all one kind gets it, a mixed one doesn't
    const auto = await page.evaluate(() => {
      const host = document.createElement("div");
      host.attachShadow({ mode: "open" }).innerHTML = "<button id=o>open</button>";
      document.body.appendChild(host);
      const out = {};
      const sheet = new window.__savvy.EntityListSheet(host, { title: "Auto" });
      sheet.show(window.hass, ["lock.front_door", "lock.back_door"], host.shadowRoot.getElementById("o"), { bulk: "auto" });
      const b = window.__savvy.portalRoot().querySelector(".sv-bulk");
      out.locks = b && !b.hidden ? b.textContent.trim() : null;
      sheet.sheet.close(true);
      const mixed = new window.__savvy.EntityListSheet(host, { title: "Mixed" });
      mixed.show(window.hass, ["lock.front_door", "light.porch"], host.shadowRoot.getElementById("o"), { bulk: "auto" });
      const b2 = window.__savvy.portalRoot().querySelector(".sv-bulk");
      out.mixed = b2 && !b2.hidden ? b2.textContent.trim() : null;
      mixed.sheet.close(true);
      return out;
    });
    check(`${tag} bulk: "auto" gives a list of locks Lock all and a mixed list nothing`, auto.locks === "Lock all" && auto.mixed === null, JSON.stringify(auto));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
