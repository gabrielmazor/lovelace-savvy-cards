// The climate card's layout options: the steps either side of the number (default) or together on the
// right with the number on the left; and every mode is its icon and its word on one line.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 460 });
  const read = (cfg) => page.evaluate(async (cfg) => {
    const el = window.mount("savvy-climate-card", { entity: "climate.living_room_ac", ...cfg }, 460);
    await new Promise((r) => setTimeout(r, 700));
    const r = el.shadowRoot, box = (id) => r.getElementById(id).getBoundingClientRect();
    const seg = r.querySelector(".modes .seg"), ic = seg.querySelector("ha-icon").getBoundingClientRect(), tx = seg.querySelector("span").getBoundingClientRect();
    return { value: box("value").left, minus: box("minus").left, plus: box("plus").left, card: r.querySelector("ha-card").getBoundingClientRect().left,
      icon: { x: ic.left, y: ic.top + ic.height / 2 }, word: { x: tx.left, y: tx.top + tx.height / 2 } };
  }, cfg);
  const sides = await read({});
  check("default: − left of the number, + right of it", sides.minus < sides.value && sides.plus > sides.value, JSON.stringify(sides));
  const right = await read({ steppers: "right" });
  check("steppers: right — the number first, − then + together on the right", right.value < right.minus && right.minus < right.plus && right.value - right.card < 40, JSON.stringify(right));
  check("modes: the icon and its word on one line, the icon first", Math.abs(sides.icon.y - sides.word.y) < 3 && sides.icon.x < sides.word.x, JSON.stringify([sides.icon, sides.word]));
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
