// A popup's title leads to the page too, when there is one: with the button at the bottom, and without it.
import { openPage } from "./_util.mjs";

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 360 });
  const r = await page.evaluate(async () => {
    const S = window.__savvy, host = window.mount("savvy-lights-card", { area: "living_room" }, 360);
    const out = {};
    const open = (spec) => { const sh = new S.Sheet(host, { title: "Lights" }); sh.setFooter(spec); sh.open(); return sh; };
    const link = (sh) => sh.el.querySelector(".sv-title");
    let hit = 0;
    const a = open({ label: "Open lights", onTap: () => hit++ });
    out.withButton = { link: link(a).hasAttribute("data-link"), button: !!a.el.querySelector(".sv-go") };
    link(a).click(); out.hitA = hit; out.closedA = a.closing || !a.isOpen;
    const b = open({ label: "Open lights", onTap: () => hit++, noButton: true });
    out.noButton = { link: link(b).hasAttribute("data-link"), button: !!b.el.querySelector(".sv-go") };
    link(b).click(); out.hitB = hit;
    const c = open(null);
    out.none = { link: link(c).hasAttribute("data-link"), button: !!c.el.querySelector(".sv-go") };
    c.close(true);
    const h = S.pageButtonSpec ? null : null;
    return out;
  });
  check("with a page and the button: the title is a link and the button is there", r.withButton.link && r.withButton.button, JSON.stringify(r.withButton));
  check("tapping the title goes to the page and closes the popup", r.hitA === 1 && r.closedA, JSON.stringify([r.hitA, r.closedA]));
  check("button off but a page: the title still works, with no button", r.noButton.link && !r.noButton.button && r.hitB === 2, JSON.stringify([r.noButton, r.hitB]));
  check("no page: a plain title", !r.none.link && !r.none.button, JSON.stringify(r.none));
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
