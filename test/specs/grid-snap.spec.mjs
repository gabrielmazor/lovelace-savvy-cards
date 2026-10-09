// In a sections grid every card is a whole number of rows tall (56px rows, 8px between), so cards side by
// side end together; outside a grid, or with a number of rows given, a card keeps its own height.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  const ROW = 56, GAP = 8, whole = (h) => Math.abs(((h + GAP) / (ROW + GAP)) - Math.round((h + GAP) / (ROW + GAP))) < 0.02;
  const cards = [
    ["savvy-lights-card", { area: "living_room" }], ["savvy-climate-card", { entity: "climate.living_room_ac" }],
    ["savvy-media-card", { area: "living_room", artwork: false }], ["savvy-room-header-card", { area: "living_room" }],
    ["savvy-section-title-card", { area: "living_room" }], ["savvy-lock-card", { entity: "lock.front_door" }],
    ["savvy-scene-card", { area: "living_room" }], ["savvy-people-card", {}],
  ];
  const heights = await page.evaluate(async (cards) => {
    const stage = document.getElementById("stage");
    stage.style.setProperty("--row-height", "56px"); stage.style.setProperty("--row-gap", "8px");
    for (const [type, cfg] of cards) window.mount(type, cfg, 420);
    await new Promise((r) => setTimeout(r, 1200));
    return window.cards.map((el) => ({ type: el.localName, h: el.shadowRoot.querySelector("ha-card").getBoundingClientRect().height }));
  }, cards);
  for (const { type, h } of heights) check(`${type}: a whole number of grid rows (${Math.round(h)}px)`, whole(h), String(h));

  // outside a grid nothing is added
  const free = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    stage.style.removeProperty("--row-height"); stage.style.removeProperty("--row-gap");
    const el = window.mount("savvy-lights-card", { area: "living_room" }, 420);
    await new Promise((r) => setTimeout(r, 800));
    return el.shadowRoot.querySelector("ha-card").style.minHeight;
  });
  check("outside a sections grid the card keeps its own height", free === "", free);

  // grid_snap: false and a fixed number of rows opt out
  const opt = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    stage.style.setProperty("--row-height", "56px"); stage.style.setProperty("--row-gap", "8px");
    const a = window.mount("savvy-lights-card", { area: "living_room", grid_snap: false }, 420);
    const b = window.mount("savvy-lights-card", { area: "living_room", grid_options: { rows: 4 } }, 420);
    await new Promise((r) => setTimeout(r, 800));
    return [a, b].map((el) => el.shadowRoot.querySelector("ha-card").style.minHeight);
  });
  check("grid_snap: false and grid_options.rows keep the card's own height", opt.every((x) => x === ""), JSON.stringify(opt));

  // content that shrinks lets the card shrink back to fewer rows
  const shrink = await page.evaluate(async () => {
    const el = window.mount("savvy-lights-card", { area: "living_room" }, 420);
    await new Promise((r) => setTimeout(r, 800));
    const before = el.shadowRoot.querySelector("ha-card").getBoundingClientRect().height;
    el.setConfig({ type: "custom:savvy-lights-card", lights: ["light.living_room_ceiling"] });
    await new Promise((r) => setTimeout(r, 900));
    return [before, el.shadowRoot.querySelector("ha-card").getBoundingClientRect().height];
  });
  check("fewer lights: the card shrinks to fewer rows", shrink[1] < shrink[0], JSON.stringify(shrink));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
