// ---------------------------------------------------------------------------------------
// core/editor: the visual editor every card gets. A card describes its options as a schema;
// scalar options render through HA's own <ha-form> (native look, standard selectors),
// list options through <savvy-list-editor> (add, remove, reorder, a sub-form per item).
//
// A card's editor:
//   class LightsEditor extends SavvyEditor {
//     schema(hass, config) { return [ ...ha-form schema entries..., { name: "chips", type: "list", ... } ] }
//   }
// Schema entries are HA's ha-form format, plus two Savvy extras:
//   { name, type: "list", label, item: [sub-schema], add: { selector }, summary(item) }
//   label / helper on any entry (turned into computeLabel / computeHelper)
// ---------------------------------------------------------------------------------------

// ha-form is only loaded once some HA editor has been opened. Creating an entities card's
// editor forces it, the way custom cards commonly do.
let formReady = null;
const ensureHaForm = () => formReady || (formReady = (async () => {
  if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
  try {
    const helpers = await window.loadCardHelpers?.();
    const card = await helpers?.createCardElement({ type: "entities", entities: [] });
    await card?.constructor?.getConfigElement?.();
  } catch (err) { /* the editor falls back to YAML in the card editor */ }
})());

const EDITOR_CSS = `
  :host { display: block; }
  .sv-ed { display: flex; flex-direction: column; gap: 16px; }
  .sv-section { display: flex; flex-direction: column; gap: 8px; }
  .sv-label { font-size: 14px; font-weight: 500; color: var(--primary-text-color); }
  .sv-help { font-size: 12px; color: var(--secondary-text-color); margin-top: -4px; }
  .sv-item { border: 1px solid var(--divider-color, rgba(0,0,0,.12)); border-radius: 12px; overflow: hidden; }
  .sv-item-head { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px; min-height: 40px; }
  .sv-item-head .t { flex: 1; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv-item-head .t small { color: var(--secondary-text-color); margin-inline-start: 6px; }
  .sv-item-body { padding: 4px 12px 12px; border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  .sv-ibtn { width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--secondary-text-color);
    display: grid; place-items: center; cursor: pointer; --mdc-icon-size: 20px; }
  .sv-ibtn:hover { background: color-mix(in oklab, var(--primary-text-color) 8%, transparent); }
  .sv-ibtn[disabled] { opacity: 0.3; cursor: default; }
  .sv-add { display: flex; gap: 8px; align-items: center; }
  .sv-add > * { flex: 1; }
  .sv-empty { font-size: 13px; color: var(--secondary-text-color); padding: 4px 2px; }
  .sv-prefill { align-self: flex-start; padding: 8px 14px; border: 0; border-radius: 10px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    color: var(--primary-color, #58a6ff); background: color-mix(in oklab, var(--primary-color, #58a6ff) 12%, transparent); }
  .sv-inherit { border-radius: 12px; padding: 10px 12px; background: color-mix(in oklab, var(--primary-color, #58a6ff) 9%, transparent); }
  .sv-inherit .h { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--primary-text-color); --mdc-icon-size: 18px; }
  .sv-inherit .l { display: flex; gap: 6px; font-size: 12.5px; line-height: 18px; color: var(--secondary-text-color); margin-top: 2px; }
  .sv-inherit .l b { flex: none; font-weight: 600; color: var(--primary-text-color); }
  .sv-inherit .l span { min-width: 0; overflow-wrap: anywhere; }
  .sv-inherit .l i { font-style: normal; opacity: 0.7; }
  .sv-inherit .l { align-items: baseline; }
  .sv-inherit .unlink { flex: none; margin-inline-start: auto; padding: 2px 10px; border: 0; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    color: var(--primary-color, #58a6ff); background: color-mix(in oklab, var(--primary-color, #58a6ff) 14%, transparent); }
  .sv-inherit .n { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 6px; }
`;

// Drop keys the user cleared, so the YAML stays as short as the choices made.
const cleanConfig = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "" || v === null) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
};

class SavvyEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._open = new Set();
  }
  // the card this edits (defineEditor sets it): what the Savvy settings give it is listed at the top
  get cardType() { return null; }
  connectedCallback() { this._unsub = SettingsStore.subscribe(() => this._renderInherit()); }
  disconnectedCallback() { this._unsub?.(); this._unsub = null; }
  _renderInherit() {
    const wrap = this.shadowRoot.querySelector(".sv-ed");
    if (!wrap || !this._config) return;
    const type = this.cardType;
    const list = type ? resolveSettings(type, this._config, SettingsStore.settings).inherited : [];
    let box = wrap.querySelector(".sv-inherit");
    if (!list.length) { box?.remove(); return; }
    if (!box) {
      box = document.createElement("div");
      box.className = "sv-inherit";
      box.innerHTML = '<div class="h"><ha-icon icon="mdi:cog-sync-outline"></ha-icon><span></span></div><div class="rows"></div><div class="n">Set a value on this card to override it.</div>';
      wrap.insertBefore(box, wrap.firstChild);
    }
    // what is not from the settings card is found on the dashboard itself
    box.querySelector(".h span").textContent = list.every((i) => i.unlink || i.from === AUTO) ? "Found on the dashboard" : "From Savvy settings";
    const key = JSON.stringify(list);
    if (box.__key === key) return;
    box.__key = key;
    const rows = box.querySelector(".rows");
    rows.replaceChildren(...list.map((i) => {
      const row = document.createElement("div");
      row.className = "l";
      const b = document.createElement("b"), v = document.createElement("span"), f = document.createElement("i");
      b.textContent = i.label;
      v.textContent = i.value;
      f.textContent = ` (${i.from})`;
      v.appendChild(f);
      row.append(b, v);
      // a value read from another card can be taken over: it is copied here and no longer follows
      if (i.unlink) {
        const u = document.createElement("button");
        u.type = "button";
        u.className = "unlink";
        u.textContent = "Unlink";
        u.addEventListener("click", () => { this._emit({ ...this._config, [i.path]: i.raw }); this._render(); });
        row.appendChild(u);
      }
      return row;
    }));
  }
  // HA answers every config-changed with setConfig. When that's our own change coming
  // back, nothing is rebuilt: rebuilding replaces the field being typed in, and the cursor
  // is lost after every character (most visibly in Safari).
  setConfig(config) {
    const same = this._config && JSON.stringify(cleanConfig({ ...config })) === JSON.stringify(this._config);
    this._config = same ? this._config : { ...config };
    if (!same) this._render();
  }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) ensureHaForm().then(() => this._render());
    for (const f of this.shadowRoot.querySelectorAll("ha-form")) f.hass = hass;
    for (const l of this.shadowRoot.querySelectorAll("savvy-list-editor")) l.hass = hass;
  }
  _shown() {
    const d = { ...this._config };
    for (const [k, v] of this._defaults || []) if (d[k] === undefined) d[k] = v;
    return d;
  }

  // Cards override: returns the schema for the current config (may depend on hass, e.g.
  // climate lists the area's climate entities).
  schema() { return []; }

  // cards can tidy what the form wrote before it is saved (see defineEditor)
  tidy(config) { return config; }

  _emit(config) {
    // an option equal to its default is left out, so the YAML stays as short as the choices
    const out = this.tidy({ ...config });
    for (const [k, v] of this._defaults || []) if (out[k] === v) delete out[k];
    this._config = cleanConfig(out);
    // HA answers config-changed with setConfig, but the forms mustn't show stale values
    // meanwhile (or where nothing answers)
    const shown = this._shown(), shownKey = JSON.stringify(shown);
    for (const f of this.shadowRoot.querySelectorAll("ha-form")) {
      if (f.__dataKey !== shownKey) { f.__dataKey = shownKey; f.data = shown; }
    }
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _render() {
    if (!this._config) return;
    const root = this.shadowRoot;
    if (!root.__style) { root.__style = document.createElement("style"); root.__style.textContent = EDITOR_CSS; root.appendChild(root.__style); }
    let wrap = root.querySelector(".sv-ed");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "sv-ed"; root.appendChild(wrap); }
    const schema = this.schema(this._hass, this._config) || [];
    // defaults (schema entries with `default`) show in the form while the option is unset
    this._defaults = new Map();
    const collect = (list) => list.forEach((e) => { if (e.name && e.default !== undefined) this._defaults.set(e.name, e.default); if (e.schema && !e.name) collect(e.schema); });
    collect(schema.filter((e) => e.type !== "list"));
    // consecutive scalar entries share one ha-form; each list gets its own editor
    const groups = [];
    for (const entry of schema) {
      if (entry.type === "list") groups.push(entry);
      else if (groups.length && Array.isArray(groups[groups.length - 1])) groups[groups.length - 1].push(entry);
      else groups.push([entry]);
    }
    const nodes = [];
    groups.forEach((g, i) => {
      const key = Array.isArray(g) ? `form:${i}` : `list:${g.name}`;
      let node = wrap.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (Array.isArray(g)) {
        if (!node) {
          node = document.createElement("ha-form");
          node.dataset.key = key;
          node.addEventListener("value-changed", (e) => {
            e.stopPropagation();
            this._emit({ ...this._config, ...e.detail.value });
          });
        }
        const labels = new Map(), helps = new Map();
        const walk = (list) => list.forEach((s) => {
          if (s.name && s.label) labels.set(s.name, s.label);
          if (s.name && s.helper) helps.set(s.name, s.helper);
          if (s.schema) walk(s.schema);
        });
        walk(g);
        node.computeLabel = (s) => labels.get(s.name) || title(s.name);
        node.computeHelper = (s) => helps.get(s.name) || "";
        // a new schema array makes ha-form rebuild its fields: only hand it one when the
        // schema really changed (by content; functions don't count)
        const schemaKey = JSON.stringify(g);
        if (node.__schemaKey !== schemaKey) { node.__schemaKey = schemaKey; node.schema = g; }
        const data = this._shown(), dataKey = JSON.stringify(data);
        if (node.__dataKey !== dataKey) { node.__dataKey = dataKey; node.data = data; }
        node.hass = this._hass;
      } else {
        if (!node) {
          node = document.createElement("savvy-list-editor");
          node.dataset.key = key;
          node.addEventListener("list-changed", (e) => {
            e.stopPropagation();
            this._emit({ ...this._config, [g.name]: e.detail.items });
          });
        }
        node.hass = this._hass;
        node.setup(g, this._config[g.name], this._config);
      }
      nodes.push(node);
    });
    const keep = wrap.querySelector(".sv-inherit");
    for (const n of [...wrap.children]) if (!nodes.includes(n) && n !== keep) n.remove();
    nodes.forEach((n) => wrap.appendChild(n));
    this._renderInherit();
    const box = wrap.querySelector(".sv-inherit");
    if (box && wrap.firstChild !== box) wrap.insertBefore(box, wrap.firstChild);
  }
}

