// savvy-people-card: who is home, where the others are, the phone's battery and the way home.
import { openPage, idle } from "./_util.mjs";

const SETUP = () => {
  const PIC = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='%23c98bd9'/></svg>";
  const h = window.hass, house = window.house;
  const add = (id, state, attributes, extra = {}) => {
    house.states[id] = { entity_id: id, state, attributes, last_changed: extra.changed || new Date().toISOString(), last_updated: new Date().toISOString() };
    h.entities[id] = { entity_id: id, area_id: null, device_id: extra.device || null, platform: "demo", entity_category: null, hidden: false, disabled_by: null };
  };
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  add("person.alex", "home", { friendly_name: "Alex", source: "device_tracker.alex_phone", entity_picture: PIC }, { changed: ago(180) });
  add("device_tracker.alex_phone", "home", {}, { device: "dev_alex_phone" });
  add("sensor.alex_phone_battery", "78", { device_class: "battery", unit_of_measurement: "%" }, { device: "dev_alex_phone" });
  add("person.sam", "Work", { friendly_name: "Sam", source: "device_tracker.sam_phone" }, { changed: ago(40) });
  add("device_tracker.sam_phone", "Work", { battery_level: 8 });
  add("zone.work", "0", { friendly_name: "Work", icon: "mdi:briefcase" });
  add("person.jo", "not_home", { friendly_name: "Jo" }, { changed: ago(125) });
  add("sensor.jo_travel", "12", { unit_of_measurement: "min" });
  add("sensor.sam_travel", "2026-01-01T00:00:00+00:00", { device_class: "timestamp" });
  window.hass = { ...h, states: { ...house.states } };
  window.__info = [];
  window.addEventListener("hass-more-info", (e) => window.__info.push(e.detail.entityId));
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 360]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(SETUP);
    await page.evaluate((width) => {
      window.mount("savvy-people-card", { eta: "sensor.jo_travel" }, width);                                                 // 0
      window.mount("savvy-people-card", { people: [{ entity: "person.sam", name: "Samuel", eta: "sensor.jo_travel" }, "person.alex"], battery: false, title: "Family" }, width);  // 1
      window.mount("savvy-people-card", { layout: "compact", exclude: ["person.jo"] }, width);                               // 2
      window.mount("savvy-people-card", { direction: "horizontal", eta: "sensor.jo_travel" }, width);                        // 3
    }, width);
    await page.waitForTimeout(900);
    const read = (i) => page.evaluate((i) => {
      const R = window.cards[i].shadowRoot;
      return { title: R.getElementById("title").textContent, pill: R.getElementById("pill").textContent,
        people: [...R.querySelectorAll(".p")].map((p) => ({ n: p.querySelector(".nm").textContent, st: p.querySelector(".st").textContent, home: p.hasAttribute("data-home"),
          chips: [...p.querySelectorAll(".chp")].map((c) => c.textContent.trim() + (c.dataset.level ? `[${c.dataset.level}]` : "")), img: !!p.querySelector(".av img:not([hidden])"), ini: p.querySelector(".ini").textContent })) };
    }, i);
    const a = await read(0), b = await read(1), c = await read(2);
    check(`${tag} home first, then the others by name`, JSON.stringify(a.people.map((p) => p.n)) === JSON.stringify(["Alex", "Jo", "Sam"]) && a.pill === "1 of 3 home", JSON.stringify(a));
    check(`${tag} where each is, and for how long`, /^Home · 3 h/.test(a.people[0].st) && /^Away · 2 h/.test(a.people[1].st) && /^At Work · 40 min/.test(a.people[2].st), JSON.stringify(a.people.map((p) => p.st)));
    check(`${tag} the phone's battery: found through the device, or the tracker's own level; low is amber, very low red`, a.people[0].chips.includes("78%") && a.people[2].chips.some((x) => x === "8%[bad]"), JSON.stringify(a.people.map((p) => p.chips)));
    check(`${tag} the way home shows only while away`, a.people[1].chips.some((x) => x === "12 min") && !a.people[0].chips.some((x) => /min/.test(x)), JSON.stringify(a.people.map((p) => p.chips)));
    check(`${tag} a picture, or the first letter`, a.people[0].img && !a.people[1].img && a.people[1].ini === "J", JSON.stringify(a.people.map((p) => [p.img, p.ini])));
    check(`${tag} a list keeps its order, names and per-person options; battery: false hides it`, JSON.stringify(b.people.map((p) => p.n)) === JSON.stringify(["Samuel", "Alex"]) && b.title === "Family" && b.people.every((p) => !p.chips.some((x) => /%/.test(x))) && b.people[0].chips.some((x) => x === "12 min"), JSON.stringify(b));
    check(`${tag} compact: avatars with names, exclude honoured`, JSON.stringify(c.people.map((p) => p.n)) === JSON.stringify(["Alex", "Sam"]), JSON.stringify(c));
    const cc = await page.evaluate(() => { const R = window.cards[2].shadowRoot; const p = R.querySelector(".p"); return { dir: getComputedStyle(R.querySelector(".list")).flexDirection, st: getComputedStyle(p.querySelector(".st")).display, w: p.getBoundingClientRect().width }; });
    check(`${tag} compact is a row of avatars`, cc.dir === "row" && cc.st === "none" && cc.w <= 70, JSON.stringify(cc));
    // the icon of the place, beside the words
    const icons = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".p")].map((p) => [p.querySelector(".nm").textContent, p.querySelector(".st ha-icon").getAttribute("icon")]));
    check(`${tag} the place's icon: home, a pin for away, the zone's own`, JSON.stringify(icons) === JSON.stringify([["Alex", "mdi:home"], ["Jo", "mdi:map-marker-off"], ["Sam", "mdi:briefcase"]]), JSON.stringify(icons));
    // side by side
    const lay = await page.evaluate(() => { const R = window.cards[3].shadowRoot, ps = [...R.querySelectorAll(".p")].map((p) => { const b = p.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) }; }); const card = R.querySelector("ha-card").getBoundingClientRect(); return { ps, right: Math.round(card.right), over: ps.some((p) => p.x + p.w > card.right + 1) }; });
    const sameRow = lay.ps[0].y === lay.ps[1].y;
    check(`${tag} horizontal: side by side when there is room, wrapping when there is not, never out of the card`, !lay.over && (width >= 700 ? sameRow && lay.ps[1].x > lay.ps[0].x : lay.ps[1].y >= lay.ps[0].y), JSON.stringify(lay));
    const tap = await page.evaluate(() => { const p = window.cards[0].shadowRoot.querySelectorAll(".p")[2]; p.scrollIntoView({ block: "center" }); const r = p.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }; });
    await page.mouse.click(tap.x, tap.y);
    await page.waitForTimeout(300);
    check(`${tag} a tap opens the person's details`, (await page.evaluate(() => window.__info)).includes("person.sam"), JSON.stringify(await page.evaluate(() => window.__info)));
    // someone arrives: the order and the pill follow
    await page.evaluate(() => window.setStates({ "person.jo": "home" }));
    await page.waitForTimeout(700);
    const after = await read(0);
    check(`${tag} when someone arrives the pill and the ring follow`, after.pill === "2 of 3 home" && after.people[1].home, JSON.stringify(after.people.map((p) => [p.n, p.home])));
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}
