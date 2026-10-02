// savvy-system-health-card on the made-up house.
import { openPage, idle, shot } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [420, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
      const all = window.mount("savvy-system-health-card", {}, width);
      const withW = window.mount("savvy-system-health-card", { watchman: W, title: "House health" }, width);
      const batt = window.mount("savvy-system-health-card", { source: "battery", battery_threshold: 20 }, width);
      const legacy = window.mount("savvy-system-health-card", { source: "watchman", entities: W,
        action: { label: "Generate report", service: "watchman.report", data: { create_file: true } } }, width);
      await new Promise((res) => setTimeout(res, 400));
      const read = (el) => ({ pill: el.shadowRoot.getElementById("pill").textContent, name: el.shadowRoot.getElementById("name").textContent,
        groups: [...el.shadowRoot.querySelectorAll(".group, .rows .ok")].map((g) => g.classList.contains("ok") ? `✓ ${g.textContent.trim()}`
          : `${g.querySelector(".gt").textContent}${g.querySelector(".gw").textContent ? " | " + g.querySelector(".gw").textContent : ""}`),
        when: el.shadowRoot.getElementById("when").hidden ? "" : el.shadowRoot.getElementById("when").textContent,
        rows: [...el.shadowRoot.querySelectorAll(".row .n")].map((n) => n.textContent) });
      const core = window.__savvy.healthSummary(window.hass, { watchman: W });
      return { all: read(all), withW: read(withW), batt: read(batt), legacy: read(legacy), coreTotal: core.total };
    }, width);
    check(`${tag} default lists everything, in sections that say what's wrong`, r.all.pill === "3 issues" && r.all.name === "Health"
      && JSON.stringify(r.all.groups) === JSON.stringify(["Offline devices | 2 entities offline", "Low batteries | 1 battery low"]), JSON.stringify(r.all));
    check(`${tag} with Watchman: every category, named for what it is`,
      JSON.stringify(r.withW.groups) === JSON.stringify(["Watchman | 2 missing entities, 1 missing action", "Offline devices | 2 entities offline", "Low batteries | 1 battery low"]), JSON.stringify(r.withW.groups));
    check(`${tag} Watchman source: last check under the title`, r.legacy.when === "Checked 2 h ago", r.legacy.when);
    check(`${tag} with Watchman the pill equals the core total the home cog uses`, r.withW.pill === `${r.coreTotal} issues` && r.withW.groups[0].startsWith("Watchman"), JSON.stringify(r.withW));
    check(`${tag} battery source: low first, the rest dimmed, phone excluded`, r.batt.pill === "1 low"
      && JSON.stringify(r.batt.rows) === JSON.stringify(["Front Door Battery", "Motion Sensor Battery", "Remote Battery", "Robot Battery"]), JSON.stringify(r.batt));
    check(`${tag} the pre-Savvy watchman config still works`, r.legacy.pill === "3 issues" && r.legacy.rows.length === 3, JSON.stringify(r.legacy));

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
    const live = await page.evaluate(() => ({ pill: window.cards[0].shadowRoot.getElementById("pill").textContent,
      groups: [...window.cards[0].shadowRoot.querySelectorAll(".group, .rows .ok")].map((g) => g.classList.contains("ok") ? `✓ ${g.textContent.trim()}`
        : `${g.querySelector(".gt").textContent}${g.querySelector(".gw").textContent ? " | " + g.querySelector(".gw").textContent : ""}`) }));
    check(`${tag} counts follow the house live; a healthy category stays, with a tick and what's fine below its title`, live.pill === "1 issue"
      && JSON.stringify(live.groups) === JSON.stringify(["Offline devices | 1 entity offline", "Low batteries", "✓ All batteries fine"]), JSON.stringify(live));

    if (width === 420) await shot(page, `health-${theme}`, 0);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // editor: every option is there
  const { page } = await openPage(browser, base, {});
  const fields = await page.evaluate(async () => {
    const ed = document.createElement("savvy-system-health-card-editor");
    document.body.appendChild(ed);
    ed.setConfig({ type: "custom:savvy-system-health-card", source: "battery" });
    ed.hass = window.hass;
    await new Promise((r) => setTimeout(r, 50));
    return [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
  });
  const want = ["source", "title", "battery_threshold", "warn_above", "max_rows", "columns", "details", "group_by", "group_min", "exclude_platforms", "watchman", "watchman_last_run", "show_all_batteries", "label", "tap_action"];
  check("editor exposes every option", want.every((w) => fields.includes(w)), JSON.stringify(fields));
  await page.close();
}
