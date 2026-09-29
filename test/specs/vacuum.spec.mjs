// savvy-vacuum-card on the made-up house's robot.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [480, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate(() => {
      // rooms come from the vacuum's registry options (its area mapping)
      window.hass.callWS = async (m) => {
        if (m.type === "config/entity_registry/get") return { entity_id: m.entity_id, options: { vacuum: { area_mapping: { living_room: ["16"], kitchen: ["17"], bedroom: ["18"] } } } };
        if (m.type === "vacuum/get_segments") return { segments: [] };
        throw new Error("unmocked " + m.type);
      };
    });
    const r = await page.evaluate(async (width) => {
      const full = window.mount("savvy-vacuum-card", { entity: "vacuum.robot", start: "button.robot_vacuum" }, width);
      const compact = window.mount("savvy-vacuum-card", { entity: "vacuum.robot", layout: "compact" }, width);
      const legacy = window.mount("savvy-vacuum-card", { entity: "vacuum.robot", compact: true, rooms: "off" }, width);
      await new Promise((res) => setTimeout(res, 700));
      const txt = (el) => el.shadowRoot.textContent.replace(/\s+/g, " ");
      return { full: txt(full), compactH: compact.getBoundingClientRect().height, fullH: full.getBoundingClientRect().height,
        legacyH: legacy.getBoundingClientRect().height, routines: [...full.shadowRoot.querySelectorAll(".routine, .rt, [data-routine]")].length };
    }, width);
    check(`${tag} full card: name, status, routines discovered`, /Robot/.test(r.full) && /Charging complete|Charging_complete|Charging Complete/i.test(r.full) && /Vacuum/.test(r.full) && /Mop/.test(r.full), r.full.slice(0, 200));
    check(`${tag} layout: compact is one row; legacy compact: true still works`, r.compactH < 110 && r.legacyH < 110 && r.fullH > 200, JSON.stringify(r));

    await page.evaluate(() => { window.log.length = 0; });
    // Start runs the configured routine
    const start = await page.evaluate(() => {
      const b = [...window.cards[0].shadowRoot.querySelectorAll("button")].find((x) => /Start/.test(x.textContent));
      const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(start.x, start.y);
    await page.waitForTimeout(200);
    // compact: hold the button sends it home (while it's out; docked, it just says so)
    await page.evaluate(() => window.setStates({ "vacuum.robot": "cleaning", "sensor.robot_status": "cleaning" }));
    await page.waitForTimeout(300);
    const cb = await page.evaluate(() => {
      const b = [...window.cards[1].shadowRoot.querySelectorAll("button")].find((x) => x.getBoundingClientRect().width > 0 && /Start|Resume|Pause/.test(x.textContent));
      const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(cb.x, cb.y); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
    await page.waitForTimeout(200);
    const calls = await page.evaluate(() => [...window.log]);
    check(`${tag} Start runs the configured routine`, calls.some((c) => c.startsWith("button.press") && c.includes("button.robot_vacuum")), calls.join(" | "));
    check(`${tag} compact: hold sends it home`, calls.some((c) => c.startsWith("vacuum.return_to_base")), calls.join(" | "));

    if (width === 480) await shot(page, `vacuum-${theme}`, 0);
    check(`${tag} springs idle`, await idle(page, 6000));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }

  const { page } = await openPage(browser, base, {});
  const fields = await page.evaluate(async () => {
    const ed = document.createElement("savvy-vacuum-card-editor");
    document.body.appendChild(ed);
    ed.setConfig({ type: "custom:savvy-vacuum-card", entity: "vacuum.robot" });
    ed.hass = window.hass;
    await new Promise((r) => setTimeout(r, 50));
    return [...ed.shadowRoot.querySelectorAll(".stub-field")].map((f) => f.dataset.name);
  });
  const want = ["entity", "name", "layout", "start", "start_name", "navigation_path", "map", "map_max_height", "rooms", "routines", "modes", "dock", "maintenance", "stats", "hide_modes", "exclude", "battery_warn", "battery_critical"];
  check("editor exposes every option", want.every((w) => fields.includes(w)), JSON.stringify(fields.filter((f) => !want.includes(f))) + " missing: " + JSON.stringify(want.filter((w) => !fields.includes(w))));
  await page.close();
}
