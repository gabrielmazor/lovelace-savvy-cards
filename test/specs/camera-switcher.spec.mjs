// The camera switcher: tabs for a few cameras whose names fit, a menu (the home mode's picker) past four
// cameras or when a name would not fit its tab, and selector: tabs | menu to choose.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  await page.evaluate(() => {
    const cam = (id, name) => ({ [id]: { entity_id: id, state: "idle", attributes: { friendly_name: name, entity_picture: window.hass.states["camera.living_room"].attributes.entity_picture } } });
    window.setStates({ ...cam("camera.porch", "Porch"), ...cam("camera.yard", "Yard"), ...cam("camera.garage_side", "Garage side entrance"), ...cam("camera.shed", "Shed") });
    const C = (ids) => ids.map((entity) => ({ entity }));
    window.mount("savvy-camera-card", { cameras: C(["camera.living_room", "camera.kitchen"]), columns: 1, frigate: false }, 420);
    window.mount("savvy-camera-card", { cameras: C(["camera.living_room", "camera.kitchen", "camera.porch", "camera.yard", "camera.shed"]), columns: 1, frigate: false }, 420);
    window.mount("savvy-camera-card", { cameras: C(["camera.living_room", "camera.garage_side", "camera.kitchen"]), columns: 1, frigate: false }, 320);
    window.mount("savvy-camera-card", { cameras: C(["camera.living_room", "camera.kitchen", "camera.porch", "camera.yard", "camera.shed"]), columns: 1, frigate: false, selector: "tabs" }, 420);
    window.mount("savvy-camera-card", { cameras: C(["camera.living_room", "camera.kitchen"]), columns: 1, frigate: false, selector: "menu" }, 420);
  });
  await page.waitForTimeout(1200);
  const modes = await page.evaluate(() => window.cards.map((c) => {
    const r = c.shadowRoot, vis = (el) => el && !el.hidden && el.getBoundingClientRect().height > 0;
    return vis(r.getElementById("camSel")) ? "menu" : vis(r.getElementById("pills")) ? "tabs" : "none";
  }));
  check("two short names: tabs", modes[0] === "tabs", modes.join());
  check("five cameras: a menu", modes[1] === "menu", modes.join());
  check("a name too long for its tab at this width: a menu", modes[2] === "menu", modes.join());
  check("selector: tabs keeps tabs for five", modes[3] === "tabs", modes.join());
  check("selector: menu gives a menu for two", modes[4] === "menu", modes.join());

  // the menu lists the cameras; a pick switches, and the button says which one and where it sits
  const label = () => page.evaluate(() => { const b = window.cards[1].shadowRoot.getElementById("camSel"); return b.querySelector(".cn").textContent + " | " + b.querySelector(".cc").textContent; });
  check("the menu button names the camera and its place", (await label()) === "Living Room | 1 of 5", await label());
  const at = await page.evaluate(() => { const b = window.cards[1].shadowRoot.getElementById("camSel"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.click(...at);
  await page.waitForTimeout(600);
  const opts = await page.evaluate(() => [...document.querySelectorAll("*")].map((n) => n.shadowRoot).filter(Boolean).flatMap((r) => [...r.querySelectorAll(".sv-opt")])
    .filter((o) => o.getBoundingClientRect().width > 0).map((o) => { const q = o.getBoundingClientRect(); return { t: o.textContent.trim(), xy: [q.x + q.width / 2, q.y + q.height / 2] }; }));
  check("the menu lists all five", opts.length === 5, JSON.stringify(opts.map((o) => o.t)));
  const yard = opts.find((o) => o.t === "Yard");
  if (yard) await page.mouse.click(...yard.xy);
  await page.waitForTimeout(700);
  check("a pick switches the camera", (await label()) === "Yard | 4 of 5", await label());

  // wider, the long name fits its tab again
  await page.evaluate(() => { window.cards[2].style.width = "760px"; });
  await page.waitForTimeout(700);
  const wide = await page.evaluate(() => { const r = window.cards[2].shadowRoot; return !r.getElementById("pills").hidden && r.getElementById("camSel").hidden; });
  check("given room, the long name goes back to tabs", wide, String(wide));

  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
