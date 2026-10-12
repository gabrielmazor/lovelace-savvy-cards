// savvy-nav-card: the dashboard's own bar across the top of the screen, in place of Home Assistant's header.
// A name with its icon, and a row of links to the dashboard's pages (its views, in its order, else the pages
// listed here), the current one marked. It stays at the top while the page scrolls.
//
//   type: custom:savvy-nav-card
//   title: Our home            icon: mdi:home-outline       (title: the home's name in Home Assistant)
//   pages: [{ path: living-room, name: Living Room, icon: mdi:sofa, divider: true }, "---", ...]   (default: the views)
//                              a line between pages: "---", or `divider: true` on the page before it
//   hide_header: true          Home Assistant's own header is hidden while this card is on screen; it is
//                              there in edit mode, and with ?savvy_header in the address
//   menu_button: true          a button that opens Home Assistant's sidebar (the header's, when it is hidden)
//   icons: false               an icon before each page's name
//   auto_hide: false           slides away while scrolling down, back on the way up
//   edit_button: false         a ⋮ button that puts the dashboard in edit mode, for administrators only
//
// Hiding the header reaches into Home Assistant's own page (its `hui-root`): it works on the dashboards of
// today and is written to fail quietly (the header simply stays) if Home Assistant changes.

const NAV_STYLE = `${BASE_CSS}
  :host { display: block; }
  ha-card { background: none; border: 0; box-shadow: none; padding: 0; overflow: visible; min-height: 0; }
  ha-card::after { display: none; }
  /* holds the bar's place in the page, so the first cards start below it */
  .spacer { height: var(--nav-h, 0px); }
  .bar {
    position: fixed; top: 0; left: var(--nav-left, 0px); width: var(--nav-w, 100%); box-sizing: border-box;
    padding: env(safe-area-inset-top, 0px) 0 0;
    background: color-mix(in oklab, var(--primary-background-color, var(--card-background-color, #fff)) 82%, transparent);
    -webkit-backdrop-filter: saturate(1.6) blur(18px); backdrop-filter: saturate(1.6) blur(18px);
    border-bottom: 1px solid var(--line);
    transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
    color: var(--primary-text-color);
    --well: color-mix(in oklab, var(--primary-text-color) 8%, transparent);
    --line: color-mix(in oklab, var(--primary-text-color) 10%, transparent);
    container-type: inline-size;
  }
  .bar[data-away] { transform: translateY(-100%); }
  /* in the dashboard editor the bar sits in the card like any other, so it never covers the editor */
  :host([inline]) .spacer { display: none; }
  :host([inline]) .bar { position: relative; left: auto; width: auto; padding-top: 0; border: 1px solid var(--line); border-radius: var(--radius); }
  /* on the page itself: the layer that carries the bar, above the dashboard and below Home Assistant's dialogs */
  :host(.savvy-nav-layer) { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 4; }
  .in { display: flex; flex-wrap: wrap; align-items: center; column-gap: 14px; row-gap: 2px; padding: 8px 16px 6px; max-width: 1360px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; height: 44px; flex: 1 1 auto; }
  .menu { flex: none; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; margin-inline-start: -6px;
    color: var(--secondary-text-color); --mdc-icon-size: 22px; cursor: pointer; }
  .more { flex: none; order: 2; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; margin-inline-end: -6px;
    color: var(--secondary-text-color); --mdc-icon-size: 22px; cursor: pointer; }
  :host([inline]) .more { display: none; }
  .mark { flex: none; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
    background: color-mix(in oklab, rgb(var(--amber, 245 184 61)) 14%, transparent); color: rgb(245 184 61); --mdc-icon-size: 20px; }
  .name { min-width: 0; font-size: 17px; line-height: 22px; font-weight: 650; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { flex: none; font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); }
  /* the pages: one row that scrolls sideways on a phone, its ends fading */
  .links { order: 3; flex: 1 1 100%; display: flex; align-items: center; gap: 2px; overflow-x: auto; scrollbar-width: none; min-width: 0;
    margin: 0 -16px; padding: 0 16px 4px; overscroll-behavior-x: contain; touch-action: pan-x pan-y;
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%); }
  .links::-webkit-scrollbar { display: none; }
  .link { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border-radius: 11px;
    font-size: 15px; font-weight: 550; letter-spacing: -0.01em; color: var(--secondary-text-color); white-space: nowrap;
    cursor: pointer; --mdc-icon-size: 17px; transform-origin: 50% 50%; text-decoration: none; }
  .link[aria-current="page"] { color: var(--primary-text-color); background: var(--well); }
  .sep { flex: none; width: 1px; height: 18px; margin: 0 8px; background: var(--line); }
  /* wide: one line, the pages beside the name */
  @container (min-width: 820px) {
    .in { flex-wrap: nowrap; padding: 8px 20px; }
    .brand { flex: none; max-width: 32%; }
    .links { order: 1; flex: 1 1 auto; margin: 0; padding: 0 0 0 8px; justify-content: flex-end; }
  }
`;
// the theme the card sees, handed to the bar on the page (a theme can be set on a view, not on the page)
const NAV_THEME = ["--primary-background-color", "--card-background-color", "--primary-text-color", "--secondary-text-color",
  "--divider-color", "--ha-card-background", "--savvy-font-family"];

