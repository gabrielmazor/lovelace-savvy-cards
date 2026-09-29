// ---------------------------------------------------------------------------------------
// core/actions: tap / hold / double-tap in Home Assistant's standard action format, plus
// Savvy's own `list` (the popup of the entities a chip stands for), and the press gesture.
//
//   tap_action: { action: toggle | more-info | navigate | url | perform-action |
//                         call-service | list | none, navigation_path, url_path,
//                 perform_action, data, target, confirmation }
// A bare string ("toggle") is accepted as { action: "toggle" }.
// ---------------------------------------------------------------------------------------

const PRESSES = new Set(["button", "input_button"]);
const TURN_ON = new Set(["script", "scene"]);

const asAction = (a) => (typeof a === "string" ? { action: a } : a || null);

// What a tap does when config says nothing: toggles toggle, buttons press, scripts and
// scenes run, everything else opens more-info.
function defaultTapAction(entity) {
  const d = domainOf(entity);
  if (PRESSES.has(d)) return { action: "perform-action", perform_action: `${d}.press`, target: { entity_id: entity } };
  if (TURN_ON.has(d)) return { action: "perform-action", perform_action: `${d}.turn_on`, target: { entity_id: entity } };
  if (["light", "switch", "input_boolean", "fan", "siren", "automation", "humidifier"].includes(d)) return { action: "toggle" };
  return { action: "more-info" };
}

// Toggle the way each domain actually toggles.
function toggleEntity(hass, id) {
  const d = domainOf(id), st = hass.states[id];
  if (d === "lock") return hass.callService("lock", st?.state === "locked" ? "unlock" : "lock", {}, { entity_id: id });
  if (PRESSES.has(d)) return hass.callService(d, "press", {}, { entity_id: id });
  if (TURN_ON.has(d)) return hass.callService(d, "turn_on", {}, { entity_id: id });
  if (["light", "switch", "input_boolean", "fan", "siren", "automation", "cover", "humidifier", "media_player", "climate", "valve"].includes(d)) {
    return hass.callService(d, "toggle", {}, { entity_id: id });
  }
  return hass.callService("homeassistant", "toggle", {}, { entity_id: id });
}

// Run an action. ctx: { entity, list } where list() opens the chip's entity popup.
function runAction(host, hass, action, ctx = {}) {
  const a = asAction(action);
  if (!a || a.action === "none") return false;
  if (a.confirmation) {
    const t = typeof a.confirmation === "object" && a.confirmation.text ? a.confirmation.text : "Are you sure?";
    if (!window.confirm(t)) return false;
  }
  const entity = a.entity || ctx.entity;
  switch (a.action) {
    case "more-info": moreInfo(host, entity); return true;
    case "toggle": if (entity) toggleEntity(hass, entity); return true;
    case "navigate": navigate(a.navigation_path, a.navigation_replace); return true;
    case "url": if (a.url_path) window.open(a.url_path, a.new_tab === false ? "_self" : "_blank"); return true;
    case "list": if (ctx.list) ctx.list(); return true;
    case "perform-action":
    case "call-service": {
      const svc = a.perform_action || a.service;
      if (!svc) return false;
      const [domain, service] = svc.split(".");
      hass.callService(domain, service, a.data || a.service_data || {}, a.target);
      return true;
    }
    case "fire-dom-event":
      host.dispatchEvent(new CustomEvent("ll-custom", { detail: a, bubbles: true, composed: true }));
      return true;
    default: return false;
  }
}

// The press gesture (CARD-DESIGN.md 3.1): feedback on pointer-down, commit on release; a
// press that travels is a scroll; a hold commits at 500ms with a medium haptic; a
// double-tap only costs a delay where one is configured. `spring` (optional) is driven
// 0 -> 1 while pressed; the card paints it. Returns the spring.
function bindPress(el, { spring, wake, onTap, onHold, onDouble, haptic: tapHaptic = "light" } = {}) {
  let origin = null, armed = false, swallow = false, holdTimer = 0, tapTimer = 0, taps = 0;
  const settle = (motion) => {
    clearTimeout(holdTimer);
    origin = null;
    if (spring) { spring.to(0, motion); wake?.(); }
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || el.hasAttribute("disabled")) return;
    origin = [e.clientX, e.clientY];
    armed = true; swallow = false;
    if (spring) { spring.to(1, onHold ? MOTION.hold : MOTION.press); wake?.(); }
    if (onHold) holdTimer = setTimeout(() => {
      swallow = true;
      settle(MOTION.pop);
      haptic("medium");
      onHold();
    }, HOLD_MS);
  });
  el.addEventListener("pointermove", (e) => {
    if (!origin || Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) < SLOP) return;
    swallow = true;
    settle(MOTION.release);
  });
  el.addEventListener("pointerup", () => origin && settle(MOTION.release));
  for (const t of ["pointercancel", "pointerleave"]) el.addEventListener(t, () => { if (origin) { swallow = true; settle(MOTION.release); } });
  el.addEventListener("contextmenu", (e) => { if (onHold) e.preventDefault(); });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const ok = (armed || e.detail === 0) && !swallow;
    armed = false; swallow = false;
    if (!ok) return;
    if (!onDouble) { if (tapHaptic) haptic(tapHaptic); onTap?.(); return; }
    taps++;
    clearTimeout(tapTimer);
    if (taps >= 2) { taps = 0; haptic("medium"); onDouble(); return; }
    tapTimer = setTimeout(() => { taps = 0; if (tapHaptic) haptic(tapHaptic); onTap?.(); }, DOUBLE_MS);
  });
  // only keys aimed at this element: a focused child with its own press handles its own
  el.addEventListener("keydown", (e) => {
    if (e.target !== el && e.composedPath()[0] !== el) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
  });
  // a gesture that turned into something else (a scrub) must not also fire the tap
  if (spring) spring.swallow = () => { swallow = true; settle(MOTION.release); };
  return spring;
}

// Wires tap/hold/double-tap of an element to action configs, with the chip's defaults.
function bindActions(host, el, getCtx, { spring, wake, defaults = {} } = {}) {
  const act = (kind) => () => {
    const ctx = getCtx();
    const cfg = ctx.config || {};
    const action = cfg[`${kind}_action`] !== undefined ? cfg[`${kind}_action`] : defaults[kind];
    runAction(host, ctx.hass, action, ctx);
  };
  const has = (kind) => {
    const cfg = getCtx().config || {};
    const a = asAction(cfg[`${kind}_action`] !== undefined ? cfg[`${kind}_action`] : defaults[kind]);
    return !!a && a.action !== "none";
  };
  // hold and double-tap only cost something (a sink, a delay) where they're configured;
  // cards rebuild on setConfig, so reading the config once here is enough
  return bindPress(el, {
    spring, wake,
    onTap: act("tap"),
    onHold: has("hold") ? act("hold") : null,
    onDouble: has("double_tap") ? act("double_tap") : null,
  });
}
