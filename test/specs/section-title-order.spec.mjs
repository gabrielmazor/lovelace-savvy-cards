// The section title's badges are anchored at the end of the row. From the right edge going left:
// temperature, presence, doors and windows (always there when the room has them, dimmed when
// idle), then whatever else is active, growing leftwards; pinned entities lead on the left. The
// room's light helper in the settings is no longer pinned as a badge.
import { openPage } from "./_util.mjs";

const RANK = (k) => (k.startsWith("pin:") ? 0 : k === "window" ? 2 : k === "door" ? 3 : k === "presence" ? 4 : 1);
const read = `(el) => {
  const shown = [...el._badges.entries()].filter(([, i]) => i.shown.target === 1);
  const pos = Object.fromEntries(shown.map(([k, i]) => [k, Math.round(i.el.getBoundingClientRect().x * 10) / 10]));
  const tempX = el._el.temp.hidden ? null : Math.round(el._el.temp.getBoundingClientRect().x * 10) / 10;
  const on = Object.fromEntries(shown.map(([k, i]) => [k, i.on.target]));
  return { keys: shown.map(([k]) => k).sort((a, b) => pos[a] - pos[b]), pos, tempX, on };
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
    const rank = (r) => r.keys.map(RANK);
    check(`${tag} left to right: pinned, active extras, window, door, presence, then the temperature`,
      [lr, bd].every((r) => rank(r).every((x, i, a) => i === 0 || a[i - 1] <= x)), JSON.stringify([lr.keys, bd.keys]));
    check(`${tag} door sits left of presence`, lr.pos.door < lr.pos.presence, JSON.stringify(lr.pos));

    // ---- an active extra joins on the left; the trio and the temperature never move
    const k0 = await R(2);
    await page.evaluate(() => window.setStates({ "lock.back_door": "unlocked" }));
    await page.waitForTimeout(900);
    const k1 = await R(2);
    check(`${tag} an unlocked lock joins on the left of the always-there badges`, !k0.keys.includes("lock") && k1.keys.includes("lock") && k1.pos.lock < k1.pos.presence, JSON.stringify([k0.keys, k1]));
    check(`${tag} ...and presence and the temperature stay where they were`, k1.pos.presence === k0.pos.presence && k1.tempX === k0.tempX, JSON.stringify([k0, k1]));
    await page.evaluate(() => window.setStates({ "lock.back_door": "locked" }));
    await page.waitForTimeout(900);
    const k2 = await R(2);
    check(`${tag} when it is locked again it leaves and nothing else moves`, !k2.keys.includes("lock") && k2.pos.presence === k0.pos.presence && k2.tempX === k0.tempX, JSON.stringify(k2));

    // ---- pinned leads on the left; auto_discover off keeps only the pinned ones
    const pinned = await R(3), only = await R(4);
    check(`${tag} a pinned entity is the leftmost badge`, pinned.keys[0] === "pin:switch.living_room_plug" && pinned.keys.slice(1).every((k) => RANK(k) > 0), JSON.stringify(pinned.keys));
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
    const order = r.keys.map(RANK);
    check("[rtl] the temperature is the leftmost and the order mirrors", r.tempX !== null && r.keys.every((k) => r.pos[k] > r.tempX) && order.every((x, i, a) => i === 0 || a[i - 1] >= x), JSON.stringify(r));
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
