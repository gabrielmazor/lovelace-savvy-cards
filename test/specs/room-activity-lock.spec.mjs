// The room activity card knows locks: "Locked" / "Unlocked" with how long, amber when unlocked
// while the alarm is armed (like an open door), a lock option, include (a lock with no area,
// from the card or the room's settings), exclude_kinds, compact, and the history lanes.
import { openPage } from "./_util.mjs";

const RECORDER = `window.hass.callWS = async (m) => {
  const now = Date.now(), H = 3600000, out = {};
  for (const id of m.entity_ids) {
    if (id.startsWith("lock.")) out[id] = [{ s: "locked", lu: (now - 20 * H) / 1000 }, { s: "unlocked", lu: (now - 6 * H) / 1000 }, { s: "locked", lu: (now - 5 * H) / 1000 }];
    else if (id.startsWith("binary_sensor.")) out[id] = [{ s: "off", lu: (now - 20 * H) / 1000 }];
    else out[id] = Array.from({ length: 24 }, (_, i) => ({ s: String(22 + Math.sin(i / 4)), lu: (now - (24 - i) * H) / 1000 }));
  }
  return out;
};`;

const read = (page, i) => page.evaluate((i) => {
  const R = window.cards[i].shadowRoot;
  return { status: R.getElementById("status").textContent, level: R.getElementById("status").dataset.level || "",
    events: [...R.querySelectorAll(".ev")].map((e) => `${e.querySelector(".st").textContent}|${e.querySelector(".when").textContent}|${e.querySelector(".lbl").textContent}`),
    warn: [...R.querySelectorAll(".ev")].map((e) => Number(e.style.getPropertyValue("--warn"))),
    glyphs: [...R.querySelectorAll(".gl")].map((g) => ({ icon: g.querySelector("ha-icon").getAttribute("icon"), warn: Number(g.style.getPropertyValue("--warn")) })) };
}, i);

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [460, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(RECORDER);
    const ids = await page.evaluate((width) => {
      const m = (cfg) => window.cards.indexOf(window.mount("savvy-room-activity-card", cfg, width));
      return { hall: m({ area: "hallway" }), kitchen: m({ area: "kitchen", lock: "lock.back_door" }), off: m({ area: "hallway", lock: false }), kinds: m({ area: "hallway", exclude_kinds: ["lock"] }),
        compact: m({ area: "hallway", layout: "compact" }) };
    }, width);
    await page.waitForTimeout(700);
    const hall = await read(page, ids.hall);
    check(`${tag} the room's lock is an event: Locked, and how long`, hall.events.some((e) => /^Locked\|30 min ago/.test(e)), JSON.stringify(hall));
    check(`${tag} locked while the alarm is armed is calm`, Number(hall.warn[0]) < 0.01 && hall.level !== "warn", JSON.stringify(hall));
    const kit = await read(page, ids.kitchen);
    check(`${tag} lock: names the lock, and an unlocked one shows Unlocked`, kit.events.some((e) => /^Unlocked\|/.test(e)), JSON.stringify(kit));
    check(`${tag} lock: false and exclude_kinds leave it out`, (await read(page, ids.off)).events.length === 0 && (await read(page, ids.kinds)).events.length === 0);
    // unlocked while the alarm is armed: amber, like an open door
    await page.evaluate(() => window.setStates({ "lock.front_door": { entity_id: "lock.front_door", state: "unlocked", attributes: { friendly_name: "Front Door" } } }));
    await page.waitForTimeout(800);
    const un = await read(page, ids.hall);
    check(`${tag} unlocked while the alarm is armed turns amber, and the status says so`, un.events.some((e) => /^Unlocked\|/.test(e)) && Number(un.warn[0]) > 0.99 && un.level === "warn" && /Unlocked/.test(un.status), JSON.stringify(un));
    const cp = await read(page, ids.compact);
    check(`${tag} compact: a lock glyph, amber while unlocked and armed`, cp.glyphs.some((g) => g.icon === "mdi:lock-open-variant" && g.warn > 0.99), JSON.stringify(cp));
    await page.evaluate(() => window.setStates({ "lock.front_door": { entity_id: "lock.front_door", state: "locked", attributes: { friendly_name: "Front Door" } } }));
    await page.waitForTimeout(600);

    // include: a lock that has no area, from the card
    await page.evaluate(() => window.setStates(window.entranceFixture(window.house, {})));
    const inc = await page.evaluate((width) => window.cards.indexOf(window.mount("savvy-room-activity-card", { area: "hallway", include: ["lock.entrance_door"] }, width)), width);
    await page.waitForTimeout(600);
    const incR = await read(page, inc);
    check(`${tag} include brings in a lock that has no area`, incR.events.length === 2, JSON.stringify(incR));

    // ... and from the room's settings
    await page.evaluate(() => {
      history.replaceState({}, "", "/lovelace/home");
      const SS = window.__savvy.SettingsStore;
      SS._sync();
      SS.set({ rooms: { hallway: { include: ["lock.entrance_door"] } } });
    });
    const viaSettings = await page.evaluate((width) => window.cards.indexOf(window.mount("savvy-room-activity-card", { area: "hallway" }, width)), width);
    await page.waitForTimeout(700);
    check(`${tag} the room's include in the Savvy settings does the same`, (await read(page, viaSettings)).events.length === 2);

    // the history page has a lane for it
    const ids2 = await page.evaluate((i) => window.cards[i]._histIds?.() || [], ids.hall);
    check(`${tag} the history page tracks the lock`, ids2.includes("lock.front_door"), JSON.stringify(ids2));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