// what hiding Home Assistant's header puts in its page: no header, and no room kept for it
const HIDE_CSS = `:host { --header-height: 0px !important; }
.header { display: none !important; }`;
const HEADER_ON = () => /[?&]savvy_header\b/.test(location.search);
const NAV_HIDERS = new Set();     // the nav cards on screen that hide the header

// up from a card, through shadow roots, to the first element of that name
const upTo = (el, name) => {
  let n = el;
  while (n) {
    if (n.localName === name) return n;
    n = n.parentNode || n.host;
  }
  return null;
};

class SavvyNavCard extends SavvyCard {
  static gridSnap = false;
  static getStubConfig() { return { hide_header: true }; }
  static getConfigElement() { return document.createElement(NAV_EDITOR); }

  setConfig(config) {
    this._config = { hide_header: true, icons: false, auto_hide: false, ...(config || {}) };
    if (this._config.menu_button === undefined) this._config.menu_button = this._config.hide_header !== false;
    if (this._el) this._build();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    SettingsStore.load(hass);
    if (!this._el) this._build();
    this._update();
    this._header();
  }

  connectedCallback() {
    this._unsub = this._unsub || SettingsStore.subscribe(() => this._update());
    this._onNav = this._onNav || (() => { this._update(); this._header(); });
    window.addEventListener("location-changed", this._onNav);
    window.addEventListener("popstate", this._onNav);
    this._onScroll = this._onScroll || (() => this._scrolled());
    window.addEventListener("scroll", this._onScroll, { passive: true });
    if (this._el) {
      this._ro?.disconnect();
      this._ro = new ResizeObserver(() => this._place());
      this._watched = null;
      this._ro.observe(this._el.bar);
      this._ro.observe(this);
      this._ro.observe(document.documentElement);
      this._place(); this._header();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("location-changed", this._onNav);
    window.removeEventListener("popstate", this._onNav);
    window.removeEventListener("scroll", this._onScroll);
    this._unsub?.(); this._unsub = null;
    this._ro?.disconnect();
    this._layer?.remove();
    this._release();
  }

  getCardSize() { return 1; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    this._el?.wrap.remove();          // a new config builds a new bar: the old one goes
    root.innerHTML = `<style>${NAV_STYLE}</style><ha-card><div class="wrap" id="home"><div class="spacer" id="spacer"></div></div></ha-card>`;
    // The bar lives on the page itself, not inside the dashboard: Home Assistant's layout can trap a fixed
    // element (a containing block, a stacking context) and later cards would cover it.
    const tmp = document.createElement("div");
    tmp.innerHTML = `<div class="wrap"><nav class="bar" aria-label="Pages"><div class="in">
          <div class="brand">
            <button class="menu" aria-label="Open the sidebar" hidden><ha-icon icon="mdi:menu"></ha-icon></button>
            <span class="mark"><ha-icon class="logo"></ha-icon></span><span class="name"></span><span class="sub"></span>
          </div>
          <button class="more" aria-label="Edit dashboard" title="Edit dashboard" hidden><ha-icon icon="mdi:dots-vertical"></ha-icon></button>
          <div class="links" role="list"></div>
        </div></nav></div>`;
    const wrap = tmp.firstElementChild, q = (sel) => wrap.querySelector(sel);
    this._el = { card: root.querySelector("ha-card"), home: root.getElementById("home"), spacer: root.getElementById("spacer"), wrap,
      bar: q(".bar"), menu: q(".menu"), more: q(".more"), icon: q(".logo"), name: q(".name"), sub: q(".sub"), links: q(".links") };
    this._resetMotion();
    this._linkNodes = new Map();
    this._pressable(this._el.menu, { onTap: () => this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })), haptic: "light" });
    this._pressable(this._el.more, { onTap: () => this._edit(), haptic: "light" });
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._place());
    this._watched = null;
    this._ro.observe(this._el.bar);
    this._ro.observe(this);
    this._ro.observe(document.documentElement);
    this._place();
  }

  // the dashboard's edit mode, as Home Assistant's own menu starts it (its header comes back with it)
  _edit() {
    const lovelace = upTo(this, "hui-root")?.lovelace;
    if (typeof lovelace?.setEditMode !== "function") return;
    lovelace.setEditMode(true);
    requestAnimationFrame(() => this._header());
  }

  // the pages, from the config or the dashboard's views
  _pages() {
    const own = this._config.pages;
    if (Array.isArray(own) && own.length) {
      const out = [];
      for (const p of own) {
        if (p === "---" || p?.separator) out.push({ sep: true });
        else if (typeof p === "string") out.push({ path: p, name: title(String(p).split("/").pop().replace(/-/g, " ")) });
        else if (p?.path || p?.navigation_path) {
          out.push({ path: p.path || p.navigation_path, name: p.name || p.title || "", icon: p.icon });
          if (p.divider) out.push({ sep: true });
        }
      }
      // never a line at either end, nor two together
      return out.filter((p, i) => !p.sep || (i > 0 && i < out.length - 1 && !out[i - 1].sep));
    }
    return (SettingsStore.nav || []).filter((v) => !v.hidden).map((v) => ({ path: viewUrl(v.path), name: v.title || title(v.path.replace(/-/g, " ")), icon: v.icon }));
  }

  _url(path) {
    if (!path) return "";
    return path.startsWith("/") ? path : `${location.pathname.replace(/\/[^/]*$/, "")}/${path}`;
  }

  _update() {
    if (!this._el || !this._hass) return;
    const c = this._config, el = this._el;
    text(el.name, c.title || this._hass.config?.location_name || "Home");
    attr(el.icon, "icon", c.icon || "mdi:home-outline");
    text(el.sub, c.subtitle || "");
    el.sub.hidden = !c.subtitle;
    el.menu.hidden = !c.menu_button;
    el.more.hidden = !(c.edit_button && this._hass.user?.is_admin === true);

    const pages = this._pages(), here = location.pathname.replace(/\/+$/, "");
    const keep = new Set();
    pages.forEach((p, i) => {
      const key = p.sep ? `sep:${i}` : `link:${p.path}`;
      keep.add(key);
      let node = this._linkNodes.get(key);
      if (!node) {
        if (p.sep) { node = document.createElement("span"); node.className = "sep"; node.setAttribute("aria-hidden", "true"); }
        else {
          node = document.createElement("a");
          node.className = "link";
          node.setAttribute("role", "listitem");
          node.innerHTML = `<ha-icon hidden></ha-icon><span></span>`;
          node.addEventListener("click", (e) => e.preventDefault());
          this._pressable(node, { onTap: () => navigate(this._url(node.__path)), haptic: "selection" }, 0.05);
        }
        this._linkNodes.set(key, node);
      }
      if (!p.sep) {
        node.__path = p.path;
        attr(node, "href", this._url(p.path));
        text(node.querySelector("span"), p.name);
        const icon = node.querySelector("ha-icon");
        icon.hidden = !(c.icons && p.icon);
        if (c.icons && p.icon) attr(icon, "icon", p.icon);
        const on = this._url(p.path).replace(/\/+$/, "") === here;
        attr(node, "aria-current", on ? "page" : null);
      }
      place(el.links, node, i);
    });
    for (const [k, node] of this._linkNodes) if (!keep.has(k)) { node.remove(); this._linkNodes.delete(k); }
    // the current page in view in the row
    const cur = el.links.querySelector('[aria-current="page"]');
    if (cur && cur !== this._shownCur) {
      this._shownCur = cur;
      requestAnimationFrame(() => {
        const l = el.links, a = cur.offsetLeft, b = a + cur.offsetWidth;
        if (a < l.scrollLeft + 16 || b > l.scrollLeft + l.clientWidth - 16) l.scrollTo({ left: a - (l.clientWidth - cur.offsetWidth) / 2, behavior: "smooth" });
      });
    }
  }

  // the bar spans the dashboard (not Home Assistant's sidebar); the spacer keeps its height in the page
  _place() {
    if (!this._el) return;
    const inline = this._editing() || !this.isConnected;
    this.toggleAttribute("inline", inline);
    if (inline) {
      this._layer?.remove();
      if (this._el.wrap.parentNode !== this._el.home) this._el.home.appendChild(this._el.wrap);
      return;
    }
    const layer = this._layerEl();
    if (this._el.wrap.parentNode !== layer.shadowRoot) layer.shadowRoot.appendChild(this._el.wrap);
    if (!layer.isConnected) document.body.appendChild(layer);
    layer.toggleAttribute("dark", this.hasAttribute("dark"));
    const cs = getComputedStyle(this);
    for (const v of NAV_THEME) put(layer, v, cs.getPropertyValue(v).trim());
    for (const k of ["data-glass", "data-matte"]) layer.toggleAttribute(k, this._el.card.hasAttribute(k));
    const root = upTo(this, "hui-root"), r = (root || document.documentElement).getBoundingClientRect();
    // the dashboard's area changes with Home Assistant's sidebar: follow it
    if (root && this._ro && this._watched !== root) { this._ro.observe(root); this._watched = root; }
    put(layer, "--nav-left", `${Math.max(0, Math.round(r.left))}px`);
    put(layer, "--nav-w", `${Math.round(root ? r.width : document.documentElement.clientWidth)}px`);
    const top = parseFloat(getComputedStyle(this._el.bar).paddingTop) || 0;
    put(this, "--nav-h", `${Math.max(0, Math.round(this._el.bar.offsetHeight - top))}px`);
  }

  // the page-level element that carries the bar, with the card's own styles
  _layerEl() {
    if (this._layer) return this._layer;
    const l = (this._layer = document.createElement("div"));
    l.className = "savvy-nav-layer";
    l.attachShadow({ mode: "open" }).innerHTML = `<style>${NAV_STYLE}</style>`;
    watchKeyboard(l);
    return l;
  }

  // in the dashboard editor, or a card preview: the bar stays inside the card
  _editing() {
    if (this.hasAttribute("preview") || this.preview || upTo(this, "hui-card-preview") || upTo(this, "hui-dialog-edit-card")) return true;
    return !!upTo(this, "hui-root")?.lovelace?.editMode;
  }

  // Home Assistant's header: hidden while a nav card that asks for it is on screen (not in edit mode, not with
  // ?savvy_header); back as soon as none is
  _header() {
    const root = upTo(this, "hui-root");
    const want = this.isConnected && this._config?.hide_header !== false && !HEADER_ON() && root && !this._editing();
    if (want) { NAV_HIDERS.add(this); this._huiRoot = root; }
    else NAV_HIDERS.delete(this);
    this._place();
    if (root) syncHeader(root);
  }

  _release() {
    NAV_HIDERS.delete(this);
    const root = this._huiRoot;
    // a moment's grace: moving between views swaps one nav card for the next without the header flashing
    if (root) setTimeout(() => syncHeader(root), 300);
  }

  _scrolled() {
    if (!this._config?.auto_hide || !this._el || this.hasAttribute("inline")) return;
    const y = window.scrollY, last = this._lastY ?? y;
    this._lastY = y;
    if (Math.abs(y - last) < 4) return;
    attr(this._el.bar, "data-away", y > last && y > 80 ? "" : null);
  }
}

