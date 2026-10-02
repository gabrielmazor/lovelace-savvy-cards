// One custom room order: set once in the settings (or on a card, or on a chip), used by the home
// header popups and the room header's row. Listed rooms first, in order; the rest by name; "No room" last.
import { openPage, idle } from "./_util.mjs";

const NAMES = { living_room: "Living Room", kitchen: "Kitchen", bedroom: "Bedroom", office: "Office", bathroom: "Bathroom", hallway: "Hallway" };
const hold = async (page, p, ms = 650) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(450); };
const chipAt = (page, card, i) => page.evaluate(({ card, i }) => { const el = window.cards[card].shadowRoot.querySelectorAll("#chips .chip")[i]; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { card, i });
const heads = (page) => page.evaluate(() => [...window.__savvy.portalRoot().querySelectorAll(".sv-group")].map((x) => x.textContent));
const close = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(450); };
const settle = (page) => page.waitForTimeout(350);

// what the heads should read: listed rooms (that have something) first, in order; the rest by name; "No room" last
const expectHeads = (present, order) => {
  const have = new Set(present);
  const first = order.filter((a) => have.has(a) && a in NAMES);
  const rest = present.filter((a) => a && !first.includes(a)).map((a) => NAMES[a]).sort();
  return [...first.map((a) => NAMES[a]), ...rest, ...(present.includes("") ? ["No room"] : [])];
};

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 560], ["light", 360]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width: width + 80, height: 1300 });
    await page.evaluate((width) => {
      history.replaceState({}, "", "/lovelace/home");
      localStorage.clear();
      window.__savvy.SettingsStore._sync();
      window.mount("savvy-home-header-card", { health: false, lights: {}, climate: {}, media: {}, security: {} }, width);                       // 0: the settings' order
      window.mount("savvy-home-header-card", { health: false, room_order: ["office"], lights: {}, climate: {}, media: {}, security: {} }, width);  // 1: the card's own
      window.mount("savvy-home-header-card", { health: false, room_order: ["office"], lights: { room_order: ["bathroom"] } }, width);            // 2: the chip's own
    }, width);
    await page.waitForTimeout(500);
    const present = await page.evaluate(() => [...new Set(window.__savvy.houseLights(window.hass).on.map((id) => window.__savvy.entityArea(window.hass, id) || ""))]);
    const named = present.filter((a) => a);
    check(`${tag} the fixture lights several rooms`, named.length >= 2, JSON.stringify(present));
    const [a, b] = [...named].sort((x, y) => NAMES[y].localeCompare(NAMES[x]));   // a after b by name: [a, b] is never the default order
    const c = b;                                                                    // and [b] alone is the default, so changing to it shows

    // ---- no order: by name, "No room" last
    await hold(page, await chipAt(page, 0, 0));
    check(`${tag} no order: rooms by name, "No room" last`, JSON.stringify(await heads(page)) === JSON.stringify(expectHeads(present, [])), JSON.stringify(await heads(page)));
    await close(page);

    // ---- the settings' order, with an unknown id in it
    await page.evaluate(({ a, b }) => window.__savvy.SettingsStore.set({ room_order: [a, "attic", b] }), { a, b });
    await settle(page);
    await hold(page, await chipAt(page, 0, 0));
    let got = await heads(page);
    check(`${tag} the settings' order: listed rooms first in that order, the rest by name, "No room" last, unknown ids ignored`,
      JSON.stringify(got) === JSON.stringify(expectHeads(present, [a, b])) && got[0] === NAMES[a] && got[1] === NAMES[b], JSON.stringify([got, expectHeads(present, [a, b])]));
    await close(page);

    // ---- the card's own order beats the settings'; the chip's own beats the card's
    await hold(page, await chipAt(page, 1, 0));
    got = await heads(page);
    check(`${tag} a card's own room_order wins over the settings'`, JSON.stringify(got) === JSON.stringify(expectHeads(present, ["office"])) && (!present.includes("office") || got[0] === "Office"), JSON.stringify(got));
    await close(page);
    await hold(page, await chipAt(page, 2, 0));
    got = await heads(page);
    check(`${tag} a chip's own room_order wins over the card's`, JSON.stringify(got) === JSON.stringify(expectHeads(present, ["bathroom"])) && (!present.includes("bathroom") || got[0] === "Bathroom"), JSON.stringify(got));
    await close(page);

    // ---- a change in the settings reaches the next popup
    await page.evaluate((c) => window.__savvy.SettingsStore.set({ room_order: [c] }), c);
    await settle(page);
    await hold(page, await chipAt(page, 0, 0));
    got = await heads(page);
    check(`${tag} a settings change shows in the next popup`, JSON.stringify(got) === JSON.stringify(expectHeads(present, [c])) && got[0] === NAMES[c], JSON.stringify(got));
    await close(page);

    // ---- the sorter on its own
    const sorted = await page.evaluate(({ a, b }) => {
      const ids = window.__savvy.houseLights(window.hass).on;
      const out = window.__savvy.sortRows(window.hass, ids, { sort: "room", order: [b, "nowhere", a] });
      return out.filter((r) => r.head).map((r) => r.head.key);
    }, { a, b });
    check(`${tag} sortRows: order first, the rest by name, none last`, sorted[0] === b && sorted[1] === a && (sorted.at(-1) === "_none" || !present.includes("")), JSON.stringify(sorted));

    // ---- the room header's row
    const rows = await page.evaluate(async (width) => {
      window.__savvy.SettingsStore.set({ room_order: ["bedroom", "kitchen"] });
      window.mount("savvy-room-header-card", { area: "living_room", room_path: "/lovelace/{slug}" }, width);                      // settings
      window.mount("savvy-room-header-card", { area: "living_room", room_path: "/lovelace/{slug}", room_order: ["office"] }, width);  // its own
      window.mount("savvy-room-header-card", { area: "living_room", room_path: "/lovelace/{slug}", order: ["hallway"] }, width);   // the pre-Savvy name: its own too
      await new Promise((res) => setTimeout(res, 500));
      const n = window.cards.length;
      return [n - 3, n - 2, n - 1].map((i) => [...window.cards[i].shadowRoot.querySelectorAll("#rooms .chip")].map((c) => c.getAttribute("aria-label")));
    }, width);
    check(`${tag} the room header's row follows the settings' order`, rows[0][0] === "Bedroom" && rows[0][1] === "Kitchen" && rows[0].length >= 4, JSON.stringify(rows[0]));
    check(`${tag} its own room_order wins: Office, then the rest by name`, JSON.stringify(rows[1]) === '["Office","Bedroom","Hallway","Kitchen"]', JSON.stringify(rows[1]));
    check(`${tag} the pre-Savvy "order" counts as its own`, JSON.stringify(rows[2]) === '["Hallway","Bedroom","Kitchen","Office"]', JSON.stringify(rows[2]));

    // ---- what the editors say they take
    const inh = await page.evaluate(() => {
      const S = window.__savvy, s = { room_order: ["kitchen", "office"] };
      const labels = (type, cfg) => S.resolveSettings(type, cfg, s).inherited.filter((i) => /order/i.test(i.path)).map((i) => `${i.path}=${i.value}`);
      return {
        home: labels("savvy-home-header-card", { lights: {} }), homeOwn: labels("savvy-home-header-card", { room_order: ["bedroom"] }), room: labels("savvy-room-header-card", { area: "kitchen" }),
        roomOwn: labels("savvy-room-header-card", { area: "kitchen", room_order: ["bedroom"] }), roomLegacy: labels("savvy-room-header-card", { area: "kitchen", order: ["bedroom"] }),
        norm: S.normalizeSettings({ room_order: ["a", "", 3, "b"] }).room_order, none: S.normalizeSettings({ room_order: [] }),
      };
    });
    check(`${tag} the home header and room header list the order they take`, inh.home.length === 4 && inh.home[0] === "lights.room_order=kitchen, office" && inh.room[0] === "room_order=kitchen, office", JSON.stringify([inh.home, inh.room]));
    check(`${tag} a card's own order (or the legacy "order") is never replaced`, !inh.homeOwn.length && !inh.roomOwn.length && !inh.roomLegacy.length, JSON.stringify([inh.homeOwn, inh.roomOwn, inh.roomLegacy]));
    check(`${tag} the settings keep only room ids`, JSON.stringify(inh.norm) === '["a","b"]' && inh.none === null, JSON.stringify([inh.norm, inh.none]));

    // ---- the settings editor: the order list, seeded from the Rooms, reordering the Rooms with it
    const ed = await page.evaluate(async () => {
      const el = document.createElement("savvy-settings-card-editor");
      document.body.appendChild(el);
      window.sent = [];
      el.addEventListener("config-changed", (ev) => window.sent.push(ev.detail.config));
      el.setConfig({ type: "custom:savvy-settings-card", rooms: { kitchen: { name: "Cook" }, office: {}, bedroom: {} } });
      el.hass = window.hass;
      await new Promise((res) => setTimeout(res, 120));
      window.ed2 = el;
      const rows = (key) => [...el.shadowRoot.querySelector(`savvy-list-editor[data-key="${key}"]`).shadowRoot.querySelectorAll(".sv-item .t")].map((t) => t.textContent);
      return { order: rows("list:room_order"), rooms: rows("list:rooms_list"), btn: !!el.shadowRoot.querySelector('.sv-prefill[data-for="room_order"]') };
    });
    check(`${tag} the order list starts as the Rooms' order while it is unset`, ed.order.length === 3 && /Cook|Kitchen/.test(ed.order[0]) && ed.btn, JSON.stringify(ed));
    const re = await page.evaluate(async () => {
      const el = window.ed2;
      el.shadowRoot.querySelector('savvy-list-editor[data-key="list:room_order"]').dispatchEvent(new CustomEvent("list-changed", { detail: { items: ["bedroom", "kitchen"] }, bubbles: true, composed: true }));
      await new Promise((res) => setTimeout(res, 120));
      const sent = window.sent.at(-1);
      const rows = [...el.shadowRoot.querySelector('savvy-list-editor[data-key="list:rooms_list"]').shadowRoot.querySelectorAll(".sv-item .t")].map((t) => t.textContent);
      return { sent, rooms: rows };
    });
    check(`${tag} the order is written as a list of area ids`, JSON.stringify(re.sent.room_order) === '["bedroom","kitchen"]', JSON.stringify(re.sent));
    check(`${tag} the Rooms follow the order (in the editor and in the YAML), the unlisted after`,
      JSON.stringify(Object.keys(re.sent.rooms)) === '["bedroom","kitchen","office"]' && /Bedroom/.test(re.rooms[0]) && /Cook|Kitchen/.test(re.rooms[1]) && /Office/.test(re.rooms[2]), JSON.stringify([Object.keys(re.sent.rooms), re.rooms]));
    const addAll = await page.evaluate(async () => {
      const el = window.ed2, every = Object.keys(window.hass.areas);
      el.shadowRoot.querySelector('.sv-prefill[data-for="room_order"]').click();
      await new Promise((res) => setTimeout(res, 100));
      const one = window.sent.at(-1).room_order;
      el.shadowRoot.querySelector('.sv-prefill[data-for="room_order"]').click();
      await new Promise((res) => setTimeout(res, 100));
      return { one, two: window.sent.at(-1).room_order, every };
    });
    check(`${tag} "Add every room to the order": the rest after the listed ones, a second press adds nothing`,
      addAll.one[0] === "bedroom" && addAll.one[1] === "kitchen" && addAll.every.every((id) => addAll.one.includes(id)) && addAll.one.length === addAll.every.length && addAll.two.length === addAll.one.length, JSON.stringify(addAll));

    // ---- the home header's editor
    const hh = await page.evaluate(async () => {
      const el = document.createElement("savvy-home-header-card-editor");
      document.body.appendChild(el);
      el.setConfig({ type: "custom:savvy-home-header-card" });
      el.hass = window.hass;
      await new Promise((res) => setTimeout(res, 120));
      const list = el.shadowRoot.querySelector('savvy-list-editor[data-key="list:room_order"]');
      const flat = (s) => (s || []).flatMap((e) => (e.schema ? flat(e.schema) : [e]));
      const chip = [...el.shadowRoot.querySelectorAll("ha-form")].flatMap((f) => flat(f.schema)).filter((e) => e.name === "room_order").length;
      return { list: !!list, chip };
    });
    check(`${tag} the home header's editor has the order, and a field for each chip's own`, hh.list && hh.chip >= 4, JSON.stringify(hh));

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
