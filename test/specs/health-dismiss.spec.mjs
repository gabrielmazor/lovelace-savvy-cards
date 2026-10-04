// 0.10.1: the health card's dismiss button. A row can be put aside: it leaves every count (the card's, the
// home cog's), waits under "Dismissed" with a way back, is forgotten when it recovers, comes back when its
// problem grows, is kept in the user's profile (or in localStorage), and `dismiss: false` hides the buttons.
import { openPage, idle } from "./_util.mjs";

const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];

export default async function ({ browser, base, check }) {
  // ---------- the engine ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async () => {
      const S = window.__savvy, U = "unavailable", OK = "on", out = {};
      const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];
      S.resetDismissed();
      const hass = window.hass;
      const before = S.healthSummary(hass, { watchman: W });
      const bat = before.battery.find((b) => b.alert), off = before.offline[0], wat = before.watchman[0];
      out.before = [before.total, before.counts.battery, before.counts.unavailable, before.counts.watchman];
      S.dismissAdd(hass, { id: bat.dismissId, kind: "bat", name: bat.name, members: bat.members });
      let s = S.healthSummary(hass, { watchman: W });
      out.bat = [s.total, s.counts.battery, s.dismissed.battery.length, s.counts.dismissed, s.battery.some((b) => b.entity === bat.entity)];
      S.dismissAdd(hass, { id: off.dismissId, kind: "off", name: off.name, members: off.members });
      s = S.healthSummary(hass, { watchman: W });
      out.off = [s.total, s.counts.unavailable, s.dismissed.offline.length, s.counts.dismissedBy.unavailable];
      if (wat) {
        S.dismissAdd(hass, { id: wat.dismissId, kind: "wat", name: wat.name, members: wat.members });
        s = S.healthSummary(hass, { watchman: W });
        out.wat = [s.total, s.counts.watchman, s.dismissed.watchman.length, s.watchman.some((r) => r.entity === wat.entity)];
      }
      // another card, another grouping: the same entities stay dismissed
      s = S.healthSummary(hass, { group_by: "none", watchman: W });
      out.grouping = s.counts.unavailable;
      // restoring brings them back
      S.dismissRestore(hass, "off", off.members);
      s = S.healthSummary(hass, { watchman: W });
      out.restored = [s.counts.unavailable, s.dismissed.offline.length];

      // recovery: a battery that is fine again is forgotten, and returns if it drops once more
      S.resetDismissed();
      S.dismissAdd(hass, { id: bat.dismissId, kind: "bat", name: bat.name, members: bat.members });
      window.setStates({ [bat.entity]: "80" });
      S.healthSummary(window.hass, {});
      out.forgot = S.dismissStore.entries.size;
      window.setStates({ [bat.entity]: "5" });
      s = S.healthSummary(window.hass, {});
      out.back = [s.counts.battery, s.dismissed.battery.length];

      // a problem that grows is not covered any more: a device with half its entities down, then one more
      S.resetDismissed();
      const house = (downs) => {
        const h = { states: {}, entities: {}, devices: { d: { id: "d", name: "Porch Hub" } }, areas: {} };
        for (let i = 0; i < 4; i++) {
          const id = `sensor.porch_${i}`;
          h.states[id] = { entity_id: id, state: downs.includes(i) ? U : OK, attributes: { friendly_name: `Porch ${i}` }, last_changed: new Date(Date.now() - 36e5).toISOString() };
          h.entities[id] = { entity_id: id, device_id: "d", platform: "p" };
        }
        return h;
      };
      let h = house([0, 1]);
      const dev = S.healthSummary(h, { group_by: "device" }).offline[0];
      S.dismissAdd(h, { id: dev.dismissId, kind: "off", name: dev.name, members: dev.members });
      out.grow0 = S.healthSummary(h, { group_by: "device" }).counts.unavailable;
      h = house([0, 1, 2]);
      out.grow1 = S.healthSummary(h, { group_by: "device" }).counts.unavailable;
      h = house([0]);   // one recovered: the rest stay dismissed (it is half down no more, a partial device)
      out.shrunk = S.healthSummary(h, { group_by: "device" }).counts.unavailable;
      S.resetDismissed();
      return out;
    });
    check("[engine] dismissing a low battery takes it out of the count and the list, into dismissed", r.bat[0] === r.before[0] - 1 && r.bat[1] === 0 && r.bat[2] === 1 && r.bat[3] === 1 && r.bat[4] === false, JSON.stringify(r));
    check("[engine] dismissing an offline issue takes it out of the count", r.off[1] === r.before[2] - 1 && r.off[0] === r.before[0] - 2 && r.off[2] === 1 && r.off[3] === 1, JSON.stringify(r.off));
    check("[engine] dismissing a Watchman item takes it out of Watchman's count", !r.wat || (r.wat[1] === r.before[3] - 1 && r.wat[2] === 1 && r.wat[3] === false), JSON.stringify(r.wat));
    check("[engine] it is entity-level: a card grouping differently keeps it dismissed too", r.grouping <= r.before[2] - 1, String(r.grouping));
    check("[engine] restoring brings the issue back", r.restored[0] === r.before[2] && r.restored[1] === 0, JSON.stringify(r.restored));
    check("[engine] what recovered is forgotten, and it counts again when it breaks again", r.forgot === 0 && r.back[0] === 1 && r.back[1] === 0, JSON.stringify([r.forgot, r.back]));
    check("[engine] a problem that grows comes back by itself; one that shrinks stays dismissed", r.grow0 === 0 && r.grow1 === 1 && r.shrunk === 0, JSON.stringify([r.grow0, r.grow1, r.shrunk]));
    check("[engine] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- storage: the user's profile, and localStorage when it is not there ----------
  {
    const { page, errors } = await openPage(browser, base, {});
    const r = await page.evaluate(async () => {
      const S = window.__savvy, out = {};
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      // a profile that answers
      S.resetDismissed();
      const calls = [];
      let saved = [{ id: "bat:sensor.front_door_battery", kind: "bat", name: "Front Door Battery", members: ["sensor.front_door_battery"] }];
      const hass = { ...window.hass, callWS: async (msg) => { calls.push(msg); if (msg.type === "frontend/get_user_data") return { value: saved }; if (msg.type === "frontend/set_user_data") { saved = msg.value; return null; } throw new Error("no"); } };
      S.ensureDismissed(hass);
      await wait(80);
      out.loaded = [...S.dismissStore.entries.keys()];
      out.read = calls.map((c) => `${c.type}:${c.key}`);
      S.dismissAdd(hass, { id: "off:d:x", kind: "off", name: "X", members: ["sensor.x"] });
      await wait(80);
      out.wrote = calls.filter((c) => c.type === "frontend/set_user_data").map((c) => [c.key, c.value.length]);
      out.local = JSON.parse(localStorage.getItem("savvy-dismissed") || "[]").length;
      // no profile: localStorage keeps it, silently
      S.resetDismissed();
      const failing = { ...window.hass, callWS: async () => { throw new Error("not for you"); } };
      S.ensureDismissed(failing);
      await wait(60);
      S.dismissAdd(failing, { id: "bat:sensor.a", kind: "bat", name: "A", members: ["sensor.a"] });
      out.kept = JSON.parse(localStorage.getItem("savvy-dismissed") || "[]").map((e) => e.id);
      // a fresh load (another page view): the entry is read back from localStorage
      S.dismissStore.entries.clear();
      Object.assign(S.dismissStore, { local: false, remote: null, loading: false });
      S.ensureDismissed(failing);
      await wait(60);
      out.back = [...S.dismissStore.entries.keys()];
      S.resetDismissed();
      return out;
    });
    check("[storage] the profile's list is read on load (frontend/get_user_data, key savvy_dismissed)", r.loaded[0] === "bat:sensor.front_door_battery" && r.read[0] === "frontend/get_user_data:savvy_dismissed", JSON.stringify([r.loaded, r.read]));
    check("[storage] a dismissal is written to the profile (frontend/set_user_data) and to localStorage", r.wrote.at(-1)?.[0] === "savvy_dismissed" && r.wrote.at(-1)?.[1] === 2 && r.local === 2, JSON.stringify([r.wrote, r.local]));
    check("[storage] with no profile it falls back to localStorage, without an error, and survives a reload", r.kept[0] === "bat:sensor.a" && r.back[0] === "bat:sensor.a", JSON.stringify([r.kept, r.back]));
    check("[storage] no errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- the card, the cog, the popup ----------
  for (const theme of ["dark", "light"]) for (const width of [420, 320]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    await page.evaluate((width) => {
      window.__savvy.resetDismissed();
      window.mount("savvy-system-health-card", { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"] }, width);
      window.mount("savvy-home-header-card", { health: { watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"] }, lights: false, climate: false, media: false, security: false }, 900);
    }, width);
    await page.waitForTimeout(500);
    const read = () => page.evaluate(() => {
      const R = window.cards[0].shadowRoot, H = window.cards[1].shadowRoot;
      return { pill: R.getElementById("pill").textContent, cog: H.getElementById("count").hidden ? "" : H.getElementById("count").textContent,
        rows: [...R.querySelectorAll(".row .n")].map((n) => n.textContent),
        buttons: [...R.querySelectorAll(".row .x:not([hidden])")].map((b) => b.getAttribute("aria-label")),
        dismissedRow: [...R.querySelectorAll(".row .n")].map((n) => n.textContent).find((t) => /^Dismissed/.test(t)) || "" };
    });
    const at = (sel, i = 0) => page.evaluate(({ sel, i }) => { const b = window.cards[0].shadowRoot.querySelectorAll(sel)[i].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, { sel, i });
    const first = await read();
    check(`${tag} every category row has a dismiss button, named for its row`, first.buttons.length >= 3 && first.buttons.every((l) => /^Dismiss /.test(l)), JSON.stringify(first));
    check(`${tag} the cog counts what the card counts`, first.cog === first.pill.split(" ")[0], JSON.stringify([first.pill, first.cog]));

    // dismiss the battery row with a click on its button
    const batIndex = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".row .x:not([hidden])")].findIndex((b) => /Front Door Battery/.test(b.getAttribute("aria-label"))));
    const p = await at(".row .x:not([hidden])", batIndex);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(500);
    const after = await read();
    check(`${tag} dismissing a row lowers the count on the card and on the cog, and the row leaves the list`,
      Number(after.pill.split(" ")[0]) === Number(first.pill.split(" ")[0]) - 1 && after.cog === after.pill.split(" ")[0] && !after.rows.includes("Front Door Battery"), JSON.stringify(after));
    check(`${tag} a collapsed "Dismissed · 1" line appears in its category`, after.dismissedRow === "Dismissed · 1", after.dismissedRow);
    check(`${tag} the row did not open anything (a button of its own)`, !(await page.evaluate(() => (window.moreInfoOpened || []).length)), "");

    // open the line: the item is there with a way back
    const d = await page.evaluate(() => { const n = [...window.cards[0].shadowRoot.querySelectorAll(".row")].find((r) => /^Dismissed/.test(r.querySelector(".n").textContent)).getBoundingClientRect(); return { x: n.x + 24, y: n.y + n.height / 2 }; });
    await page.mouse.click(d.x, d.y);
    await page.waitForTimeout(500);
    const open = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".row .x:not([hidden])")].map((b) => b.getAttribute("aria-label")).filter((l) => /^Bring back/.test(l)));
    check(`${tag} the dismissed line lists it with a "Bring back" button`, open.length === 1 && /Front Door Battery/.test(open[0]), JSON.stringify(open));
    const bi = await page.evaluate(() => [...window.cards[0].shadowRoot.querySelectorAll(".row .x:not([hidden])")].findIndex((b) => /^Bring back/.test(b.getAttribute("aria-label"))));
    const q = await at(".row .x:not([hidden])", bi);
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(500);
    const back = await read();
    check(`${tag} bringing it back restores the count and the row`, back.pill === first.pill && back.rows.includes("Front Door Battery") && !back.dismissedRow, JSON.stringify(back));

    // keyboard: focus the button, Enter
    await page.evaluate(() => { [...window.cards[0].shadowRoot.querySelectorAll(".row .x:not([hidden])")].find((b) => /Front Door Battery/.test(b.getAttribute("aria-label"))).focus(); });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const kb = await read();
    check(`${tag} the button works from the keyboard`, Number(kb.pill.split(" ")[0]) === Number(first.pill.split(" ")[0]) - 1, JSON.stringify(kb));

    // the cog's popup: the same buttons, the same store
    await page.evaluate(() => window.__savvy.resetDismissed());
    await page.waitForTimeout(400);
    const cog = await page.evaluate(() => { const b = window.cards[1].shadowRoot.getElementById("health").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(cog.x, cog.y);
    await page.waitForTimeout(700);
    const pop = await page.evaluate(() => {
      const c = window.__savvy.portalRoot().querySelector("savvy-system-health-card");
      return c ? { n: c.shadowRoot.querySelectorAll(".row .x:not([hidden])").length, pill: c.shadowRoot.getElementById("pill").textContent } : null;
    });
    check(`${tag} the cog's popup has the buttons too`, !!pop && pop.n >= 3, JSON.stringify(pop));
    const pb = await page.evaluate(() => { const c = window.__savvy.portalRoot().querySelector("savvy-system-health-card"); const b = [...c.shadowRoot.querySelectorAll(".row .x:not([hidden])")][0].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(pb.x, pb.y);
    await page.waitForTimeout(600);
    const popAfter = await page.evaluate(() => {
      const c = window.__savvy.portalRoot().querySelector("savvy-system-health-card");
      return { pill: c.shadowRoot.getElementById("pill").textContent, cog: window.cards[1].shadowRoot.getElementById("count").textContent, card: window.cards[0].shadowRoot.getElementById("pill").textContent };
    });
    check(`${tag} dismissing in the popup lowers the cog and the card at once`, popAfter.cog === popAfter.card.split(" ")[0] && Number(popAfter.cog) === Number(first.pill.split(" ")[0]) - 1, JSON.stringify(popAfter));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // dismiss: false hides the buttons; what is dismissed stays dismissed, with its way back
    await page.evaluate((width) => { window.mount("savvy-system-health-card", { dismiss: false, watchman: ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"] }, width); }, width);
    await page.waitForTimeout(500);
    const off = await page.evaluate(() => {
      const R = window.cards[2].shadowRoot;
      return { dismissButtons: [...R.querySelectorAll(".row .x:not([hidden])")].filter((b) => /^Dismiss /.test(b.getAttribute("aria-label"))).length, pill: R.getElementById("pill").textContent,
        line: [...R.querySelectorAll(".row .n")].map((n) => n.textContent).find((t) => /^Dismissed/.test(t)) || "" };
    });
    check(`${tag} dismiss: false hides the buttons, and what was dismissed stays dismissed`, off.dismissButtons === 0 && /^Dismissed/.test(off.line) && off.pill === popAfter.card, JSON.stringify(off));

    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
