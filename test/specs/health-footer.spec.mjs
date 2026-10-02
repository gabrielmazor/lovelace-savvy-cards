// The system health card's footer button is off unless it has an action to run: no button for no
// action, an empty action, `none`, or a label alone; a button for a real action and for the pre-Savvy
// service shape. The editor never saves an empty `action`.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const [theme, width] of [["dark", 420], ["light", 320]]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const mk = (cfg) => window.mount("savvy-system-health-card", cfg, width);
      const cards = {
        none: mk({}), empty: mk({ action: {} }), tapNone: mk({ action: { tap_action: { action: "none" } } }), noneString: mk({ action: { tap_action: "none" } }),
        labelOnly: mk({ action: { label: "Go" } }),
        real: mk({ action: { label: "Turn on", tap_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: "script.good_night" } } } }),
        legacy: mk({ action: { label: "Report", service: "watchman.report", data: { create_file: true } } }),
        noLabel: mk({ action: { tap_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: "script.good_night" } } } }),
      };
      await new Promise((res) => setTimeout(res, 400));
      const btn = (el) => { const b = el.shadowRoot.getElementById("action"); return { hidden: b.hidden, text: b.textContent, shown: b.getBoundingClientRect().height > 0 }; };
      const out = Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, btn(v)]));
      window.log.length = 0;
      cards.real.shadowRoot.getElementById("action").click();
      cards.legacy.shadowRoot.getElementById("action").click();
      return { out, clicked: [...window.log].length };
    }, width);
    const hidden = (k) => r.out[k].hidden && !r.out[k].shown;
    check(`${tag} no button without an action, with an empty one, with none, or with only a label`,
      ["none", "empty", "tapNone", "noneString", "labelOnly"].every(hidden), JSON.stringify(r.out));
    check(`${tag} a real action gets its button, labelled; the default label is Run`,
      !r.out.real.hidden && r.out.real.text === "Turn on" && !r.out.noLabel.hidden && r.out.noLabel.text === "Run", JSON.stringify([r.out.real, r.out.noLabel]));
    check(`${tag} the pre-Savvy service shape still gets its button`, !r.out.legacy.hidden && r.out.legacy.text === "Report", JSON.stringify(r.out.legacy));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // the editor leaves no empty action behind
  {
    const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
    const e = await page.evaluate(async () => {
      const el = document.createElement("savvy-system-health-card-editor");
      document.body.appendChild(el);
      const changes = [];
      el.addEventListener("config-changed", (ev) => changes.push(ev.detail.config));
      el.setConfig({ type: "custom:savvy-system-health-card" });
      el.hass = window.hass;
      await new Promise((r) => setTimeout(r, 80));
      const form = () => el.shadowRoot.querySelector("ha-form");
      const last = () => changes[changes.length - 1];
      form().set("action", { tap_action: { action: "none" } });
      const afterNone = { ...last() };
      form().set("action", { label: "Go" });
      const afterLabel = { ...last() };
      form().set("action", { label: "Go", tap_action: { action: "perform-action", perform_action: "script.turn_on" } });
      const afterReal = JSON.parse(JSON.stringify(last()));
      form().set("action", { label: "Go", tap_action: { action: "none" } });
      const afterBackToNone = JSON.parse(JSON.stringify(last()));
      form().set("action", { label: "", tap_action: { action: "none" } });
      const afterCleared = { ...last() };
      const helper = JSON.stringify(el.schema(window.hass, {}).filter((f) => f.name === "action")[0]);
      return { afterNone, afterLabel, afterReal, afterBackToNone, afterCleared, helper };
    });
    check("editor: a footer touched but given no action saves no `action`", !("action" in e.afterNone) && !("action" in e.afterCleared), JSON.stringify([e.afterNone, e.afterCleared]));
    check("editor: a label alone is kept (so it can be typed first), and a real action with it", e.afterLabel.action?.label === "Go" && e.afterReal.action?.tap_action?.perform_action === "script.turn_on", JSON.stringify([e.afterLabel, e.afterReal]));
    check("editor: choosing none again drops the action but keeps the label", e.afterBackToNone.action?.label === "Go" && !e.afterBackToNone.action?.tap_action, JSON.stringify(e.afterBackToNone));
    check("editor: the section says it is off unless an action is picked", /Off unless you pick an action/.test(e.helper), e.helper);
    check("editor: no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
