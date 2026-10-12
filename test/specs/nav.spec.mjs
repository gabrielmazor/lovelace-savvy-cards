// savvy-nav-card in a stand-in for Home Assistant's page (a hui-root with its header): the bar sits at the top
// over the dashboard, holds its place, marks the current page and goes to another; Home Assistant's header is
// hidden while it is on screen, back in edit mode, with ?savvy_header, and once the card is gone.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 900 });
  await page.evaluate(() => {
    customElements.define("hui-root", class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<style>:host { display: block; --header-height: 56px; margin-left: 120px; width: 720px; }
          .header { height: var(--header-height); background: #333; } #view { padding-top: 0; }</style>
          <div class="header" id="hdr">Home Assistant</div><div id="view"><slot></slot></div>`;
        this.lovelace = { editMode: false };
      }
    });
    history.replaceState(null, "", "/lovelace/living-room");
    const root = document.createElement("hui-root");
    document.getElementById("stage").appendChild(root);
    window.huiRoot = root;
    window.toggles = 0;
    window.addEventListener("hass-toggle-menu", () => window.toggles++);
    const nav = document.createElement("savvy-nav-card");
    nav.setConfig({ title: "Our home", pages: [{ path: "/lovelace/home", name: "Home" }, { path: "/lovelace/living-room", name: "Living Room" }, "---", { path: "/lovelace/lights", name: "Lights" }] });
    root.appendChild(nav);
    nav.hass = window.hass;
    window.nav = nav;
    // the bar lives on the page (a layer of its own), or in the card while the dashboard is edited
    window.navRoot = () => document.querySelector(".savvy-nav-layer")?.shadowRoot?.querySelector(".bar") ? document.querySelector(".savvy-nav-layer").shadowRoot : window.nav.shadowRoot;
  });
  await page.waitForTimeout(700);
  const headerShown = () => page.evaluate(() => getComputedStyle(window.huiRoot.shadowRoot.getElementById("hdr")).display !== "none");
  check("Home Assistant's header is hidden while the bar is there", !(await headerShown()));

  const geo = await page.evaluate(() => {
    const r = window.navRoot(), bar = r.querySelector(".bar").getBoundingClientRect(), root = window.huiRoot.getBoundingClientRect();
    return { pos: getComputedStyle(r.querySelector(".bar")).position, top: bar.top, left: bar.left, w: bar.width, rl: root.left, rw: root.width,
      spacer: window.nav.shadowRoot.getElementById("spacer").getBoundingClientRect().height, h: bar.height };
  });
  check("the bar is pinned to the top, over the dashboard (not the sidebar)", geo.pos === "fixed" && geo.top === 0 && geo.w > 600 && Math.abs(geo.left - geo.rl) < 1 && Math.abs(geo.w - geo.rw) < 1, JSON.stringify(geo));
  check("it holds its place in the page", Math.abs(geo.spacer - geo.h) < 2, JSON.stringify(geo));

  const links = () => page.evaluate(() => [...window.navRoot().querySelectorAll(".link")].map((a) => a.textContent.trim() + (a.getAttribute("aria-current") ? "*" : "")));
  check("the current page is marked", JSON.stringify(await links()) === JSON.stringify(["Home", "Living Room*", "Lights"]), JSON.stringify(await links()));
  const at = await page.evaluate(() => { const a = [...window.navRoot().querySelectorAll(".link")].find((x) => x.textContent.includes("Lights")); const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.click(...at);
  await page.waitForTimeout(400);
  const pth = await page.evaluate(() => location.pathname); check("a tap goes to the page", pth === "/lovelace/lights" && (await links()).includes("Lights*"), pth + " " + JSON.stringify(await links()) + " at " + JSON.stringify(at));

  const menu = await page.evaluate(() => { const b = window.navRoot().querySelector(".menu"); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.click(...menu);
  await page.waitForTimeout(300);
  check("the sidebar button opens Home Assistant's sidebar", (await page.evaluate(() => window.toggles)) === 1);

  // edit mode: the header is back and the bar sits in its card
  await page.evaluate(() => { window.huiRoot.lovelace.editMode = true; window.nav.hass = window.hass; });
  await page.waitForTimeout(300);
  const inline = await page.evaluate(() => window.nav.hasAttribute("inline") && getComputedStyle(window.navRoot().querySelector(".bar")).position !== "fixed" && window.navRoot() === window.nav.shadowRoot);
  check("in edit mode the header is back and the bar stays in its card", (await headerShown()) && inline);
  await page.evaluate(() => { window.huiRoot.lovelace.editMode = false; window.nav.hass = window.hass; });
  await page.waitForTimeout(300);
  check("out of edit mode it hides again", !(await headerShown()));

  // ?savvy_header: the header stays
  await page.evaluate(() => { history.replaceState(null, "", "/lovelace/lights?savvy_header"); window.dispatchEvent(new CustomEvent("location-changed")); });
  await page.waitForTimeout(300);
  check("?savvy_header keeps the header", await headerShown());
  await page.evaluate(() => { history.replaceState(null, "", "/lovelace/lights"); window.dispatchEvent(new CustomEvent("location-changed")); });
  await page.waitForTimeout(300);

  // the dashboard's own views by default, the hidden ones left out
  await page.evaluate(() => {
    const S = window.__savvy.SettingsStore;
    S.setDashboard(S.views, S.orders, [{ path: "home", title: "Home", icon: "mdi:home", hidden: false }, { path: "lights", title: "Lights", icon: "", hidden: false }, { path: "secret", title: "Secret", icon: "", hidden: true }]);
    window.nav.setConfig({});
    window.nav.hass = window.hass;
    S._emit();
  });
  await page.waitForTimeout(400);
  check("by default: the dashboard's views, hidden ones left out", JSON.stringify(await links()) === JSON.stringify(["Home", "Lights*"]), JSON.stringify(await links()));
  const name = await page.evaluate(() => window.navRoot().querySelector(".name").textContent);
  check("its name defaults to the home's", name.length > 0 && name !== "undefined", name);

  // gone from the page: the header comes back
  await page.evaluate(() => window.nav.remove());
  await page.waitForTimeout(500);
  check("without the bar the header is back", await headerShown());
  check("and the bar's layer is gone from the page", (await page.evaluate(() => document.querySelectorAll(".savvy-nav-layer").length)) === 0);
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
