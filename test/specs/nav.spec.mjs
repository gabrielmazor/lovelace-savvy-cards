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

  // lines between groups of pages: "---", or `divider: true` on the page before; never at an end or doubled
  const seps = () => page.evaluate(() => [...window.navRoot().querySelector(".links").children].map((n) => n.classList.contains("sep") ? "|" : n.textContent.trim()).join(" "));
  check("a line between the groups", (await seps()) === "Home Living Room | Lights", await seps());
  await page.evaluate(() => {
    window.nav.setConfig({ title: "Our home", pages: ["---", { path: "/lovelace/home", name: "Home", divider: true }, "---", { path: "/lovelace/lights", name: "Lights", divider: true }] });
    window.nav.hass = window.hass;
  });
  await page.waitForTimeout(300);
  check("divider: true draws one too, one line only and none at the ends", (await seps()) === "Home | Lights", await seps());

  // a wide dashboard: the bar's content spans the sections (the card's own width), its edges on theirs
  const fit = await page.evaluate(async () => {
    const r = window.huiRoot, n = window.nav;
    r.style.width = "1500px";
    const box = document.createElement("div");
    box.style.cssText = "margin-left: 90px; width: 1320px;";
    r.insertBefore(box, n); box.appendChild(n);
    n.hass = window.hass;
    await new Promise((res) => setTimeout(res, 400));
    const inn = window.navRoot().querySelector(".in").getBoundingClientRect(), me = n.getBoundingClientRect();
    const mark = window.navRoot().querySelector(".mark").getBoundingClientRect(), bar = window.navRoot().querySelector(".bar").getBoundingClientRect();
    const out = { inLeft: Math.round(inn.left), inW: Math.round(inn.width), meLeft: Math.round(me.left), meW: Math.round(me.width), mark: Math.round(mark.left), barH: Math.round(bar.height) };
    r.style.width = ""; r.insertBefore(n, box); box.remove(); n.hass = window.hass;
    await new Promise((res) => setTimeout(res, 300));
    return out;
  });
  check("on a wide dashboard the bar is as wide as the sections, on their edges", Math.abs(fit.inLeft + fit.inW - (fit.meLeft + fit.meW)) <= 1 && fit.meW === 1320, JSON.stringify(fit));
  check("its house icon starts on the sections' edge, the sidebar button in the margin before it", Math.abs(fit.mark - fit.meLeft) <= 1 && fit.inLeft < fit.meLeft, JSON.stringify(fit));
  check("and it is as tall as Home Assistant's header, so its line meets the sidebar's", fit.barH === 56, JSON.stringify(fit));

  // the dashboard menu (⋮): Home Assistant's own entries, run by its page; only when asked; admin: administrators only
  const more = () => page.evaluate(() => { const b = window.navRoot().querySelector(".more"); return !!b && !b.hidden && b.getBoundingClientRect().width > 0; });
  check("no menu unless asked", !(await more()));
  await page.evaluate(() => {
    const r = window.huiRoot;
    window.ran = [];
    r._showQuickBar = () => window.ran.push("search");
    r._addDevice = () => window.ran.push("add device");
    r._enableEditMode = () => { window.ran.push("edit"); r.lovelace.editMode = true; };
    window.nav.setConfig({ title: "Our home", dashboard_menu: "admin", pages: [{ path: "/lovelace/home", name: "Home" }, { path: "/lovelace/lights", name: "Lights" }] });
    window.nav.hass = { ...window.hass, user: { ...(window.hass.user || {}), is_admin: false } };
  });
  await page.waitForTimeout(300);
  check("admin: not for someone who is not an administrator", !(await more()));
  await page.evaluate(() => { window.nav.setConfig({ ...window.nav._rawConfig, dashboard_menu: undefined, edit_button: true }); window.nav.hass = { ...window.hass, user: { ...(window.hass.user || {}), is_admin: false } }; });
  await page.waitForTimeout(300);
  const oldHidden = !(await more());
  await page.evaluate(() => { window.nav.hass = { ...window.hass, user: { ...(window.hass.user || {}), is_admin: true } }; });
  await page.waitForTimeout(300);
  check("0.20.7's edit_button: the menu, for administrators only", oldHidden && (await more()));
  await page.evaluate(() => { window.nav.setConfig({ ...window.nav._rawConfig, dashboard_menu: true }); window.nav.hass = { ...window.hass, user: { ...(window.hass.user || {}), is_admin: false } }; });
  await page.waitForTimeout(300);
  check("true: everyone sees it", await more());
  const opts = async () => page.evaluate(() => [...document.querySelector(".savvy-portal").shadowRoot.querySelectorAll(".sv-opt")].map((o) => o.textContent.trim()));
  const tapMore = async () => {
    const dots = await page.evaluate(() => { const r = window.navRoot().querySelector(".more").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...dots);
    await page.waitForTimeout(500);
  };
  await tapMore();
  check("someone else gets search, not the admin entries", JSON.stringify(await opts()) === JSON.stringify(["Search Home Assistant"]), JSON.stringify(await opts()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.nav.hass = { ...window.hass, user: { ...(window.hass.user || {}), is_admin: true } }; });
  await page.waitForTimeout(300);
  await tapMore();
  check("an administrator gets Home Assistant's entries", JSON.stringify(await opts()) === JSON.stringify(["Search Home Assistant", "Add device", "Edit dashboard"]), JSON.stringify(await opts()));
  const editAt = await page.evaluate(() => { const o = [...document.querySelector(".savvy-portal").shadowRoot.querySelectorAll(".sv-opt")].find((x) => x.textContent.includes("Edit")); const r = o.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.click(...editAt);
  await page.waitForTimeout(500);
  check("Edit dashboard runs Home Assistant's own, and the header comes back", (await page.evaluate(() => window.ran.join())) === "edit" && (await headerShown()), await page.evaluate(() => window.ran.join()));
  await page.evaluate(() => { window.huiRoot.lovelace.editMode = false; window.nav.hass = window.hass; });
  await page.waitForTimeout(300);

  // the settings card's Navigation bar section: every option, the card's own winning
  await page.evaluate(() => {
    const S = window.__savvy.SettingsStore;
    S.set({ nav: { title: "From settings", subtitle: "Ours", pages: [{ path: "/lovelace/home", name: "Home", divider: true }, { path: "/lovelace/lights", name: "Lights" }] } });
    window.nav.setConfig({});
    window.nav.hass = window.hass;
  });
  await page.waitForTimeout(300);
  const fromSettings = await page.evaluate(() => [window.navRoot().querySelector(".name").textContent, window.navRoot().querySelector(".sub").textContent].join("/"));
  check("a bare nav card takes the settings card's options", fromSettings === "From settings/Ours" && (await seps()) === "Home | Lights", fromSettings + " " + (await seps()));
  await page.evaluate(() => { window.nav.setConfig({ title: "Own name" }); window.nav.hass = window.hass; });
  await page.waitForTimeout(300);
  check("its own option wins", (await page.evaluate(() => window.navRoot().querySelector(".name").textContent)) === "Own name");
  await page.evaluate(() => { window.__savvy.SettingsStore.set(null); });

  // the settings card's editor keeps the bar's pages in nav.pages, shown as a list of their own
  const saved = await page.evaluate(() => {
    const ed = document.createElement("savvy-settings-card-editor");
    ed.hass = window.hass;
    document.body.appendChild(ed);
    ed.setConfig({ type: "custom:savvy-settings-card", nav: { title: "Ours", pages: [{ path: "home", name: "Home" }] } });
    const got = [];
    ed.addEventListener("config-changed", (e) => got.push(e.detail.config));
    const shown = JSON.stringify(ed._config.nav_pages);
    ed._emit({ ...ed._config, nav_pages: [{ path: "home", name: "Home", divider: true }, { path: "lights", name: "Lights" }] });
    ed._emit({ ...ed._config, nav_pages: [] });
    ed.remove();
    return { shown, first: got[0], second: got[1] };
  });
  check("the settings editor lists the bar's pages and writes them back to nav.pages",
    saved.shown === JSON.stringify([{ path: "home", name: "Home" }]) && saved.first?.nav?.pages?.length === 2 && saved.first.nav.title === "Ours" && !("nav_pages" in saved.first)
    && saved.second?.nav?.title === "Ours" && !("pages" in saved.second.nav), JSON.stringify(saved));

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