// one style element in Home Assistant's page, there while any nav card on that page wants the header gone
function syncHeader(root) {
  const sr = root.shadowRoot;
  if (!sr) return;
  const want = [...NAV_HIDERS].some((c) => c.isConnected && c._huiRoot === root);
  let st = sr.getElementById("savvy-nav-hide");
  if (want && !st) {
    st = document.createElement("style");
    st.id = "savvy-nav-hide";
    st.textContent = HIDE_CSS;
    sr.appendChild(st);
  } else if (!want && st) st.remove();
}

// ---------- editor ----------
const NAV_EDITOR = defineEditor("savvy-nav-card", (hass, c) => [
  S.grid(S.text("title", "Name", "The home's name in Home Assistant when empty."), S.icon("icon", "Icon")),
  S.text("subtitle", "Subtitle"),
  { name: "pages", label: "Pages", type: "list", helper: "Empty: the dashboard's own pages, in its order (subviews and hidden views left out).",
    addButton: { label: "Add a page", make: () => ({ path: "", name: "" }) },
    prefill: { label: "Start from the dashboard's pages", make: () => (SettingsStore.nav || []).filter((v) => !v.hidden)
      .map((v) => cleanConfig({ path: v.path, name: v.title || title(v.path.replace(/-/g, " ")), icon: v.icon })) },
    fixed: (p) => p === "---" || !!p?.separator,
    summary: (p) => (p === "---" || p?.separator ? { title: "Line" }
      : { title: p?.name || p?.path || "New page", sub: [p?.path, p?.divider && "a line after it"].filter(Boolean).join(" · ") }),
    item: [
      S.grid({ name: "name", label: "Name", selector: { text: {} } }, { name: "icon", label: "Icon", selector: { icon: {} } }),
      { name: "path", label: "Page", helper: "A view's path (living-room) or a full address (/lovelace/living-room).", selector: { navigation: {} } },
      { name: "divider", label: "A line after it", helper: "Sets the pages after it apart, as a group.", selector: { boolean: {} } },
    ] },
  S.bool("hide_header", "Hide Home Assistant's header", "While this card is on screen. It comes back in edit mode, and with ?savvy_header in the address.", true),
  S.grid(S.bool("menu_button", "Sidebar button", "Opens Home Assistant's sidebar.", true), S.bool("icons", "Page icons", "", false)),
  S.bool("edit_button", "Edit button", "A ⋮ button that opens the dashboard's edit mode. Only administrators see it.", false),
  S.bool("auto_hide", "Hide while scrolling down", "Slides away on the way down, back on the way up.", false),
]);

registerCard("savvy-nav-card", SavvyNavCard, "Navigation bar",
  "The dashboard's own bar across the top of the screen: its name and a row of links to its pages, in place of Home Assistant's header.");
