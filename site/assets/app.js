// The demo app: one page at a time, in the address (?p=living-room), the cards of that page
// mounted on the live house, a theme switch, and a details panel where Home Assistant would
// open its own dialog.
(() => {
  const D = window.SavvyDemo;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

  // ---- theme: auto follows the device; light or dark is remembered
  const media = matchMedia("(prefers-color-scheme: dark)");
  let themeChoice = store.get("savvy-demo-theme") || "auto";
  const isDark = () => (themeChoice === "auto" ? media.matches : themeChoice === "dark");

  const live = D.createLive({ dark: isDark(), dashboard: D.DASHBOARD, onMoreInfo: (id) => info.open(id) });

  function applyTheme() {
    const dark = isDark();
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.body.classList.toggle("light", !dark);
    live.setDark(dark);
    for (const b of document.querySelectorAll("[data-theme-choice]")) b.setAttribute("aria-pressed", String(b.dataset.themeChoice === themeChoice));
  }
  media.addEventListener("change", () => themeChoice === "auto" && applyTheme());

  // ---- navigation
  function pageId() {
    const q = new URLSearchParams(location.search).get("p");
    return (q || location.hash.replace(/^#/, "") || "home").toLowerCase();
  }
  function nav() {
    const groups = [["home", "Home"], ["rooms", "Rooms"], ["domains", "House"]];   // the pages, as the dashboard's views
    $("#nav").innerHTML = groups.map(([g, label]) => `<div class="nav-group" role="group" aria-label="${label}">${D.PAGES.filter((p) => p.group === g)
      .map((p) => `<a href="?p=${p.id}" data-page="${p.id}">${esc(p.nav)}</a>`).join("")}</div>`).join(`<span class="nav-sep" aria-hidden="true"></span>`);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[data-page]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    go(a.dataset.page);
  });
  function go(id) {
    if (id !== pageId()) history.pushState(null, "", `?p=${id}`);
    render();
  }
  // the cards navigate the way they do in Home Assistant: pushState, then location-changed
  window.addEventListener("location-changed", () => render());
  window.addEventListener("popstate", () => render());

  // ---- a page: its sections, its cards
  const mounted = new Set();
  let shown = null;
  function render() {
    const page = D.pageFor(pageId());
    if (shown === page.id) return;
    shown = page.id;
    for (const card of mounted) { live.detach(card); card.remove(); }
    mounted.clear();
    info.close();
    const main = $("#page");
    main.innerHTML = "";
    main.dataset.page = page.id;
    if (page.id === "home") main.append(intro());
    // a "sections" view: up to max_columns columns; a section spans column_span of them, and lays its
    // cards on a grid of 12 columns per column it spans, each card as wide as its grid_options say
    const grid = document.createElement("div");
    grid.className = "sections";
    grid.__max = page.max_columns || 3;
    for (const section of page.sections) {
      const box = document.createElement("section");
      box.className = "section";
      box.__span = section.column_span || 1;
      for (const [type, config] of section.cards) {
        const el = mount(type, config);
        el.__grid = config.grid_options || {};
        box.append(el);
      }
      grid.append(box);
    }
    main.append(grid);
    layout.observe(grid);
    document.title = page.id === "home" ? "Savvy Cards · Live demo" : `${page.title} · Savvy Cards demo`;
    for (const a of document.querySelectorAll("#nav a")) a.toggleAttribute("aria-current", a.dataset.page === page.id);
    $("#nav a[aria-current]")?.scrollIntoView({ block: "nearest", inline: "center" });
    window.scrollTo({ top: 0 });
  }

  // Home Assistant's sections view: columns of 320 to 500 px, at most the view's max_columns
  const COL_MIN = 320, GAP = 24;
  const layout = new ResizeObserver(([e]) => fit(e.target));
  function fit(grid) {
    const w = grid.parentElement.clientWidth;
    const cols = Math.max(1, Math.min(grid.__max, Math.floor((w + GAP) / (COL_MIN + GAP))));
    grid.style.setProperty("--cols", cols);
    for (const box of grid.children) {
      const span = Math.min(box.__span, cols);
      box.style.gridColumn = `span ${span}`;
      box.style.setProperty("--cells", 12 * span);
      for (const card of box.children) {
        const want = card.__grid?.columns ?? card.getGridOptions?.()?.columns ?? 12;
        const n = want === "full" ? 12 * span : Math.min(12 * span, Number(want) || 12);
        card.style.gridColumn = `span ${n}`;
        const rows = card.__grid?.rows ?? card.getGridOptions?.()?.rows;
        card.style.height = typeof rows === "number" ? `${rows * 56 + (rows - 1) * 8}px` : "";
      }
    }
  }

  function mount(type, config) {
    const el = document.createElement(type);
    try {
      const { grid_options, ...rest } = config;
      el.setConfig({ type: `custom:${type}`, ...rest, ...(grid_options ? { grid_options } : {}) });
    } catch (err) {
      const box = document.createElement("div");
      box.className = "card-error";
      box.textContent = `${type}: ${err.message}`;
      return box;
    }
    live.attach(el);
    mounted.add(el);
    return el;
  }

  function intro() {
    const box = document.createElement("div");
    box.className = "intro";
    box.innerHTML = `<p><b>A live demo.</b> Every card here is the real Savvy Cards code, running on a made-up house of six rooms. Tap a light, drag it sideways to dim it, hold anything for its details, change the A/C, skip a song. Nothing is connected to a real home.</p>
      <a class="btn" href="https://github.com/gabrielmazor/lovelace-savvy-cards#install" target="_blank" rel="noopener">Install with HACS</a>`;
    return box;
  }

  // ---- details: where Home Assistant would open its more-info dialog
  const HIDE = new Set(["friendly_name", "icon", "entity_picture", "supported_features", "supported_color_modes", "options", "source_list", "fan_speed_list", "hvac_modes", "fan_modes", "preset_modes",
    "available_modes", "entities", "services", "user_id", "source", "media_position_updated_at", "min_color_temp_kelvin", "max_color_temp_kelvin", "hs_color", "rgb_color", "color_mode"]);
  const TOGGLE = new Set(["light", "switch", "input_boolean", "fan", "humidifier", "media_player"]);
  const info = {
    el: null,
    open(id) {
      const st = live.state(id);
      if (!st) return;
      this.id = id;
      const el = $("#info");
      const domain = id.split(".")[0], a = st.attributes;
      const rows = Object.entries(a).filter(([k, v]) => !HIDE.has(k) && v != null && typeof v !== "object" && v !== "")
        .map(([k, v]) => `<div class="kv"><span>${esc(k.replace(/_/g, " "))}</span><b>${esc(typeof v === "number" ? Math.round(v * 100) / 100 : v)}</b></div>`).join("");
      const since = Math.round((Date.now() - Date.parse(st.last_changed)) / 60000);
      el.querySelector(".info-body").innerHTML = `
        <div class="info-head"><span class="info-ic" style="color:var(--info-c)"><ha-state-icon></ha-state-icon></span>
          <div><h2>${esc(a.friendly_name || id)}</h2><p>${esc(live.hass.formatEntityState(st))} · for ${since < 60 ? `${since} min` : `${Math.round(since / 60)} h`}</p></div></div>
        ${a.entity_picture && domain !== "person" ? `<img class="info-pic" alt="" src="${a.entity_picture}">` : ""}
        ${TOGGLE.has(domain) ? `<button class="btn wide" data-info-toggle>${st.state === "off" || st.state === "idle" || st.state === "paused" ? "Turn on" : "Turn off"}</button>` : ""}
        <div class="kvs">${rows || `<p class="muted">Nothing more to show.</p>`}</div>
        <p class="muted small">${esc(id)} · In Home Assistant, this is its own dialog.</p>`;
      const icon = el.querySelector("ha-state-icon");
      icon.stateObj = st;
      el.hidden = false;
      requestAnimationFrame(() => el.setAttribute("data-open", ""));
      el.querySelector(".info-close").focus({ preventScroll: true });
    },
    close() {
      const el = $("#info");
      if (!el || el.hidden) return;
      el.removeAttribute("data-open");
      setTimeout(() => { if (!el.hasAttribute("data-open")) el.hidden = true; }, 220);
    },
  };
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-info-close]")) info.close();
    if (e.target.closest?.("[data-info-toggle]")) {
      const id = info.id, domain = id.split(".")[0];
      live.callService(domain, "toggle", {}, { entity_id: id });
      setTimeout(() => info.open(id), 450);
    }
    const choice = e.target.closest?.("[data-theme-choice]");
    if (choice) { themeChoice = choice.dataset.themeChoice; store.set("savvy-demo-theme", themeChoice); applyTheme(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") info.close(); });

  // ---- start
  nav();
  applyTheme();
  render();
  $("#version").textContent = window.SAVVY_DEMO_VERSION ? `v${window.SAVVY_DEMO_VERSION}` : "";
})();
