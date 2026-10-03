// The Savvy settings card: its status line and compact layout, its editor (every option, the rooms
// list over a map, "Add every room"), and the "From Savvy settings" block every other editor shows.
import { openPage, idle } from "./_util.mjs";

const SETTINGS = {
  pages: { home: "/lovelace/home", lights: "/lovelace/lights", room: "/lovelace/{slug}" },
  house: { control: "input_select.house_mode", tap: "navigate" },
  rooms: { kitchen: { name: "Cook", control: "input_select.kitchen_mode", light_state: "input_boolean.kitchen_light", temperature: "sensor.kitchen_t", page: "/lovelace/kitchen-x" } },
};

const WANT = ["layout", "home", "lights", "climate", "media", "security", "health", "room", "control", "weather", "tap", "watchman", "battery_threshold", "warn_above",
  "exclude_platforms", "group_by", "group_min", "watchman_last_run", "entities", "areas", "devices", "aggregate"];
const NAV = ["home", "lights", "climate", "media", "security", "health"];

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 520], ["light", 340]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(() => { history.replaceState({}, "", "/lovelace/home"); window.__savvy.SettingsStore._sync(); });

    // ---- the card: status, compact, several
    const r = await page.evaluate(async ({ width }) => {
      const SS = window.__savvy.SettingsStore;
      const empty = window.mount("savvy-settings-card", {}, width);
      await new Promise((res) => setTimeout(res, 100));
      const none = empty.shadowRoot.querySelector("#sub").textContent;
      empty.remove(); window.cards.length = 0;
      const s = window.mount("savvy-settings-card", { pages: { lights: "/l", room: "/lovelace/{slug}" }, house: { control: "input_select.house_mode" } }, width);
      window.mount("savvy-home-header-card", {}, width);
      window.mount("savvy-section-title-card", { area: "kitchen" }, width);   // takes its page from the room pattern
      window.mount("savvy-entity-card", { entity: "person.alex" }, width);
      await new Promise((res) => setTimeout(res, 500));
      const used = s.shadowRoot.querySelector("#sub").textContent;
      const label = s.shadowRoot.querySelector("ha-card").getAttribute("aria-label");
      const full = s.getBoundingClientRect().height;
      s.setConfig({ layout: "compact", pages: { lights: "/l", room: "/lovelace/{slug}" }, house: { control: "input_select.house_mode" } });
      await new Promise((res) => setTimeout(res, 100));
      const compact = { h: s.getBoundingClientRect().height, attr: s.hasAttribute("compact") };
      SS.found = 2; SS._emit();
      await new Promise((res) => setTimeout(res, 50));
      const many = { text: s.shadowRoot.querySelector("#sub").textContent, warn: s.shadowRoot.querySelector("#disc").hasAttribute("data-warn") };
      return { none, used, label, full, compact, many };
    }, { width });
    check(`${tag} the card says when nothing is set`, r.none === "No defaults set yet", r.none);
    check(`${tag} the card counts defaults and the cards using them`, r.used === "3 defaults · used by 2 cards on this page" && /Savvy settings, 3 defaults/.test(r.label), JSON.stringify(r));
    check(`${tag} compact is one short row`, r.compact.attr && r.compact.h < r.full - 4 && r.compact.h < 60, JSON.stringify([r.full, r.compact]));
    check(`${tag} several settings cards: a warning, naming the first as the one used`, /2 settings cards found: using the first/.test(r.many.text) && r.many.warn, JSON.stringify(r.many));

    // ---- the editor
    const e = await page.evaluate(async () => {
      const ed = document.createElement("savvy-settings-card-editor");
      document.body.appendChild(ed);
      window.sent = [];
      ed.addEventListener("config-changed", (ev) => window.sent.push(ev.detail.config));
      ed.setConfig({ type: "custom:savvy-settings-card", pages: { lights: "/l" }, rooms: { kitchen: { name: "Cook", page: "/k" } } });
      ed.hass = window.hass;
      await new Promise((res) => setTimeout(res, 100));
      window.ed = ed;
      const fields = [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => ({ name: f.dataset.name, sel: f.dataset.selector }));
      const list = ed.shadowRoot.querySelector('savvy-list-editor[data-key="list:rooms_list"]');
      return { fields, list: !!list, rows: [...list.shadowRoot.querySelectorAll(".sv-item .t")].map((t) => t.textContent), btn: !!ed.shadowRoot.querySelector(".sv-prefill:not([data-for])") };
    });
    const names = e.fields.map((f) => f.name);
    check(`${tag} every option is in the editor`, WANT.every((w) => names.includes(w)), `missing ${WANT.filter((w) => !names.includes(w)).join(", ")}`);
    check(`${tag} pages use HA's page picker`, NAV.every((n) => e.fields.find((f) => f.name === n)?.sel === "navigation"), JSON.stringify(e.fields.filter((f) => NAV.includes(f.name))));
    check(`${tag} the rooms are a list: one row for the one room, by its name`, e.list && e.rows.length === 1 && /Cook/.test(e.rows[0]), JSON.stringify(e.rows));
    check(`${tag} the editor offers every room`, e.btn);

    const edit = await page.evaluate(async () => {
      const ed = window.ed, list = ed.shadowRoot.querySelector('savvy-list-editor[data-key="list:rooms_list"]');
      const node = list;
      node.dispatchEvent(new CustomEvent("list-changed", { detail: { items: [{ area: "kitchen", name: "Cook2" }, { area: "bedroom", light_state: "input_boolean.bed" }] }, bubbles: true, composed: true }));
      await new Promise((res) => setTimeout(res, 50));
      const sent = window.sent.at(-1);
      // HA answers with setConfig: the list keeps its rows
      ed.setConfig(sent);
      await new Promise((res) => setTimeout(res, 50));
      const same = ed.shadowRoot.querySelector('savvy-list-editor[data-key="list:rooms_list"]') === list;
      // a scalar edit keeps the rooms
      const form = ed.shadowRoot.querySelector("ha-form");
      form.set("layout", "compact");
      await new Promise((res) => setTimeout(res, 50));
      const after = window.sent.at(-1);
      return { sent, same, after };
    });
    check(`${tag} the rooms list writes a map by area, without the helper key`,
      JSON.stringify(edit.sent.rooms) === '{"kitchen":{"name":"Cook2"},"bedroom":{"light_state":"input_boolean.bed"}}' && !("rooms_list" in edit.sent), JSON.stringify(edit.sent));
    check(`${tag} HA's echo doesn't rebuild the list`, edit.same);
    check(`${tag} another edit keeps the rooms`, edit.after.layout === "compact" && Object.keys(edit.after.rooms).length === 2 && !("rooms_list" in edit.after), JSON.stringify(edit.after));

    const add = await page.evaluate(async () => {
      const ed = window.ed;
      ed.shadowRoot.querySelector(".sv-prefill:not([data-for])").click();
      await new Promise((res) => setTimeout(res, 60));
      const sent = window.sent.at(-1);
      ed.shadowRoot.querySelector(".sv-prefill:not([data-for])").click();
      await new Promise((res) => setTimeout(res, 60));
      return { rooms: Object.keys(sent.rooms), again: Object.keys(window.sent.at(-1).rooms).length, kept: sent.rooms.kitchen?.name };
    });
    check(`${tag} Add every room: one entry per area, existing ones kept, a second press adds nothing`,
      add.rooms.length === 7 && add.kept === "Cook2" && add.again === 7, JSON.stringify(add));
    await page.evaluate(() => window.ed.remove());

    // ---- "From Savvy settings" in the other editors
    const inh = await page.evaluate(async ({ SETTINGS }) => {
      const SS = window.__savvy.SettingsStore;
      SS._sync();
      SS.set(null);
      const out = {};
      const show = async (type, cfg) => {
        const ed = document.createElement(`${type}-editor`);
        document.body.appendChild(ed);
        ed.setConfig({ type: `custom:${type}`, ...cfg });
        ed.hass = window.hass;
        await new Promise((res) => setTimeout(res, 60));
        const box = ed.shadowRoot.querySelector(".sv-inherit");
        const info = box ? { text: box.textContent, first: ed.shadowRoot.querySelector(".sv-ed").firstElementChild === box } : null;
        return { ed, info };
      };
      const none = await show("savvy-section-title-card", { area: "kitchen" });
      out.noSettings = none.info;
      SS.set(SETTINGS);
      await new Promise((res) => setTimeout(res, 60));
      out.live = none.ed.shadowRoot.querySelector(".sv-inherit")?.textContent || null;
      out.first = none.ed.shadowRoot.querySelector(".sv-ed").firstElementChild.className;
      none.ed.remove();
      for (const [type, cfg] of [["savvy-home-header-card", {}], ["savvy-room-tile", { area: "kitchen" }], ["savvy-lights-card", { area: "kitchen" }], ["savvy-room-header-card", { area: "kitchen" }]]) {
        out[type] = (await show(type, cfg)).info?.text || null;
      }
      const own = await show("savvy-section-title-card", { area: "kitchen", name: "Mine", icon: "mdi:x", control: false, temperature: "sensor.x", navigation_path: "/x", entities: false, include: false, exclude: false });
      out.allOwn = own.info;
      own.ed.remove();
      const cardless = await show("savvy-entity-card", { entity: "person.alex" });
      out.entity = cardless.info;
      return out;
    }, { SETTINGS });
    check(`${tag} no settings: no block`, inh.noSettings === null);
    check(`${tag} settings arriving show the block at once, at the top`, /From Savvy settings/.test(inh.live) && /Cook/.test(inh.live) && /rooms\.kitchen/.test(inh.live) && inh.first === "sv-inherit", JSON.stringify(inh.live));
    check(`${tag} the home header editor lists what it takes`, /Control/.test(inh["savvy-home-header-card"]) && /Lights page/.test(inh["savvy-home-header-card"]), String(inh["savvy-home-header-card"]).slice(0, 200));
    check(`${tag} tile, lights and room header editors list theirs`, /Light helper/.test(inh["savvy-room-tile"]) && /Light helper/.test(inh["savvy-lights-card"]) && /Temperature/.test(inh["savvy-room-header-card"]));
    check(`${tag} a card that sets everything itself shows no block; one without rules never does`, inh.allOwn === null && inh.entity === null, JSON.stringify([inh.allOwn, inh.entity]));

    check(`${tag} springs idle`, await idle(page));
    const real = errors.filter((x) => !/Failed to load resource|callWS not implemented/.test(x));
    check(`${tag} no errors`, real.length === 0, real.join(" | "));
    await page.close();
  }
}
