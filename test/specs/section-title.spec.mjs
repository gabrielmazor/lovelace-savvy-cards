// savvy-section-title-card on the made-up house.
import { openPage, idle, shot, centerOf } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  for (const theme of ["dark", "light"]) for (const width of [520, 330]) {
    const tag = `[${theme} ${width}]`;
    const { page, errors } = await openPage(browser, base, { theme, width });
    const r = await page.evaluate(async (width) => {
      const lr = window.mount("savvy-section-title-card", { area: "living_room", navigation_path: "/lovelace/living-room", control: "input_select.living_room_scene" }, width);
      const pinned = window.mount("savvy-section-title-card", { area: "bedroom", entities: ["input_boolean.movie_mode", "binary_sensor.living_room_door"], auto_discover: false, temperature: false }, width);
      const legacy = window.mount("savvy-section-title-card", { name: "Hall", area: "hallway", locks: "lock.back_door", heading_style: "subtitle", filled: true }, width);
      await new Promise((res) => setTimeout(res, 500));
      const read = (el) => {
        const r = el.shadowRoot;
        return { name: r.getElementById("name").textContent, icon: r.getElementById("icon").getAttribute("icon"),
          mode: r.getElementById("mode").hidden ? null : r.getElementById("modeText").textContent,
          modeIcon: r.getElementById("modeIcon").getAttribute("icon"),
          temp: r.getElementById("temp").hidden ? null : r.getElementById("tempText").textContent,
          // read from the row's end, next to the temperature: the order the card reads in
          badges: [...r.querySelectorAll(".badge")].filter((b) => b.getAttribute("aria-hidden") === "false").map((b) => b.getAttribute("aria-label")).reverse() };
      };
      return { lr: read(lr), pinned: read(pinned), legacy: read(legacy) };
    }, width);
    check(`${tag} name and icon come from the area`, r.lr.name === "Living Room" && r.lr.icon === "mdi:sofa", JSON.stringify(r.lr));
    check(`${tag} mode chip shows the option with its dictionary icon`, r.lr.mode === "Relax" && r.lr.modeIcon, JSON.stringify(r.lr));
    check(`${tag} temperature: the area's sensor`, r.lr.temp === "23.6°", r.lr.temp);
    check(`${tag} discovered: what is active first (presence, then the rest), then the closed door, which is always there`,
      JSON.stringify(r.lr.badges.map((b) => b.split(",")[0])) === JSON.stringify(["Presence", "TV", "AC", "Door"]), JSON.stringify(r.lr.badges));
    check(`${tag} pinned only, shown even when idle, a door before the rest; temperature off`,
      JSON.stringify(r.pinned.badges.map((b) => b.split(",")[0])) === JSON.stringify(["Living Room Door", "Movie Mode"]) && r.pinned.temp === null, JSON.stringify(r.pinned));
    check(`${tag} legacy locks: an unlocked lock shows as its kind`, r.legacy.badges.some((b) => b.startsWith("Back Door")) && r.legacy.name === "Hall", JSON.stringify(r.legacy));
    if (width === 520) await shot(page, `heading-${theme}`, 0);
    check(`${tag} springs idle`, await idle(page));
    check(`${tag} no errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
