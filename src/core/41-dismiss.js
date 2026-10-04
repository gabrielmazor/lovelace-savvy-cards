// ---------------------------------------------------------------------------------------
// core/dismiss: what one person has put aside on the health card. A dismissed offline issue,
// low battery or Watchman item leaves every count (the card's, its categories', the home
// cog's) and waits under "Dismissed". It is personal: kept in the user's Home Assistant profile
// (frontend/set_user_data, so it follows them to their other devices, no admin needed) and in
// localStorage when that is not available. The settings' `health.ignore` is the shared, permanent
// list; this one is for one person's "I know, leave me alone".
//
// An entry remembers the entities that were failing when it was set (`members`). An issue is
// dismissed while every one of its failing entities is a member, whatever the card groups them
// into, so a hub dismissed on one card is dismissed on a card that lists its devices too. A member
// that recovers is forgotten, and an issue that grows (a new entity goes down) is not covered any
// more: it comes back by itself.
// ---------------------------------------------------------------------------------------

const DISMISS_KEY = "savvy_dismissed";
const DISMISS_LS = "savvy-dismissed";
const DISMISS_KINDS = ["off", "bat", "wat"];
const dismissStore = { entries: new Map(), version: 0, listeners: new Set(), local: false, remote: null, loading: false };

// the cards hear about it a moment later, never from inside the summary that pruned
const dismissChanged = () => {
  dismissStore.version++;
  Promise.resolve().then(() => dismissStore.listeners.forEach((fn) => { try { fn(); } catch (err) { /* a card that went away */ } }));
};
const dismissList = () => [...dismissStore.entries.values()].map((e) => ({ id: e.id, kind: e.kind, name: e.name, members: e.members }));
const dismissLoad = (list) => {
  dismissStore.entries = new Map((Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e.id === "string" && DISMISS_KINDS.includes(e.kind) && Array.isArray(e.members) && e.members.length)
    .map((e) => [e.id, { id: e.id, kind: e.kind, name: String(e.name || ""), members: e.members.map(String) }]));
};
const dismissSave = (hass) => {
  const list = dismissList();
  try { localStorage.setItem(DISMISS_LS, JSON.stringify(list)); } catch (err) { /* storage blocked: the profile copy still works */ }
  if (hass?.callWS && dismissStore.remote !== false) {
    Promise.resolve().then(() => hass.callWS({ type: "frontend/set_user_data", key: DISMISS_KEY, value: list })).catch(() => {});
  }
};

// Read what is kept: localStorage at once, the profile as soon as Home Assistant answers (once; a refusal is not asked again).
function ensureDismissed(hass) {
  const S = dismissStore;
  if (!S.local) {
    S.local = true;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(DISMISS_LS) || "[]"); } catch (err) { saved = []; }
    if (Array.isArray(saved) && saved.length) { dismissLoad(saved); dismissChanged(); }
  }
  if (!hass?.callWS || S.loading || S.remote !== null) return;
  S.loading = true;
  Promise.resolve().then(() => hass.callWS({ type: "frontend/get_user_data", key: DISMISS_KEY })).then((res) => {
    S.remote = true;
    const value = res?.value;
    if (Array.isArray(value)) {
      dismissLoad(value);
      try { localStorage.setItem(DISMISS_LS, JSON.stringify(dismissList())); } catch (err) { /* ignore */ }
      dismissChanged();
    } else if (S.entries.size) dismissSave(hass);
  }).catch(() => { S.remote = false; }).finally(() => { S.loading = false; });
}

function dismissAdd(hass, entry) {
  dismissStore.entries.set(entry.id, { id: entry.id, kind: entry.kind, name: String(entry.name || ""), members: [...new Set(entry.members.map(String))] });
  dismissSave(hass);
  dismissChanged();
}

// bring back every entry of that kind that shares a member with these
function dismissRestore(hass, kind, members) {
  const want = new Set(members);
  let any = false;
  for (const [id, e] of dismissStore.entries) {
    if (e.kind === kind && e.members.some((m) => want.has(m))) { dismissStore.entries.delete(id); any = true; }
  }
  if (!any) return;
  dismissSave(hass);
  dismissChanged();
}

// drop the members that are fine again (`still(kind, member)` says whether one still needs attention)
function dismissPrune(hass, still) {
  let any = false;
  for (const [id, e] of dismissStore.entries) {
    const keep = e.members.filter((m) => still(e.kind, m) !== false);
    if (keep.length === e.members.length) continue;
    any = true;
    if (keep.length) e.members = keep; else dismissStore.entries.delete(id);
  }
  if (!any) return;
  dismissSave(hass);
  dismissChanged();
}

// the entities each kind covers right now
function dismissView() {
  const view = { off: new Set(), bat: new Set(), wat: new Set(), size: dismissStore.entries.size };
  for (const e of dismissStore.entries.values()) e.members.forEach((m) => view[e.kind].add(m));
  return view;
}

const resetDismissed = () => {
  Object.assign(dismissStore, { entries: new Map(), version: 0, local: false, remote: null, loading: false });
  try { localStorage.removeItem(DISMISS_LS); } catch (err) { /* ignore */ }
  dismissChanged();
};
