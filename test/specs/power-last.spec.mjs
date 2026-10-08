// Power is always the last control of a row: the end of the line (the right in left-to-right, the
// left in right-to-left), by DOM order and by position, whichever control was built first.
import { openPage } from "./_util.mjs";

const SETUP = () => {
  const put = (id, state, attributes) => window.setStates({ [id]: { entity_id: id, state, attributes: { friendly_name: id, ...attributes } } });
  window.put = put;
  const area = (id, a) => { window.house.entities[id] = { entity_id: id, area_id: a, device_id: null, platform: "demo", entity_category: null, hidden: false, disabled_by: null }; };
  // players: power only at first; everything later (the order they appear in must not matter)
  put("media_player.pw_tv", "playing", { supported_features: 384, media_title: "A Show" });
  put("media_player.pw_spk", "playing", { supported_features: 384, volume_level: 0.3, media_title: "A Song" });
  put("media_player.pw_full", "playing", { supported_features: 21437, volume_level: 0.3, media_title: "Whole", is_volume_muted: false });
  put("media_player.pw_off", "off", { supported_features: 21437 });
  put("climate.pw_ac", "cool", { hvac_modes: ["off", "cool", "heat", "fan_only", "dry", "auto"], min_temp: 16, max_temp: 30, temperature: 22, current_temperature: 23 });
  put("climate.pw_off", "off", { hvac_modes: ["off", "cool", "heat"], min_temp: 16, max_temp: 30, temperature: 22, current_temperature: 23 });
  put("light.pw_one", "on", { brightness: 128, supported_color_modes: ["brightness"] });
  put("light.pw_two", "on", { brightness: 200, supported_color_modes: ["brightness"] });
  for (const id of ["light.pw_one", "light.pw_two"]) area(id, "pw_room");
  window.hass = { ...window.hass, states: { ...window.house.states }, entities: { ...window.house.entities } };
};

