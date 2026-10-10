// The section title's badges follow the rule every room card shares: what is relevant comes first. This
// card reads from its end (right to left): the temperature, then everything active (presence, then an
// open door, then the rest), then everything idle (presence, door, the rest), growing leftwards. Presence, doors and windows are
// always there when the room has them, dimmed while idle; the rest only while active.
import { openPage } from "./_util.mjs";

// the order the rule asks for: active before idle; within each, presence, door, then the rest
const SCORE = (k, on) => (on ? 0 : 10) + (k === "presence" ? 1 : k === "door" ? 2 : 3);
const ordered = (r) => r.keys.every((k, i, a) => i === 0 || SCORE(a[i - 1], r.on[a[i - 1]]) <= SCORE(k, r.on[k]));
const read = `(el) => {
  const shown = [...el._badges.entries()].filter(([, i]) => i.shown.target === 1);
  const pos = Object.fromEntries(shown.map(([k, i]) => [k, Math.round(i.el.getBoundingClientRect().x * 10) / 10]));
  const tempX = el._el.temp.hidden ? null : Math.round(el._el.temp.getBoundingClientRect().x * 10) / 10;
  const on = Object.fromEntries(shown.map(([k, i]) => [k, i.on.target]));
  const rtl = getComputedStyle(el).direction === "rtl";
  // read from the row's end, where the temperature is: right to left (left to right in rtl)
  return { keys: shown.map(([k]) => k).sort((a, b) => (rtl ? pos[a] - pos[b] : pos[b] - pos[a])), pos, tempX, on };
}`;

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 480], ["light", 340]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.setViewportSize({ width: width + 80, height: 1000 });
    const R = (i) => page.evaluate(({ i, read }) => eval(read)(window.cards[i]), { i, read });
    await page.evaluate((width) => {
      window.setStates({ "binary_sensor.living_room_presence": "off", "binary_sensor.living_room_door": "off", "binary_sensor.bedroom_window": "off", "lock.back_door": "locked" });
      window.mount("savvy-section-title-card", { area: "living_room" }, width);                                                   // 0
      window.mount("savvy-section-title-card", { area: "bedroom" }, width);                                                       // 1
      window.mount("savvy-section-title-card", { area: "kitchen" }, width);                                                       // 2
      window.mount("savvy-section-title-card", { area: "living_room", entities: [{ entity: "switch.living_room_plug" }] }, width);  // 3
      window.mount("savvy-section-title-card", { area: "living_room", auto_discover: false, entities: [{ entity: "switch.living_room_plug" }] }, width); // 4
    }, width);
    await page.waitForTimeout(900);

    // ---- always there, dimmed when idle, in the order from the right edge
    const lr = await R(0), bd = await R(1);
    check(`${tag} presence and the door are always there, dimmed while idle, and the temperature ends the row`,
      lr.keys.includes("presence") && lr.keys.includes("door") && lr.on.presence === 0 && lr.on.door === 0 && lr.tempX !== null && lr.keys.every((k) => lr.pos[k] < lr.tempX), JSON.stringify(lr));
    check(`${tag} the window is always there too`, bd.keys.includes("window") && bd.on.window === 0, JSON.stringify(bd));
    check(`${tag} what is active comes first, then idle presence, then the idle door`, [lr, bd].every(ordered), JSON.stringify([lr, bd.keys]));
    check(`${tag} with the room empty and the door closed, the playing TV leads`, lr.keys[0] === "media" && lr.keys.at(-1) === "door", JSON.stringify(lr.keys));

    // ---- an unlocked lock joins with the active ones; presence takes the lead when someone comes in
    const k0 = await R(2);
    await page.evaluate(() => window.setStates({ "lock.back_door": "unlocked" }));
    await page.waitForTimeout(900);
    const k1 = await R(2);
    check(`${tag} an unlocked lock joins ahead of the idle badges`, !k0.keys.includes("lock") && k1.keys.includes("lock") && ordered(k1) && k1.keys.indexOf("lock") < k1.keys.indexOf("presence"), JSON.stringify([k0.keys, k1]));
    await page.evaluate(() => window.setStates({ "lock.back_door": "locked", "binary_sensor.kitchen_motion": "on" }));
    await page.waitForTimeout(900);
    const k2 = await R(2);
    check(`${tag} locked again it leaves; presence, now detected, comes first`, !k2.keys.includes("lock") && k2.keys[0] === "presence" && ordered(k2), JSON.stringify(k2));
    await page.evaluate(() => window.setStates({ "binary_sensor.kitchen_motion": "off" }));

    // ---- a pinned entity takes its place by the same rule; auto_discover off keeps only the pinned ones
    const pinned = await R(3), only = await R(4);
    check(`${tag} a pinned entity that is on sits with the active ones`, pinned.keys.includes("pin:switch.living_room_plug") && ordered(pinned)
      && pinned.keys.indexOf("pin:switch.living_room_plug") < pinned.keys.indexOf("presence"), JSON.stringify(pinned));
    check(`${tag} auto_discover: false leaves just the pinned ones and the temperature`, only.keys.join() === "pin:switch.living_room_plug" && only.tempX !== null, JSON.stringify(only));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- right to left mirrors it
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 480 });
    await page.setViewportSize({ width: 560, height: 800 });
    await page.evaluate(() => { document.getElementById("stage").dir = "rtl"; window.setStates({ "binary_sensor.living_room_presence": "off", "binary_sensor.living_room_door": "off" }); window.mount("savvy-section-title-card", { area: "living_room" }, 480); });
    await page.waitForTimeout(900);
    const r = await page.evaluate(({ read }) => eval(read)(window.cards[0]), { read });
    check("[rtl] the temperature is the leftmost and the order mirrors", r.tempX !== null && r.keys.every((k) => r.pos[k] > r.tempX) && ordered(r), JSON.stringify(r));
    check("[rtl] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---- the settings' light helper is not a badge any more (the section title and the room header)
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 480 });
    await page.setViewportSize({ width: 560, height: 800 });
    const r = await page.evaluate(async () => {
      history.replaceState({}, "", "/lovelace/home");
      const SS = window.__savvy.SettingsStore;
      SS._sync();
      SS.set({ rooms: { kitchen: { light_state: "input_boolean.movie_mode" } } });
      const t = window.mount("savvy-section-title-card", { area: "kitchen" }, 480);
      const h = window.mount("savvy-room-header-card", { area: "kitchen" }, 480);
      const own = window.mount("savvy-section-title-card", { area: "kitchen", entities: [{ entity: "input_boolean.movie_mode", name: "Light" }] }, 480);
      await new Promise((res) => setTimeout(res, 900));
      const header = [...h.shadowRoot.querySelectorAll(".sensor, [data-key], .badge, .chip")].map((n) => n.getAttribute("aria-label") || "").join("|");
      return { title: [...t._badges.keys()], own: [...own._badges.keys()], header, headerKeys: h._items?.map?.((i) => i.key) || null };
    });
    check("the room's light helper from the settings is not pinned on the section title", !r.title.includes("pin:input_boolean.movie_mode"), JSON.stringify(r.title));
    check("...but a card can still pin it itself", r.own.includes("pin:input_boolean.movie_mode"), JSON.stringify(r.own));
    check("...nor on the room header", !/Movie Mode/i.test(r.header), r.header);
    check("light helper: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
