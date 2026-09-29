// savvy-camera-card on the made-up house, with a faked Frigate.
import { openPage, idle, shot } from "./_util.mjs";

const FRIGATE = `(() => {
  const now = Date.now() / 1000, MIN = 60, HOUR = 3600;
  const dayStart = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - off); return d.getTime() / 1000; };
  const ymd = (s) => { const d = new Date(s * 1000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const today = (ago) => Math.max(dayStart(0) + 60, now - ago);
  const R = {
    living_room: [
      { id: "r1", camera: "living_room", start_time: today(5 * MIN), end_time: today(4 * MIN), severity: "alert", has_been_reviewed: false, thumb_path: "/media/frigate/clips/review/thumb-living_room-r1.webp", data: { objects: ["person"] } },
      { id: "r2", camera: "living_room", start_time: today(2 * HOUR), end_time: today(2 * HOUR - 50), severity: "detection", has_been_reviewed: true, thumb_path: "/media/frigate/clips/review/thumb-living_room-r2.webp", data: { objects: ["person", "dog"] } },
    ],
    kitchen: [{ id: "k1", camera: "kitchen", start_time: today(30 * MIN), end_time: null, severity: "detection", has_been_reviewed: false, thumb_path: "/media/frigate/clips/review/thumb-kitchen-k1.webp", data: { objects: ["person"] } }],
  };
  window.ws = [];
  window.hass.callWS = async (m) => {
    window.ws.push(m.type + (m.instance_id ? ":" + m.instance_id : ""));
    if (m.type === "auth/sign_path") return { path: m.path + "?authSig=test" };
    if (m.type === "frigate/reviews/get") return [].concat(...m.cameras.map((c) => R[c] || [])).filter((r) => r.start_time >= m.after && r.start_time < m.before);
    if (m.type === "frigate/reviews/viewed") return null;
    if (m.type === "frigate/recordings/get") { const rows = []; for (let t = Math.max(m.after, dayStart(0)); t < Math.min(m.before, now); t += 600) rows.push({ id: String(t), start_time: t, end_time: t + 600, motion: (t / 600) % 5 ? 4 : 30, objects: 0, duration: 600 }); return rows; }
    if (m.type === "frigate/recordings/summary") return [{ day: ymd(dayStart(0)), events: 3, hours: [] }];
    throw new Error("unmocked " + m.type);
  };
})();`;

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(FRIGATE);
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-camera-card", { area: ["living_room", "kitchen"] }, width);
      window.mount("savvy-camera-card", { area: "hallway" }, width);
      window.mount("savvy-camera-card", { area: "bedroom" }, width);
      // the pre-Savvy shape: cameras listed, a Frigate instance
      window.mount("savvy-camera-card", { cameras: [{ entity: "camera.living_room", area: "living_room" }], frigate: { instance: "frigate" } }, width);
      await new Promise((res) => setTimeout(res, 900));
      const read = (el) => {
        const R = el.shadowRoot;
        return { tiles: R.querySelectorAll(".tile").length, grid: el.hasAttribute("grid"), rec: !!R.getElementById("recBtn") && !R.getElementById("recBtn").hidden,
          names: [...R.querySelectorAll(".tile .name, .tile .nm")].map((n) => n.textContent).filter(Boolean), text: R.querySelector("ha-card")?.textContent.trim().slice(0, 40) };
      };
      return window.cards.map(read);
    }, width);
    const [both, hall, none, legacy] = r;
    check(`${tag} the areas' cameras, side by side when there's room`, both.tiles === 2 && both.grid === (width >= 760), JSON.stringify(both));
    check(`${tag} Frigate turns itself on for Frigate cameras, off for others`, both.rec && !hall.rec && hall.tiles === 1, JSON.stringify([both, hall]));
    check(`${tag} an area with no cameras says so`, none.text === "No cameras in Bedroom.", JSON.stringify(none));
    check(`${tag} the pre-Savvy shape still works`, legacy.tiles === 1 && legacy.rec, JSON.stringify(legacy));

    // the recordings popup: above the page, reviews in it, a tap outside closes it and presses nothing
    await page.evaluate(() => { window.nav = []; window.addEventListener("location-changed", () => window.nav.push(1)); });
    const btn = await page.evaluate(() => { const b = window.cards[0].shadowRoot.getElementById("recBtn"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...btn);
    await page.waitForTimeout(900);
    const pop = await page.evaluate(() => {
      const layer = document.querySelector(".savvy-layer")?.shadowRoot;
      const scrim = layer?.querySelector(".dscrim")?.getBoundingClientRect();
      return { open: !!layer?.querySelector(".dlg"), reviews: layer ? layer.querySelectorAll(".rv").length : 0,
        cover: scrim ? [Math.round(scrim.width), Math.round(scrim.height), innerWidth, innerHeight] : null };
    });
    check(`${tag} recordings open above the page, with the day's reviews`, pop.open && pop.reviews >= 2 && pop.cover && pop.cover[0] === pop.cover[2] && pop.cover[1] === pop.cover[3], JSON.stringify(pop));
    await page.mouse.click(5, 5);
    await page.waitForTimeout(700);
    const closed = await page.evaluate(() => ({ layer: !!document.querySelector(".savvy-layer"), back: !!window.cards[0].shadowRoot.getElementById("rec") }));
    check(`${tag} a tap outside closes it; the recordings go back into the card`, !closed.layer && closed.back, JSON.stringify(closed));

    if (width === 900) await shot(page, `camera-${theme}`, 0);
    check(`${tag} springs idle`, await idle(page));
    // Frigate's thumbnails aren't served here: those 404s are the test server's, not the card's
    const real = errors.filter((e) => !/Failed to load resource/.test(e));
    check(`${tag} no errors`, real.length === 0, real.join(" | "));
    await page.close();
  }
}
