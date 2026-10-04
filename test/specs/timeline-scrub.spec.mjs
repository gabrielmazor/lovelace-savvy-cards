// The recordings timeline: drag up from the bar and the same width covers less of the day (whole day, 6 h, 1 h,
// 10 min). Movement is relative to where the zone changed, so nothing jumps; seconds show in the close zones.
import { openPage } from "./_util.mjs";
import { FRIGATE } from "./camera.spec.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(FRIGATE);
    const r = await page.evaluate(async (width) => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const card = window.mount("savvy-camera-card", { area: "living_room", frigate: { instance: "frigate" } }, width);
      await wait(900);
      card._el.recBtn.click();
      await wait(600);
      card._stepDay(1);
      await wait(400);
      const tl = card._el.tl, R = () => tl.getBoundingClientRect();
      const haptics = [], plays = [];
      window.addEventListener("haptic", (e) => haptics.push(e.detail));
      card._playAt = (s) => plays.push(s);
      const ev = (type, x, y, extra = {}) => tl.dispatchEvent(new PointerEvent(type, { pointerId: 7, button: 0, bubbles: true, composed: true, clientX: x, clientY: y, ...extra }));
      const out = { w: R().width }, T = R().top, L = R().left, W = R().width;
      const read = () => ({ cur: card._cursor, t: card._el.bt.textContent, z: card._el.bz.textContent });
      ev("pointerdown", L + W / 2, T + 20); await wait(30);
      out.down = read();
      ev("pointermove", L + W / 2, T - 50); await wait(30);
      out.z1 = read();
      ev("pointermove", L + W / 2 + W / 4, T - 50); await wait(30);
      out.z1move = read();
      ev("pointermove", L + W / 2 + W / 4, T - 120); await wait(30);
      out.z2 = read();
      ev("pointermove", L + W / 2 + W / 4, T - 200); await wait(30);
      out.z3 = read();
      ev("pointermove", L + W / 2 + W / 4 + W / 2, T - 200); await wait(30);
      out.z3move = read();
      ev("pointermove", L + W / 2 + W / 4 + W / 2, T + 20); await wait(30);
      out.back = read();
      out.haptics = haptics.length;
      ev("pointerup", L + W / 2 + W / 4 + W / 2, T + 20); await wait(30);
      out.plays = plays.slice();
      // desktop: Shift is fine, without leaving the bar
      ev("pointerdown", L + W / 2, T + 20, { shiftKey: true }); await wait(30);
      const s0 = card._cursor;
      ev("pointermove", L + W / 2 + W / 2, T + 20, { shiftKey: true }); await wait(30);
      out.shift = [card._cursor - s0, card._el.bz.textContent];
      ev("pointerup", L, T + 20); await wait(30);
      // keyboard
      card._cursor = 40000;
      const key = (k, o = {}) => tl.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o }));
      key("ArrowRight", { shiftKey: true }); out.k10 = card._cursor - 40000;
      key("PageUp"); out.kPage = card._cursor - 40010;
      out.aria = tl.getAttribute("aria-valuetext");
      return out;
    }, width);
    const near = (a, b, e = 2) => Math.abs(a - b) <= e;
    check(`${tag} a press on the bar lands where the finger is, in whole minutes`, near(r.down.cur, 43200, 400) && r.down.z === "" && /^\d\d:\d\d$/.test(r.down.t), JSON.stringify(r.down));
    check(`${tag} dragging up does not move the playhead, and names the zone`, near(r.z1.cur, r.down.cur) && /6 h/.test(r.z1.z), JSON.stringify([r.down, r.z1]));
    check(`${tag} the second zone covers 6 h across the bar`, near(r.z1move.cur, r.z1.cur + 5400, 60), JSON.stringify([r.z1, r.z1move]));
    check(`${tag} the close zone shows seconds, still no jump`, near(r.z2.cur, r.z1move.cur) && /^\d\d:\d\d:\d\d$/.test(r.z2.t) && /1 h/.test(r.z2.z), JSON.stringify(r.z2));
    check(`${tag} the fine zone covers 10 min across the bar`, near(r.z3.cur, r.z2.cur) && near(r.z3move.cur, r.z3.cur + 300, 4) && /10 min/.test(r.z3.z), JSON.stringify([r.z3, r.z3move]));
    check(`${tag} back on the bar it is the whole day again, nothing jumps`, near(r.back.cur, r.z3move.cur) && r.back.z === "", JSON.stringify(r.back));
    check(`${tag} a tick of haptic feedback for every zone change`, r.haptics >= 4, String(r.haptics));
    check(`${tag} letting go plays from the playhead`, r.plays.length === 1 && near(r.plays[0], r.back.cur), JSON.stringify(r.plays));
    check(`${tag} Shift with a mouse is fine without leaving the bar`, near(r.shift[0], 300, 4) && /10 min/.test(r.shift[1]), JSON.stringify(r.shift));
    check(`${tag} keyboard: Shift+arrow 10 s, Page Up an hour, seconds in the spoken time`, r.k10 === 10 && r.kPage === 3600 && /^\d\d:\d\d:\d\d$/.test(r.aria), JSON.stringify([r.k10, r.kPage, r.aria]));
    check(`${tag} no console errors`, errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, errors.join("; "));
    await page.close();
  }
}
