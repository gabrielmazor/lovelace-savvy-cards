// The home, room, heading and tile editors: every option is in the visual editor, and the
// mode section lists the chosen entity's options.
import { openPage } from "./_util.mjs";

const EDITORS = {
  "savvy-section-title-card": { config: { area: "living_room", control: "input_select.living_room_scene" },
    want: ["area", "name", "icon", "navigation_path", "heading_style", "background", "control", "mode_label", "control_tap_action", "control_hold_action", "control_double_tap_action", "temperature", "auto_discover", "exclude_kinds", "include", "exclude", "tap_action", "hold_action",
      "Auto", "Relax", "Party"], lists: ["entities"] },
  "savvy-room-tile": { config: { area: "kitchen" },
    want: ["area", "name", "icon", "navigation_path", "control", "mode_label", "temperature", "toggle", "lights", "count", "color_lights", "tint", "auto_discover", "exclude_kinds", "include", "exclude", "tap_action", "double_tap_action", "hold_action"], lists: ["entities"] },
  "savvy-room-header-card": { config: { area: "living_room" },
    want: ["area", "control", "mode_label", "control_tap_action", "control_hold_action", "control_double_tap_action", "home_path", "temperature", "auto_discover", "exclude_kinds", "include", "exclude", "icons_only", "room_path", "exclude_rooms"], lists: ["entities", "chips", "room_order"] },
  "savvy-home-header-card": { config: { control: "input_select.house_mode" },
    want: ["control", "mode_label", "control_tap_action", "control_hold_action", "control_double_tap_action", "home_path", "weather", "navigation_path", "watchman", "battery_threshold", "warn_above", "exclude_platforms", "hide", "entity", "exclude_areas", "sort", "sort_toggle", "Home", "Movie Night"], lists: ["chips"] },
};

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, {});
  for (const [type, { config, want, lists }] of Object.entries(EDITORS)) {
    const got = await page.evaluate(async ({ type, config }) => {
      const ed = document.createElement(`${type}-editor`);
      document.body.appendChild(ed);
      ed.setConfig({ type: `custom:${type}`, ...config });
      ed.hass = window.hass;
      await new Promise((r) => setTimeout(r, 60));
      const fields = [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
      const lists = [...ed.shadowRoot.querySelectorAll("savvy-list-editor")].map((l) => l.dataset.key.replace(/^list:/, ""));
      const initial = ed.shadowRoot.querySelector('[data-key="list:room_order"]')?._items || null;
      ed.remove();
      return { fields, lists, initial };
    }, { type, config });
    const missing = want.filter((w) => !got.fields.includes(w));
    check(`${type}: every option in the editor`, !missing.length, `missing ${missing.join(", ")}`);
    check(`${type}: list editors`, lists.every((l) => got.lists.includes(l)), JSON.stringify(got.lists));
    if (type === "savvy-room-header-card") check("room card: the rooms order starts as the discovered order", JSON.stringify(got.initial) === JSON.stringify(["bedroom", "hallway", "kitchen", "office"]), JSON.stringify(got.initial));
  }
  // a mode icon picked in the editor lands under mode_icons, keyed by the option
  const icons = await page.evaluate(async () => {
    const ed = document.createElement("savvy-section-title-card-editor");
    document.body.appendChild(ed);
    let out = null;
    ed.addEventListener("config-changed", (e) => { out = e.detail.config; });
    ed.setConfig({ type: "custom:savvy-section-title-card", area: "living_room", control: "input_select.living_room_scene" });
    ed.hass = window.hass;
    await new Promise((r) => setTimeout(r, 60));
    const form = ed.shadowRoot.querySelector("ha-form");
    form.set("mode_icons", { Relax: "mdi:sofa-outline" });
    return out;
  });
  check("a mode's icon set in the editor is saved under mode_icons", icons?.mode_icons?.Relax === "mdi:sofa-outline", JSON.stringify(icons));
  // the card picker's preview: each card's stub config mounts and shows something
  const stubs = await page.evaluate(async () => {
    const out = {};
    for (const type of ["savvy-home-header-card", "savvy-room-header-card", "savvy-section-title-card", "savvy-room-tile"]) {
      const cfg = customElements.get(type).getStubConfig(window.hass);
      const el = window.mount(type, cfg, 400);
      await new Promise((r) => setTimeout(r, 100));
      out[type] = { cfg, h: Math.round(el.getBoundingClientRect().height) };
    }
    return out;
  });
  check("no stub config guesses a mode", Object.values(stubs).every((s) => !s.cfg.control), JSON.stringify(stubs));
  // with no mode chosen the editor has no mode options to show; choosing one fills them from it
  const modeFields = await page.evaluate(async () => {
    const ed = document.createElement("savvy-home-header-card-editor");
    document.body.appendChild(ed);
    const names = () => [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
    ed.setConfig({ type: "custom:savvy-home-header-card" });
    ed.hass = window.hass;
    await new Promise((r) => setTimeout(r, 60));
    const before = names();
    ed.setConfig({ type: "custom:savvy-home-header-card", control: "input_select.living_room_scene" });
    await new Promise((r) => setTimeout(r, 60));
    const after = names();
    ed.remove();
    return { before, after };
  });
  check("mode icons and colours: none until a mode is chosen, then exactly its options", !modeFields.before.some((n) => ["Home", "Away", "Relax"].includes(n))
    && ["Auto", "Relax", "Reading", "Movie", "Party"].every((o) => modeFields.after.includes(o)) && !modeFields.after.includes("Away"), JSON.stringify(modeFields));
  check("every card's stub config mounts with something to show", Object.values(stubs).every((s) => s.h > 20), JSON.stringify(stubs));
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
