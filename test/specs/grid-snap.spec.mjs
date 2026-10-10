// Card heights in a sections grid: every card is as tall as it needs, and fills its grid cell, so cards side by
// side end together without empty rows added under either. `grid_snap: true` rounds a card up to whole grid rows
// (56px rows, 8px between); headers and titles never are. The one-row cards are exactly one row.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  const ROW = 56, GAP = 8, whole = (h) => Math.abs(((h + GAP) / (ROW + GAP)) - Math.round((h + GAP) / (ROW + GAP))) < 0.02;
  const grid = "display:grid;grid-template-columns:1fr 1fr;gap:8px;width:860px;--row-height:56px;--row-gap:8px";
  const mount = (list, css = grid) => page.evaluate(async ({ list, css }) => {
    const stage = document.getElementById("stage");
    stage.innerHTML = "";
    window.cards.length = 0;
    stage.style.cssText = css;
    for (const [type, cfg, span] of list) { const el = window.mount(type, cfg); el.style.width = ""; if (span) el.style.gridColumn = "1 / -1"; }
    await new Promise((r) => setTimeout(r, 1200));
    return window.cards.map((el) => { const c = el.shadowRoot.querySelector("ha-card"), q = c.getBoundingClientRect(); return { type: el.localName, top: q.top, h: q.height, min: c.style.minHeight }; });
  }, { list, css });

  // side by side: both end together, the taller one adds nothing
  const pairs = await mount([["savvy-lights-card", { area: "living_room" }], ["savvy-climate-card", { entity: "climate.living_room_ac" }],
    ["savvy-media-card", { area: "living_room", artwork: false }], ["savvy-lock-card", { entity: "lock.front_door" }]]);
  check("lights beside climate: they end together", Math.abs(pairs[0].h - pairs[1].h) < 1, JSON.stringify(pairs));
  check("media beside lock: they end together", Math.abs(pairs[2].h - pairs[3].h) < 1 && Math.abs(pairs[2].top - pairs[3].top) < 1, JSON.stringify(pairs));
  check("no rows are added by default", pairs.every((p) => p.min === ""), JSON.stringify(pairs));

  // on its own a card is exactly as tall as its content
  const natural = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    stage.innerHTML = ""; window.cards.length = 0;
    stage.style.cssText = "width:860px";
    const el = window.mount("savvy-lights-card", { area: "living_room" }, 860);
    await new Promise((r) => setTimeout(r, 800));
    return el.shadowRoot.querySelector("ha-card").getBoundingClientRect().height;
  });
  const alone = await mount([["savvy-lights-card", { area: "living_room" }, true]]);
  check("as wide as the section: the card's own height, nothing under it", Math.abs(alone[0].h - natural) < 1, JSON.stringify({ alone, natural }));

  // grid_snap: true rounds up to whole rows, beside another card; a fixed number of rows keeps HA's height
  const snap = await mount([["savvy-lights-card", { area: "living_room", grid_snap: true }], ["savvy-entity-card", { entity: "switch.living_room_plug" }],
    ["savvy-lights-card", { area: "living_room", grid_snap: true, grid_options: { rows: 4 } }]]);
  check("grid_snap: true: a whole number of grid rows", whole(snap[0].h) && snap[0].min !== "", JSON.stringify(snap));
  check("grid_snap with grid_options.rows: no rounding", snap[2].min === "", JSON.stringify(snap));

  // headers and titles take the height they need, even with grid_snap: true
  const heads = await mount([["savvy-section-title-card", { title: "Lights", grid_snap: true }], ["savvy-room-header-card", { area: "living_room", grid_snap: true }]]);
  check("section title and room header: never rounded to rows", heads.every((x) => x.min === ""), JSON.stringify(heads));

  // the one-row cards are exactly one row
  const one = await mount([["savvy-entity-card", { entity: "switch.living_room_plug" }], ["savvy-entity-card", { entity: "light.living_room_ceiling" }],
    ["savvy-scene-card", { area: "living_room", layout: "compact" }], ["savvy-vacuum-card", { entity: "vacuum.robot", layout: "compact" }]]);
  check("entity, compact scene and compact vacuum: one row (56px)", one.every((x) => Math.round(x.h) === 56), JSON.stringify(one));

  // the room tile: two rows, the same space above its name and under its badges
  const tile = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    stage.innerHTML = ""; window.cards.length = 0;
    stage.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;width:720px";
    const el = window.mount("savvy-room-tile", { area: "living_room" }); el.style.width = "";
    await new Promise((r) => setTimeout(r, 1000));
    const c = el.shadowRoot.querySelector("ha-card").getBoundingClientRect(), top = el.shadowRoot.querySelector(".top").getBoundingClientRect();
    const chips = [...el.shadowRoot.querySelectorAll(".chip")].filter((x) => x.getClientRects().length).map((x) => x.getBoundingClientRect().bottom);
    return { h: c.height, above: top.top - c.top, below: c.bottom - Math.max(...chips) };
  });
  check("room tile: 120px, as much space under the badges as above the name", Math.round(tile.h) === 120 && Math.abs(tile.above - tile.below) <= 2, JSON.stringify(tile));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
