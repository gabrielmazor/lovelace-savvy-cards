// ---------------------------------------------------------------------------------------
// core/title: an optional title and an optional link on every card.
//
//   title_path   a page. Off unless set. With it, the card's title text (and only that text:
//                never the header, the icon or anything around it) is a link to the page.
//   title        text for a card that shows no name or title of its own: a slim line at the
//                top of the card. A card that already shows a name makes that name the link
//                and takes `title` as another way to write it.
//
//   titlePathOf(config)                         the page, or null
//   linkTitle(root, el, path, bind)             `el` is the card's own title text; bind(el, onTap)
//                                               is how that card makes something pressable
//   mountTitleLine(root, frame, config, bind)   the slim line, first in the card's frame
// ---------------------------------------------------------------------------------------

const TITLE_CSS = `
  [data-tlink] { display: block; flex: 0 1 auto !important; width: fit-content; max-width: 100%; box-sizing: border-box;
    margin-inline-end: auto !important; padding: 4px 3px; margin-block: -4px; margin-inline-start: -3px; border-radius: 7px;
    cursor: pointer; outline: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    transition: color 160ms ease; }
  @media (hover: hover) { [data-tlink]:hover { color: color-mix(in oklab, rgb(var(--accent, 88 142 233)) 82%, var(--primary-text-color)); } }
  :host([kbd]) [data-tlink]:focus-visible { box-shadow: 0 0 0 2px rgb(var(--accent, 88 142 233)); }
  .sv-ttl { display: flex; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: -0.015em; color: var(--primary-text-color); }
  .sv-ttl-t { display: block; min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

const titlePathOf = (c) => (typeof c?.title_path === "string" && c.title_path.trim() ? c.title_path.trim() : null);

function ensureTitleStyle(root) {
  if (!root || root.querySelector("style[data-title]")) return;
  const s = document.createElement("style");
  s.setAttribute("data-title", "");
  s.textContent = TITLE_CSS;
  root.appendChild(s);
}

function linkTitle(root, el, path, bind) {
  if (!el) return;
  const on = !!path;
  el.__tpath = on ? path : null;
  if (on) ensureTitleStyle(root);
  attr(el, "data-tlink", on ? "" : null);
  attr(el, "role", on ? "link" : null);
  attr(el, "tabindex", on ? "0" : null);
  if (on && !el.__tbound) {
    el.__tbound = true;
    // pressing the words is not pressing whatever the words sit in
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    bind(el, () => { if (el.__tpath) navigate(el.__tpath); });
  }
}

function mountTitleLine(root, frame, c, bind) {
  if (!frame) return null;
  frame.querySelector(":scope > .sv-ttl")?.remove();
  const t = String(c?.title ?? "").trim();
  if (!t) return null;
  ensureTitleStyle(root);
  const line = document.createElement("div");
  line.className = "sv-ttl";
  const span = document.createElement("span");
  span.className = "sv-ttl-t";
  span.textContent = t;
  line.appendChild(span);
  frame.insertBefore(line, frame.firstChild);
  linkTitle(root, span, titlePathOf(c), bind);
  return line;
}
