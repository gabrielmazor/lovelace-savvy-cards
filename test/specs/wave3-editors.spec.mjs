// The entity, graph, snapshot, media, camera and scene editors: every option is there; each
// card's stub config mounts; navigation fields use HA's page picker.
import { openPage } from "./_util.mjs";

const EDITORS = {
  "savvy-entity-card": { config: { entity: "person.alex" }, want: ["entity", "name", "icon", "color", "picture", "show_state", "show_since", "navigation_path", "tap_action", "hold_action", "double_tap_action"], lists: ["chips"] },
  "savvy-graph-card": { config: { entities: ["sensor.living_room_temperature"] }, want: ["title", "hours_to_show", "columns", "ranges"], lists: ["entities"] },
  "savvy-snapshot-card": { config: { area: "living_room" }, want: ["area", "name", "icon", "layout", "alarm", "navigation_path", "exclude_kinds", "exclude", "presence", "door", "window", "temperature", "humidity", "illuminance", "smoke", "gas", "co", "leak", "history"], lists: ["chips"] },
  "savvy-media-card": { config: { area: "living_room" }, want: ["area", "name", "layout", "video_output", "artwork", "volume_buttons", "volume_step", "artwork_max_height", "video", "audio", "entity", "time", "action", "data", "placeholder"], lists: ["video", "audio", "presets", "chips"] },
  "savvy-scene-card": { config: { area: "office" }, want: ["area", "title", "layout", "columns", "color", "show_icon", "strip", "navigation_path", "auto_discover", "exclude"], lists: ["entities"] },
  "savvy-camera-card": { config: { area: "living_room" }, want: ["area", "recordings", "columns", "days", "aspect_ratio", "instance"], lists: ["cameras"] },
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
      const fields = [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => ({ name: f.dataset.name, sel: f.dataset.selector }));
      const lists = [...ed.shadowRoot.querySelectorAll("savvy-list-editor")].map((l) => l.dataset.key.replace(/^list:/, ""));
      ed.remove();
      return { fields, lists };
    }, { type, config });
    const names = got.fields.map((f) => f.name);
    const missing = want.filter((w) => !names.includes(w));
    check(`${type}: every option in the editor`, !missing.length, `missing ${missing.join(", ")}`);
    check(`${type}: list editors`, lists.every((l) => got.lists.includes(l)), JSON.stringify(got.lists));
    const nav = got.fields.filter((f) => /navigation_path|home_path/.test(f.name));
    check(`${type}: navigation uses HA's page picker`, nav.every((f) => f.sel === "navigation"), JSON.stringify(nav));
  }
  const stubs = await page.evaluate(async () => {
    const out = {};
    for (const type of ["savvy-entity-card", "savvy-graph-card", "savvy-snapshot-card", "savvy-media-card", "savvy-camera-card", "savvy-scene-card"]) {
      const cfg = customElements.get(type).getStubConfig(window.hass);
      const el = window.mount(type, cfg, 400);
      await new Promise((r) => setTimeout(r, 150));
      out[type] = { cfg, h: Math.round(el.getBoundingClientRect().height) };
    }
    return out;
  });
  check("every wave-3 (and scene) card's stub config mounts with something to show", Object.values(stubs).every((s) => s.h > 20), JSON.stringify(stubs));
  const real = errors.filter((e) => !/Failed to load resource|callWS not implemented/.test(e));
  check("no errors", real.length === 0, real.join(" | "));
  await page.close();
}
