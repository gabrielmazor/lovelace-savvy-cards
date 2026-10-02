// The home header chips' popups: what a chip ignores (entities and rooms, for the count and the
// list alike), how the list is sorted (by room under headings, or by latest change), the switch
// at its top that remembers the choice, and the alarm and locks that stay on top.
import { openPage } from "./_util.mjs";

const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(450); };
const chipAt = (page, card, i) => page.evaluate(({ card, i }) => { const el = window.cards[card].shadowRoot.querySelectorAll("#chips .chip")[i]; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { card, i });
const chipText = (page, card, i) => page.evaluate(({ card, i }) => window.cards[card].shadowRoot.querySelectorAll("#chips .chip")[i].textContent.replace(/\s+/g, " ").trim(), { card, i });
const list = (page) => page.evaluate(() => {
  const r = window.__savvy.portalRoot();
  return { rows: [...r.querySelectorAll(".sv-row")].map((x) => x.dataset.id), heads: [...r.querySelectorAll(".sv-group")].map((x) => x.textContent),
    seg: [...r.querySelectorAll(".sv-tools .sv-seg-b")].map((b) => `${b.textContent}${b.hasAttribute("data-on") ? "*" : ""}`), bar: !!r.querySelector(".sv-tools .sv-seg:not([hidden])"),
    subs: [...r.querySelectorAll(".sv-row .sv-sub")].map((x) => x.textContent) };
});
const close = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(450); };
const count = (t) => Number(/(\d+) (on|playing)/.exec(t)?.[1]);

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 560], ["light", 360]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width: width + 80, height: 1300 });
    await page.evaluate((width) => {
      window.mount("savvy-home-header-card", { health: false, lights: {}, climate: {}, media: {}, security: {} }, width);                              // 0: defaults
      window.mount("savvy-home-header-card", { health: false, lights: { exclude: ["light.porch"], exclude_areas: ["bedroom"] }, climate: { exclude: ["climate.living_room_ac"] }, media: { exclude_areas: ["kitchen"] } }, width);   // 1: ignoring
      window.mount("savvy-home-header-card", { health: false, lights: { sort: "recent" } }, width);                                                      // 2: recent by default
      window.mount("savvy-home-header-card", { health: false, lights: { sort_toggle: false } }, width);                                                  // 3: no switch
      localStorage.clear();
    }, width);
    await page.waitForTimeout(500);
    const base0 = await page.evaluate(() => { const l = window.__savvy.houseLights(window.hass); return { all: l.all, on: l.on, areas: Object.fromEntries(l.on.map((id) => [id, window.__savvy.entityArea(window.hass, id)])) }; });

    // ---- by room, with headings; rooms by name, "No room" last
    await hold(page, await chipAt(page, 0, 0));
    const d = await list(page);
    const expectHeads = [...new Set(base0.on.map((id) => base0.areas[id]))].map((a) => (a ? window_name(a) : "No room"));
    function window_name(a) { return { living_room: "Living Room", kitchen: "Kitchen", bedroom: "Bedroom", office: "Office", bathroom: "Bathroom", hallway: "Hallway" }[a]; }
    const wantHeads = expectHeads.filter((h) => h !== "No room").sort().concat(expectHeads.includes("No room") ? ["No room"] : []);
    check(`${tag} a chip's popup lists by room under headings: rooms by name, "No room" last`, d.rows.length === base0.on.length && JSON.stringify(d.heads) === JSON.stringify(wantHeads), JSON.stringify([d.heads, wantHeads]));
    check(`${tag} the switch at the top says Room | Recent, Room picked`, JSON.stringify(d.seg) === JSON.stringify(["Room*", "Recent"]), JSON.stringify(d.seg));
    check(`${tag} in room mode a row doesn't repeat its room`, d.subs.every((s) => !/Living Room|Bedroom|Kitchen/.test(s)), JSON.stringify(d.subs));

    // ---- Recent: one flat list, newest change first, with when
    await page.evaluate(() => {
      const seg = window.__savvy.portalRoot().querySelectorAll(".sv-tools .sv-seg-b")[1];
      seg.scrollIntoView({ block: "center" });
    });
    const recentBtn = await page.evaluate(() => { const r = window.__savvy.portalRoot().querySelectorAll(".sv-tools .sv-seg-b")[1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    // give two lights distinct change times first so the order is certain
    await page.evaluate(() => {
      const on = window.__savvy.houseLights(window.hass).on;
      on.forEach((id, i) => { window.house.states[id] = { ...window.house.states[id], last_changed: new Date(Date.now() - (i + 1) * 7 * 60000).toISOString() }; });
      window.setStates({});
      window.list = window.cards[0]._list; window.cards[0]._list.render(window.hass);
    });
    await page.mouse.click(...recentBtn);
    await page.waitForTimeout(400);
    const r = await list(page);
    const order = await page.evaluate((ids) => ids.map((id) => Date.parse(window.hass.states[id].last_changed)), r.rows);
    check(`${tag} Recent: no headings, newest change first`, r.heads.length === 0 && order.every((t, i) => i === 0 || order[i - 1] >= t) && r.rows.length === base0.on.length, JSON.stringify([r.heads, order]));
    check(`${tag} ...each row saying when it changed`, r.subs.every((s) => /ago|just now/.test(s)), JSON.stringify(r.subs));
    check(`${tag} ...and the choice is remembered`, (await page.evaluate(() => localStorage.getItem("savvy-sort:lights"))) === "recent" && JSON.stringify(r.seg) === JSON.stringify(["Room", "Recent*"]), JSON.stringify([r.seg, await page.evaluate(() => localStorage.getItem("savvy-sort:lights"))]));
    await close(page);
    await hold(page, await chipAt(page, 0, 0));
    check(`${tag} the popup opens on the remembered choice`, JSON.stringify((await list(page)).seg) === JSON.stringify(["Room", "Recent*"]));
    const roomBtn = await page.evaluate(() => { const r = window.__savvy.portalRoot().querySelectorAll(".sv-tools .sv-seg-b")[0].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...roomBtn);
    await page.waitForTimeout(400);
    check(`${tag} switching back to Room restores the headings and stores it`, (await list(page)).heads.length > 0 && (await page.evaluate(() => localStorage.getItem("savvy-sort:lights"))) === "room");
    await close(page);

    // ---- ignoring: entities and rooms, for the count and the list
    const text0 = await chipText(page, 0, 0), text1 = await chipText(page, 1, 0);
    const gone = base0.on.filter((id) => id === "light.porch" || base0.areas[id] === "bedroom");
    check(`${tag} a chip's ignore list lowers its count (an entity and a room)`, count(text0) === base0.on.length && count(text1) === base0.on.length - gone.length && gone.length >= 2, JSON.stringify([text0, text1, gone]));
    await hold(page, await chipAt(page, 1, 0));
    const ig = await list(page);
    check(`${tag} ...and the popup lists exactly what is counted`, ig.rows.length === base0.on.length - gone.length && gone.every((id) => !ig.rows.includes(id)), JSON.stringify([ig.rows, gone]));
    await close(page);
    // climate: an ignored unit is out of the average and the list
    const climBase = await chipText(page, 0, 1), climIgn = await chipText(page, 1, 1);
    await hold(page, await chipAt(page, 1, 1));
    const cl = await list(page);
    check(`${tag} an ignored climate unit leaves the average and the list`, climBase !== climIgn && !cl.rows.includes("climate.living_room_ac") && cl.rows.length > 0, JSON.stringify([climBase, climIgn, cl.rows]));
    await close(page);
    // media: an ignored room's players are out of the count
    const mBase = await chipText(page, 0, 2), mIgn = await chipText(page, 1, 2);
    check(`${tag} an ignored room's players leave the playing count`, count(mIgn) === count(mBase) - 1, JSON.stringify([mBase, mIgn]));

    // ---- sort and the switch from config
    await page.evaluate(() => localStorage.clear());   // a remembered choice outranks the config's default
    await hold(page, await chipAt(page, 2, 0));
    const c2 = await list(page);
    check(`${tag} sort: recent in config starts on Recent`, c2.heads.length === 0 && JSON.stringify(c2.seg) === JSON.stringify(["Room", "Recent*"]), JSON.stringify(c2));
    await close(page);
    await hold(page, await chipAt(page, 3, 0));
    const c3 = await list(page);
    check(`${tag} sort_toggle: false hides the switch (headings stay)`, !c3.bar && c3.heads.length > 0, JSON.stringify(c3));
    await close(page);

    // ---- the alarm and the locks stay on top, in either sort
    await hold(page, await chipAt(page, 0, 3));
    const sec = await list(page);
    check(`${tag} the security popup keeps the alarm, then every lock, on top`, sec.rows[0] === "alarm_control_panel.home_alarm" && sec.rows[1] === "lock.front_door" && sec.rows[2] === "lock.back_door", JSON.stringify(sec.rows));
    const recent = await page.evaluate(() => { const b = window.__savvy.portalRoot().querySelectorAll(".sv-tools .sv-seg-b")[1]; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...recent);
    await page.waitForTimeout(400);
    const sec2 = await list(page);
    check(`${tag} ...also when sorted by recent`, sec2.rows.slice(0, 3).join() === "alarm_control_panel.home_alarm,lock.front_door,lock.back_door", JSON.stringify(sec2.rows));
    await close(page);

    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // storage that throws (a private window): the popup still works, the choice just isn't kept
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 560 });
    await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
    await page.reload();
    await page.waitForFunction(() => window.__savvy && window.mount);
    await page.setViewportSize({ width: 640, height: 1300 });
    await page.evaluate(() => window.mount("savvy-home-header-card", { health: false }, 560));
    await page.waitForTimeout(500);
    await hold(page, await chipAt(page, 0, 0));
    const before = await list(page);
    const btn = await page.evaluate(() => { const r = window.__savvy.portalRoot().querySelectorAll(".sv-tools .sv-seg-b")[1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...btn);
    await page.waitForTimeout(400);
    const after = await list(page);
    check("[no storage] the popup opens on Room and the switch still works", before.heads.length > 0 && after.heads.length === 0 && JSON.stringify(after.seg) === JSON.stringify(["Room", "Recent*"]), JSON.stringify([before, after]));
    check("[no storage] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
