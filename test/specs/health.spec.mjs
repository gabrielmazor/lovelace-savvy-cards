// savvy-health-card on the made-up house.
import { openPage, idle, shot } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
      const all = window.mount("savvy-health-card", {}, width);
      const withW = window.mount("savvy-health-card", { watchman: W, title: "House health" }, width);
      const batt = window.mount("savvy-health-card", { source: "battery", battery_threshold: 20 }, width);
      const legacy = window.mount("savvy-health-card", { source: "watchman", entities: W,
        action: { label: "Generate report", service: "watchman.report", data: { create_file: true } } }, width);
      await new Promise((res) => setTimeout(res, 400));
      const read = (el) => ({ pill: el.shadowRoot.getElementById("pill").textContent, name: el.shadowRoot.getElementById("name").textContent,
        groups: [...el.shadowRoot.querySelectorAll(".group")].map((g) => g.textContent),
        rows: [...el.shadowRoot.querySelectorAll(".row .n")].map((n) => n.textContent) });
      const core = window.__savvy.healthSummary(window.hass, { watchman: W });
      return { all: read(all), withW: read(withW), batt: read(batt), legacy: read(legacy), coreTotal: core.total };
    }, width);
    check(`${tag} default lists everything, grouped`, r.all.pill === "3 ISSUES" && r.all.name === "Health"
      && JSON.stringify(r.all.groups) === JSON.stringify(["Unavailable · 2", "Low batteries · 1"]), JSON.stringify(r.all));
    check(`${tag} with Watchman the pill equals the core total the home cog uses`, r.withW.pill === `${r.coreTotal} ISSUES` && r.withW.groups[0] === "Watchman · 3", JSON.stringify(r.withW));
    check(`${tag} battery source: low first, the rest dimmed, phone excluded`, r.batt.pill === "1 LOW"
      && JSON.stringify(r.batt.rows) === JSON.stringify(["Front Door Battery", "Motion Sensor Battery", "Remote Battery", "Robot Battery"]), JSON.stringify(r.batt));
    check(`${tag} the pre-Savvy watchman config still works`, r.legacy.pill === "3 ISSUES" && r.legacy.rows.length === 3, JSON.stringify(r.legacy));

    // row tap -> more-info; footer button -> its action
    await page.evaluate(() => { window.moreInfo = []; document.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId)); window.log.length = 0; });
    const rowBox = await page.evaluate(() => { const r = window.cards[2].shadowRoot.querySelector(".row[role=button]").getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
    await page.mouse.click(rowBox.x, rowBox.y);
    const btn = await page.evaluate(() => { const r = window.cards[3].shadowRoot.getElementById("action").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(btn.x, btn.y);
    await page.waitForTimeout(150);
    const acted = await page.evaluate(() => ({ info: window.moreInfo, log: [...window.log] }));
    check(`${tag} row tap opens more-info; footer button runs its action`, acted.info[0] === "sensor.front_door_battery"
      && /^watchman\.report \{"create_file":true\}/.test(acted.log[0] || ""), JSON.stringify(acted));

    // live: a battery recovers and a device comes back
    await page.evaluate(() => window.setStates({ "sensor.front_door_battery": "80", "light.hallway_broken": "off" }));
    await page.waitForTimeout(300);
    const live = await page.evaluate(() => window.cards[0].shadowRoot.getElementById("pill").textContent);
    check(`${tag} counts follow the house live`, live === "1 ISSUE", live);

    if (width === 420) await shot(page, `health-${theme}`, 0);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // editor: every option is there
  const { page } = await openPage(browser, base, {});
  const fields = await page.evaluate(async () => {
    const ed = document.createElement("savvy-health-card-editor");
    document.body.appendChild(ed);
    ed.setConfig({ type: "custom:savvy-health-card", source: "battery" });
    ed.hass = window.hass;
    await new Promise((r) => setTimeout(r, 50));
    return [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
  });
  const want = ["source", "title", "battery_threshold", "warn_above", "max_rows", "exclude_platforms", "watchman", "show_all_batteries", "label", "tap_action"];
  check("editor exposes every option", want.every((w) => fields.includes(w)), JSON.stringify(fields));
  await page.close();
}