// the visible controls under a root, in DOM order, with where they sit
const READ = (root, selector, powerSel) => {
  const vis = (e) => !e.hidden && e.getClientRects().length > 0;
  const els = [...root.querySelectorAll(selector)].filter(vis);
  const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; };
  const power = els.filter((e) => e.matches(powerSel));
  return { n: els.length, powers: power.length, last: els.length > 0 && power.length > 0 && els[els.length - 1] === power[0],
    edge: power.length > 0 && els.every((e) => e === power[0] || (document.documentElement.dir === "rtl" ? rect(power[0]).l <= rect(e).l + 0.5 : rect(power[0]).r >= rect(e).r - 0.5)),
    labels: els.map((e) => e.dataset.k || e.getAttribute("aria-label") || e.dataset.v || e.textContent.trim()) };
};

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 340]) for (const dir of ["ltr", "rtl"]) {
    const tag = `[${theme} ${width} ${dir}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate((dir) => document.documentElement.setAttribute("dir", dir), dir);
    await page.evaluate(SETUP);

    // 1) the media card: a player whose power came first, the rest later
    const m = await page.evaluate(async ({ READ, width }) => {
      const read = new Function("root", "selector", "powerSel", `return (${READ})(root, selector, powerSel)`);
      window.mount("savvy-media-card", { name: "Full", video: [{ entity: "media_player.pw_tv" }], audio: [{ entity: "media_player.pw_spk" }] }, width);
      window.mount("savvy-media-card", { name: "Compact", layout: "compact", video: [{ entity: "media_player.pw_tv" }], audio: [{ entity: "media_player.pw_spk" }] }, width);
      await new Promise((res) => setTimeout(res, 500));
      const before = window.cards.map((c) => read(c.shadowRoot, "#nowTransport .tb", '[data-k="power"]'));
      window.put("media_player.pw_tv", "playing", { supported_features: 384 + 1 + 16 + 32, media_title: "A Show" });
      window.put("media_player.pw_spk", "playing", { supported_features: 384 + 1 + 16 + 32, volume_level: 0.3, media_title: "A Song" });
      await new Promise((res) => setTimeout(res, 500));
      const now = (c) => [read(c.shadowRoot, "#nowTransport .tb", '[data-k="power"]'), ...[...c.shadowRoot.querySelectorAll("#audioBand .player")].map((p) => read(p, ".transport .tb", '[data-k="power"]'))];
      return { before: before.map((b) => b.labels), after: window.cards.map(now) };
    }, { READ: READ.toString(), width });
    check(`${tag} media card: power alone at first`, m.before.every((b) => JSON.stringify(b) === '["power"]'), JSON.stringify(m.before));
    check(`${tag} media card, full and compact: prev, play, next, then power, last by order and by position`,
      m.after.every((rows) => rows.every((r) => r.last && r.edge && JSON.stringify(r.labels.filter((l) => l !== "power")) === JSON.stringify(["prev", "play", "next"]) || (r.labels.length === 0))) && m.after.some((rows) => rows.some((r) => r.labels.length === 4)), JSON.stringify(m.after));

    // 2) popups: the media row's extra line, a climate row's modes, the toolbar
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.attachShadow({ mode: "open" }).innerHTML = "<button id=o>open</button>";
      document.body.appendChild(host);
      window.list = new window.__savvy.EntityListSheet(host, { title: "Popup" });
      window.list.show(window.hass, ["media_player.pw_full", "media_player.pw_off", "climate.pw_ac", "climate.pw_off", "light.pw_one", "light.pw_two"], host.shadowRoot.getElementById("o"),
        { sort: "room", bulk: "lights", storeKey: "pw" });
    });
    await page.waitForTimeout(400);
    const chev = async (id) => {
      const at = await page.evaluate((id) => { const r = window.__savvy.portalRoot().querySelector(`.sv-row[data-id="${id}"] .sv-chev`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, id);
      await page.mouse.click(...at);
      await page.waitForTimeout(450);
    };
    await chev("media_player.pw_full");
    await chev("climate.pw_ac");
    const p = await page.evaluate(({ READ }) => {
      const read = new Function("root", "selector", "powerSel", `return (${READ})(root, selector, powerSel)`);
      const root = window.__savvy.portalRoot();
      const out = {};
      out.media = read(root.querySelector('.sv-row[data-id="media_player.pw_full"]'), ".sv-xline button", '[aria-label="Power"]');
      out.mediaMain = read(root.querySelector('.sv-row[data-id="media_player.pw_off"]'), ".sv-act-in button", '[aria-label="Power"]');
      out.climate = [...root.querySelectorAll('.sv-row[data-id="climate.pw_ac"] .sv-ctl-climate .sv-seg-b')].filter((b) => b.getClientRects().length).map((b) => b.dataset.v);
      out.climateOff = [...root.querySelectorAll('.sv-row[data-id="climate.pw_off"] .sv-act-in button')].filter((b) => b.getClientRects().length).map((b) => b.getAttribute("aria-label"));
      const tools = [...root.querySelectorAll(".sv-tools > *")].filter((e) => !e.hidden && e.getClientRects().length);
      const rs = tools.map((e) => e.getBoundingClientRect());
      out.tools = { classes: tools.map((e) => e.className), bulkLast: tools[tools.length - 1]?.className.includes("sv-bulk"),
        edge: document.documentElement.dir === "rtl" ? rs[rs.length - 1].left <= rs[0].left + 0.5 : rs[rs.length - 1].right >= rs[0].right - 0.5 };
      return out;
    }, { READ: READ.toString() });
    check(`${tag} popup media row: previous, next, mute, volume, then power, last by order and by position`, p.media.last && p.media.edge && p.media.powers === 1 && p.media.labels[0] === "Previous", JSON.stringify(p.media));
    check(`${tag} popup media row that is off: power alone on the line`, p.mediaMain.n === 1 && p.mediaMain.powers === 1, JSON.stringify(p.mediaMain));
    check(`${tag} popup climate modes: Off comes last`, p.climate.length > 1 && p.climate[p.climate.length - 1] === "off" && p.climate[0] === "cool", JSON.stringify(p.climate));
    check(`${tag} popup climate that is off: power on the line`, p.climateOff.includes("Turn on") && p.climateOff[p.climateOff.length - 1] === "Turn on", JSON.stringify(p.climateOff));
    check(`${tag} popup toolbar: the bulk action is last`, p.tools.bulkLast && p.tools.edge, JSON.stringify(p.tools));

    // 3) the climate card: the unit's own modes with Off last; your own hvac_modes keep your order; the header's power is the end
    const c = await page.evaluate(async ({ width }) => {
      window.cards.length = 0;
      document.getElementById("stage").replaceChildren();
      window.mount("savvy-climate-card", { entity: "climate.pw_off" }, width);
      window.mount("savvy-climate-card", { entity: "climate.pw_off", hvac_modes: ["off", "cool", "heat"] }, width);
      await new Promise((res) => setTimeout(res, 500));
      const labels = (c) => [...c.shadowRoot.querySelectorAll(".modes .seg")].map((s) => s.querySelector("span").textContent.toLowerCase());
      const header = (c) => { const h = c.shadowRoot.querySelector("header"); const kids = [...h.children]; return kids[kids.length - 1].id === "power"; };
      return { own: labels(window.cards[0]), set: labels(window.cards[1]), header: window.cards.map(header) };
    }, { width });
    check(`${tag} climate card: the unit's modes put Off last; an explicit hvac_modes is kept as written; the header's power is last`,
      JSON.stringify(c.own) === '["cool","heat","off"]' && JSON.stringify(c.set) === '["off","cool","heat"]' && c.header.every(Boolean), JSON.stringify(c));

    // 4) the lights card: the power button ends each light's line
    const l = await page.evaluate(async ({ READ, width }) => {
      const read = new Function("root", "selector", "powerSel", `return (${READ})(root, selector, powerSel)`);
      window.cards.length = 0;
      document.getElementById("stage").replaceChildren();
      window.mount("savvy-lights-card", { lights: ["light.pw_one", "light.pw_two"], power_button: true }, width);
      await new Promise((res) => setTimeout(res, 500));
      // the row is the light's line: its last control must be the power button
      return [...window.cards[0].shadowRoot.querySelectorAll(".light")].map((h) => read(h, "button", ".power"));
    }, { READ: READ.toString(), width });
    check(`${tag} lights card: the power button is the last control of each light`, l.length === 2 && l.every((r) => r.powers === 1 && r.last && r.edge), JSON.stringify(l));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
