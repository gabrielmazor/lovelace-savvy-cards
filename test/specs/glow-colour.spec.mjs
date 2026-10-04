// The state glow takes the colour of the card's own icon. On the lights card it works like the room tile:
// the first colour light's own (legible) colour, and the amber of the icons for white lights, never white.
// Channels are compared with a tolerance; nothing here depends on fonts.
import { openPage, idle, afterChange } from "./_util.mjs";

const rgbOf = (s) => String(s).trim().split(/\s+/).map(Number);
const near = (a, b, tol = 6) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const notWhite = (c) => c.length === 3 && Math.min(...c) < 200 && Math.max(...c) - Math.min(...c) > 40;

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) {
    const tag = `[${theme}]`;
    const { page, errors } = await openPage(browser, base, { theme, width: 520 });
    const glow = (i) => page.evaluate((i) => {
      const cs = getComputedStyle(window.cards[i].shadowRoot.querySelector("ha-card"));
      return { a: parseFloat(cs.getPropertyValue("--glow") || "0"), rgb: cs.getPropertyValue("--glow-rgb").trim() };
    }, i);
    const settle = async () => { await page.waitForFunction(() => !window.__savvy.Motion.busy(), null, { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(80); };

    // ---- the lights card
    await page.evaluate(() => {
      window.on = (id, attrs) => ({ state: "on", attributes: { ...window.house.states[id].attributes, ...attrs } });
      window.setStates({ "light.living_room_ceiling": "off", "light.living_room_floor_lamp": "on", "light.living_room_strip": "off" });
      window.mount("savvy-lights-card", { area: "living_room" }, 520);
    });
    await page.waitForTimeout(700); await settle();
    const AMBER = [245, 184, 61];
    let g = await glow(0);
    check(`${tag} lights: a warm-white lamp glows in the amber of its icon, not white`, g.a > 0.3 && near(rgbOf(g.rgb), AMBER) && notWhite(rgbOf(g.rgb)), JSON.stringify(g));

    await page.evaluate(() => window.setStates({ "light.living_room_floor_lamp": window.on("light.living_room_floor_lamp", { color_mode: "color_temp", color_temp_kelvin: 6500 }) }));
    await page.waitForTimeout(500); await settle();
    g = await glow(0);
    check(`${tag} lights: a cool-white lamp does not turn the glow white either`, near(rgbOf(g.rgb), AMBER) && notWhite(rgbOf(g.rgb)), JSON.stringify(g));

    const mid = (await afterChange(page, () => window.setStates({ "light.living_room_ceiling": window.on("light.living_room_ceiling", { color_mode: "rgb", rgb_color: [40, 110, 255], brightness: 200 }) }),
      () => getComputedStyle(window.cards[0].shadowRoot.querySelector("ha-card")).getPropertyValue("--glow-rgb").trim(), 700));
    await settle();
    g = await glow(0);
    const blue = rgbOf(g.rgb);
    check(`${tag} lights: a blue colour light gives a blue glow (picks the colour, not white)`, blue[2] > blue[0] + 40 && notWhite(blue), JSON.stringify(g));
    check(`${tag} lights: the colour slides there, it does not jump`, new Set(mid).size >= 3, JSON.stringify(mid));
    const lc = await page.evaluate(() => {
      const n = [...window.cards[0].shadowRoot.querySelectorAll(".light")].find((x) => x.__entity === "light.living_room_ceiling");
      return n ? n.style.getPropertyValue("--lc").trim() : "";
    });
    check(`${tag} lights: the glow is the colour of that light's icon`, near(rgbOf(g.rgb), rgbOf(lc), 4), `${g.rgb} / ${lc}`);

    await page.evaluate(() => window.setStates({ "light.living_room_ceiling": window.on("light.living_room_ceiling", { color_mode: "rgb", rgb_color: [255, 60, 90], brightness: 200 }), "light.living_room_floor_lamp": window.on("light.living_room_floor_lamp", { color_mode: "color_temp", color_temp_kelvin: 2700 }) }));
    await page.waitForTimeout(500); await settle();
    g = await glow(0);
    const pink = rgbOf(g.rgb);
    check(`${tag} lights: a colour light and a white one together glow in the colour light's colour`, notWhite(pink) && pink[0] > pink[2] - 10 && !near(pink, AMBER, 12), JSON.stringify(g));

    await page.evaluate(() => window.setStates({ "light.living_room_ceiling": "off", "light.living_room_floor_lamp": "off", "light.living_room_strip": "off" }));
    await page.waitForTimeout(500); await settle();
    g = await glow(0);
    check(`${tag} lights: all off, no glow`, g.a === 0, JSON.stringify(g));

    // ---- the other cards: the glow is the colour of the icon
    await page.evaluate(() => {
      window.setStates({ "light.living_room_ceiling": "on" });
      window.mount("savvy-climate-card", { area: "living_room" }, 520);
      window.mount("savvy-media-card", { area: "living_room" }, 520);
      window.mount("savvy-lock-card", { entity: "lock.front_door" }, 520);
      window.mount("savvy-room-tile", { area: "living_room" }, 260);
      window.mount("savvy-media-card", { area: "living_room", accent: "#d9534f" }, 520);
    });
    await page.waitForTimeout(900); await settle();
    const vars = (i, name) => page.evaluate(({ i, name }) => getComputedStyle(window.cards[i + 1].shadowRoot.querySelector("ha-card")).getPropertyValue(name).trim(), { i, name });
    const base0 = 0; // cards[0] is the lights card; the others follow in mount order
    const cg = await glow(1), ca = await vars(base0, "--accent");
    check(`${tag} climate: the glow is the accent its icon uses`, cg.a > 0.3 && near(rgbOf(cg.rgb), rgbOf(ca), 4), `${cg.rgb} / ${ca}`);
    const mg = await glow(2), ma = await vars(1, "--accent");
    check(`${tag} media: the glow is the accent its icon uses`, mg.a > 0.3 && near(rgbOf(mg.rgb), rgbOf(ma), 4), `${mg.rgb} / ${ma}`);
    const kg = await glow(3), kl = await vars(2, "--lk");
    check(`${tag} lock: the glow is the lock's tone, the colour of its disc`, kg.a > 0.3 && near(rgbOf(kg.rgb), rgbOf(kl), 4), `${kg.rgb} / ${kl}`);
    const tg = await glow(4), tt = await vars(3, "--tint");
    check(`${tag} room tile: the glow is the colour of the drop`, tg.a > 0.2 && near(rgbOf(tg.rgb), rgbOf(tt), 4), `${tg.rgb} / ${tt}`);
    const ag = await glow(5), aa = await vars(4, "--accent");
    check(`${tag} media with its own accent: the glow follows it`, ag.a > 0.3 && near(rgbOf(ag.rgb), rgbOf(aa), 4) && rgbOf(ag.rgb)[0] > 180, `${ag.rgb} / ${aa}`);

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