// An ordered list of items (strings or objects): add, remove, reorder, edit one at a time.
class SavvyListEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._openIdx = -1;
  }
  set hass(h) {
    this._hass = h;
    for (const f of this.shadowRoot.querySelectorAll("ha-form, ha-entity-picker, ha-selector")) f.hass = h;
  }
  // spec.initial(hass, config): what to show while the option is unset (lights-card's order
  // starts as the discovered order, so reordering works from the first touch)
  setup(spec, items, config) {
    const given = [].concat(items || []);
    const next = given.length || !spec.initial ? given : [].concat(spec.initial(this._hass, config || {}) || []);
    // unchanged items: keep the rows (and whatever field in them has the cursor)
    const key = JSON.stringify([spec.name, spec.label, next]);
    if (this._spec && key === this._key) return;
    this._key = key;
    this._spec = spec;
    this._items = next;
    this._render();
  }
  // what the list last sent: its echo back through setup() changes nothing
  _sent() { this._key = JSON.stringify([this._spec.name, this._spec.label, this._items]); }
  _emit() {
    this._sent();
    // a copy: listeners keep what they were given, later edits don't rewrite it
    this.dispatchEvent(new CustomEvent("list-changed", { detail: { items: [...this._items] }, bubbles: true, composed: true }));
    this._render();
  }
  _summary(item) {
    if (this._spec.summary) return this._spec.summary(item, this._hass);
    const o = typeof item === "string" ? { entity: item } : item;
    const st = o.entity && this._hass?.states[o.entity];
    return { title: o.name || st?.attributes.friendly_name || o.entity || o.navigation_path || "Item", sub: o.entity || "" };
  }
  _render() {
    const root = this.shadowRoot, spec = this._spec;
    if (!spec) return;
    root.innerHTML = `<style>${EDITOR_CSS}</style>
      <div class="sv-section">
        <div class="sv-label"></div>${spec.helper ? '<div class="sv-help"></div>' : ""}
        <div class="sv-list"></div>
        <div class="sv-add"></div>
      </div>`;
    root.querySelector(".sv-label").textContent = spec.label || title(spec.name);
    if (spec.helper) root.querySelector(".sv-help").textContent = spec.helper;
    const list = root.querySelector(".sv-list");
    if (!this._items.length) {
      const e = document.createElement("div");
      e.className = "sv-empty";
      e.textContent = spec.empty || "Nothing added.";
      list.appendChild(e);
    }
    this._items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "sv-item";
      const s = this._summary(item);
      row.innerHTML = `<div class="sv-item-head"><span class="t"></span>
        <button class="sv-ibtn" data-a="up" aria-label="Move up"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
        <button class="sv-ibtn" data-a="down" aria-label="Move down"><ha-icon icon="mdi:arrow-down"></ha-icon></button>
        ${spec.item ? '<button class="sv-ibtn" data-a="edit" aria-label="Edit"><ha-icon icon="mdi:pencil"></ha-icon></button>' : ""}
        <button class="sv-ibtn" data-a="remove" aria-label="Remove"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
      const t = row.querySelector(".t");
      t.textContent = s.title;
      if (s.sub && s.sub !== s.title) { const sm = document.createElement("small"); sm.textContent = s.sub; t.appendChild(sm); }
      row.querySelector('[data-a="up"]').disabled = i === 0;
      row.querySelector('[data-a="down"]').disabled = i === this._items.length - 1;
      row.querySelector(".sv-item-head").addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (!a) return;
        if (a === "up" && i > 0) [this._items[i - 1], this._items[i]] = [this._items[i], this._items[i - 1]];
        else if (a === "down" && i < this._items.length - 1) [this._items[i + 1], this._items[i]] = [this._items[i], this._items[i + 1]];
        else if (a === "remove") { this._items.splice(i, 1); if (this._openIdx === i) this._openIdx = -1; }
        else if (a === "edit") { this._openIdx = this._openIdx === i ? -1 : i; this._render(); return; }
        this._emit();
      });
      if (spec.item && this._openIdx === i) {
        const body = document.createElement("div");
        body.className = "sv-item-body";
        const form = document.createElement("ha-form");
        const obj = typeof item === "string" ? { entity: item } : item;
        form.schema = spec.item;
        form.data = obj;
        form.hass = this._hass;
        form.computeLabel = (sch) => sch.label || title(sch.name);
        form.addEventListener("value-changed", (e) => {
          e.stopPropagation();
          this._items[i] = cleanConfig(e.detail.value);
          this._sent();
          this.dispatchEvent(new CustomEvent("list-changed", { detail: { items: [...this._items] }, bubbles: true, composed: true }));
        });
        body.appendChild(form);
        row.appendChild(body);
      }
      list.appendChild(row);
    });
    // add: an entity picker (or whatever selector the spec asks for)
    const add = root.querySelector(".sv-add");
    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.selector = spec.add?.selector || { entity: {} };
    picker.label = spec.add?.label || "Add";
    picker.value = "";
    picker.addEventListener("value-changed", (e) => {
      const v = e.detail.value;
      if (!v) return;
      this._items.push(spec.add?.make ? spec.add.make(v) : (spec.item ? { entity: v } : v));
      this._emit();
    });
    add.appendChild(picker);
  }
}
if (!customElements.get("savvy-list-editor")) customElements.define("savvy-list-editor", SavvyListEditor);

// Defines `<type>-editor` for a card from a schema function.
// the cards with a state they can glow in (the shared option, last in their form)
const GLOW_CARDS = new Set(["savvy-lights-card", "savvy-climate-card", "savvy-media-card", "savvy-vacuum-card", "savvy-entity-card", "savvy-lock-card",
  "savvy-room-tile", "savvy-room-activity-card", "savvy-system-health-card"]);
const GLOW_FIELD = { name: "state_glow", label: "State glow", helper: "A soft glow in the card's corner in what it is doing. Off keeps the card plain.", selector: { boolean: {} }, default: true };

const defineEditor = (type, schemaFn, tidy) => {
  const name = `${type}-editor`;
  if (!customElements.get(name)) {
    customElements.define(name, class extends SavvyEditor {
      get cardType() { return type; }
      schema(hass, config) { const s = schemaFn(hass, config); return GLOW_CARDS.has(type) ? [...s, GLOW_FIELD] : s; }
      tidy(config) { return tidy ? tidy(config) : config; }
    });
  }
  return name;
};

// Schema snippets every card reuses.
const S = {
  area: (name = "area", label = "Area") => ({ name, label, selector: { area: {} } }),
  entity: (name, label, domain, extra = {}) => ({ name, label, selector: { entity: domain ? { domain } : {} }, ...extra }),
  bool: (name, label, helper, dflt) => ({ name, label, helper, selector: { boolean: {} }, ...(dflt !== undefined ? { default: dflt } : {}) }),
  text: (name, label, helper) => ({ name, label, helper, selector: { text: {} } }),
  icon: (name = "icon", label = "Icon") => ({ name, label, selector: { icon: {} } }),
  number: (name, label, min, max, step = 1, unit) => ({ name, label, selector: { number: { min, max, step, mode: "box", unit_of_measurement: unit } } }),
  select: (name, label, options) => ({ name, label, selector: { select: { mode: "dropdown", options } } }),
  action: (name, label, helper) => ({ name, label, ...(helper ? { helper } : {}), selector: { ui_action: {} } }),
  // HA's own page picker: every dashboard and view, or a path typed in
  nav: (name, label, helper) => ({ name, label, helper, selector: { navigation: {} } }),
  color: (name = "color", label = "Colour") => ({ name, label, selector: { text: {} }, helper: "An HA colour name (blue, amber…) or a hex like #F5B83D" }),
  grid: (...schema) => ({ type: "grid", name: "", schema }),
  section: (label, schema, expanded = false) => ({ type: "expandable", name: "", title: label, expanded, schema }),
  // the one chip spec, as a list editor
  chips: (name = "chips", label = "Custom chips", helper = "Extra entities shown as chips, each with its own actions.") => ({
    name, label, helper, type: "list",
    item: [
      { name: "entity", label: "Entity", selector: { entity: {} } },
      { type: "grid", name: "", schema: [
        { name: "name", label: "Name", selector: { text: {} } },
        { name: "icon", label: "Icon", selector: { icon: {} } },
      ] },
      { name: "color", label: "Colour", selector: { text: {} } },
      { name: "show_state", label: "Show state", selector: { boolean: {} } },
      { name: "tap_action", label: "Tap action", selector: { ui_action: {} } },
      { name: "hold_action", label: "Hold action", selector: { ui_action: {} } },
    ],
  }),
};

// The control's options: the entity, then an icon and a colour for each of its options
// (found from the mode dictionary until set).
const modeSchema = (hass, c, { helper, actions = true } = {}) => {
  const id = controlOf(c).entity;
  const opts = (hass && id && hass.states[id]?.attributes.options) || [];
  return [
    { name: "control", label: "Control", helper: helper || "A select (a house mode, a room's scenes) opens a picker. A button, script or scene runs, a switch toggles, anything else opens more-info.",
      selector: { entity: {} } },
    { name: "mode_label", label: "Caption", helper: "Under a select's value.", selector: { text: {} } },
    ...(actions ? [{ type: "expandable", name: "", title: "Control actions", schema: [
      S.action("control_tap_action", "Tap action"), S.action("control_hold_action", "Hold action"), S.action("control_double_tap_action", "Double tap action"),
    ] }] : []),
    ...(opts.length ? [
      { type: "expandable", name: "mode_icons", title: "Option icons", schema: opts.map((o) => ({ name: o, label: o, selector: { icon: { placeholder: modeLook(o).icon } } })) },
      { type: "expandable", name: "mode_colors", title: "Option colours", schema: opts.map((o) => ({ name: o, label: o, helper: modeLook(o).color || "No colour", selector: { text: {} } })) },
    ] : []),
  ];
};

// The badge row: pinned entities, then what the area has.
const badgeSchema = ({ pinnedLabel = "Pinned", pinnedHelp = "Always shown, first and in this order: a lights helper, presence, a door." } = {}) => [
  S.chips("entities", pinnedLabel, pinnedHelp),
  S.bool("auto_discover", "Auto discover", "Presence and doors always; media, locks, climate, fans, covers, windows, leaks and alarms while active.", true),
  { name: "exclude_kinds", label: "Hide kinds", selector: { select: { multiple: true, options: BADGE_KINDS.map((k) => ({ value: k.key, label: k.name })) } } },
  { name: "include", label: "Include", helper: "Entities to treat as if they were in this area (a lock with no area).", selector: { entity: { multiple: true } } },
  { name: "exclude", label: "Exclude", selector: { entity: { multiple: true } } },
];
