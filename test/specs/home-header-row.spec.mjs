// savvy-home-header-card: without a control chip it is one row (home button, the chips, then the weather
// and the health cog at the end, sliding sideways when it is wider than the card); with one, two rows.
import { openPage, idle } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [900, 420, 340]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      window.mount("savvy-home-header-card", { home_path: "/lovelace/home", health: { watchman: [] } }, width);
      window.mount("savvy-home-header-card", { control: "input_select.house_mode", home_path: "/lovelace/home" }, width);
      await new Promise((res) => setTimeout(res, 700));
      const read = (el) => {
        const R = el.shadowRoot, row = R.getElementById("row");
        const box = (x) => { const b = x.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2 }; };
        const chips = [...R.querySelectorAll("#chips .chip")].map(box);
        return { single: row.hasAttribute("data-single"), overflow: row.hasAttribute("data-overflow"), scrolls: row.scrollWidth > row.clientWidth + 1,
          home: box(R.getElementById("home")), weather: R.getElementById("weather").hidden ? null : box(R.getElementById("weather")),
          cog: box(R.getElementById("health")), chips, pill: R.getElementById("pill").hidden, rowBox: box(row) };
      };
      return window.cards.map(read);
    }, width);
    const [a, b] = r;
    const ys = [a.home, a.cog, ...(a.weather ? [a.weather] : []), ...a.chips].map((x) => x.cy);
    check(`${tag} no control: one row`, a.single && Math.max(...ys) - Math.min(...ys) < 2 && a.pill, JSON.stringify(ys));
    // scrollLeft is 0, so the left-to-right order of what is on screen is the DOM order laid out: home, chips, weather, cog
    check(`${tag} order: home, then the chips, then weather, then the cog`,
      a.home.x < a.chips[0].x && a.chips.every((c, i) => !i || c.x > a.chips[i - 1].x) && a.chips[a.chips.length - 1].x < a.weather.x && a.weather.x < a.cog.x, JSON.stringify([a.home.x, a.chips.map((c) => c.x), a.weather?.x, a.cog.x]));
    check(`${tag} it slides only when it is wider than the card, with a fade then`, a.scrolls === a.overflow && (width === 900 ? !a.scrolls : width === 340 ? a.scrolls : true), JSON.stringify([a.scrolls, a.overflow]));
    check(`${tag} with a control chip: two rows, the chips below`, !b.single && !b.pill && b.chips[0].y > b.home.y + b.home.h - 1, JSON.stringify([b.single, b.pill, b.chips[0].y, b.home.y]));
    if (width === 340) {
      const moved = await page.evaluate(async () => {
        const row = window.cards[0].shadowRoot.getElementById("row");
        row.scrollTo({ left: row.scrollWidth, behavior: "instant" });
        await new Promise((res) => setTimeout(res, 200));
        const R = window.cards[0].shadowRoot, cog = R.getElementById("health").getBoundingClientRect(), box = row.getBoundingClientRect();
        return { cogRight: cog.right, rowRight: box.right, left: row.scrollLeft };
      });
      check(`${tag} the cog is reachable at the end of the row`, moved.left > 0 && moved.cogRight <= moved.rowRight + 2, JSON.stringify(moved));
    }
    if (width === 900) {
      // the Savvy settings hold a home page and a control; the card can switch each off in the editor, without YAML tricks
      const o = await page.evaluate(async (width) => {
        window.mount("savvy-settings-card", { pages: { home: "/lovelace/home" }, house: { control: "input_select.house_mode" } }, width);
        const base = window.cards.length;
        window.mount("savvy-home-header-card", {}, width);
        window.mount("savvy-home-header-card", { show_home: false, show_control: false }, width);
        window.mount("savvy-home-header-card", { home_path: location.pathname }, width);
        await new Promise((res) => setTimeout(res, 800));
        return [base, base + 1, base + 2].map((i) => { const R = window.cards[i].shadowRoot; return { home: !R.getElementById("home").hidden, pill: !R.getElementById("pill").hidden }; });
      }, width);
      check(`${tag} the settings give the header a home button and a control`, o[0].home && o[0].pill, JSON.stringify(o));
      check(`${tag} Show home button / Show control off: neither, even with the settings`, !o[1].home && !o[1].pill, JSON.stringify(o));
      check(`${tag} no home button on the home page itself`, !o[2].home, JSON.stringify(o));
    }
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
