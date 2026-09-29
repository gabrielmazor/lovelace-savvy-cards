// ---------------------------------------------------------------------------------------
// core/format: durations, relative and absolute times, numbers.
// ---------------------------------------------------------------------------------------

const langOf = (hass) => hass?.locale?.language || undefined;

// "4 min", "1 h 20 min", "5 h", "3 d". Whole minutes only: a glance needs "about when",
// and seconds would make the text churn.
function duration(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 6 && mm) return `${h} h ${mm} min`;
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// Active things say how long they've been going ("for 12 min"); idle things say when
// they stopped ("12 min ago").
function since(t, active, now = Date.now()) {
  if (!Number.isFinite(t)) return "";
  const d = now - t;
  if (d < 60000) return "just now";
  return active ? `for ${duration(d)}` : `${duration(d)} ago`;
}

// "3 days ago" for timestamp states.
const RTF_UNITS = [
  ["year", 31557600000], ["month", 2629800000], ["week", 604800000],
  ["day", 86400000], ["hour", 3600000], ["minute", 60000],
];
const rtfCache = new Map();
function relativeTime(t, lang) {
  if (!Number.isFinite(t)) return null;
  const diff = t - Date.now();
  if (Math.abs(diff) < 45000) return "just now";
  const key = lang || "en";
  let rtf = rtfCache.get(key);
  if (!rtf) {
    try { rtf = new Intl.RelativeTimeFormat(key, { numeric: "auto" }); } catch (err) { rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); }
    rtfCache.set(key, rtf);
  }
  for (const [unit, ms] of RTF_UNITS) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(Math.round(diff / 60000), "minute");
}

const fmtDate = (t, opts, lang) => {
  try { return new Intl.DateTimeFormat(lang, opts).format(t); } catch (err) { return new Date(t).toLocaleString(); }
};

// Absolute time for a tooltip next to a relative one.
const clockTime = (t, lang) => fmtDate(t, { weekday: "short", hour: "2-digit", minute: "2-digit" }, lang);

// Axis labels for a chart spanning `span` ms: times for a day or two, weekdays for a few
// days, dates past a week.
function axisLabel(t, span, lang) {
  const hours = span / 3600000;
  const opts = hours > 168 ? { month: "short", day: "numeric" }
    : hours > 48 ? { weekday: "short" } : { hour: "numeric", minute: "2-digit" };
  return fmtDate(t, opts, lang);
}

// A moment under a scrub cursor: the weekday only when it isn't today; dates past a week.
function momentLabel(t, span, lang) {
  const hours = span / 3600000;
  const today = new Date(t).toDateString() === new Date().toDateString();
  const opts = hours > 31 * 24 ? { month: "short", day: "numeric" }
    : hours > 168 ? { month: "short", day: "numeric", hour: "numeric" }
    : today ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" };
  return fmtDate(t, opts, lang);
}

// Fewer decimals as numbers grow: 1234, 56.7, 8.91.
function fmtNumber(v) {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(v.toFixed(digits)).toString();
}

// "22.5 °C" style: units that attach (°, %) hug the number, others get a space.
const withUnit = (n, unit) => (!unit ? n : /^[°%]/.test(unit) ? `${n}${unit}` : `${n} ${unit}`);

// HA's own formatting when it has it, a title-cased state otherwise.
function stateText(hass, st) {
  if (!st) return "Not found";
  try { return hass.formatEntityState ? hass.formatEntityState(st) : title(st.state); } catch (err) { return title(st.state); }
}

// What a chip or badge says. A media player is either playing or not: paused, idle, on,
// standby and off all read "Not playing" (unavailable stays unavailable).
function chipState(hass, st) {
  if (st && String(st.entity_id).startsWith("media_player.") && st.state !== "playing"
    && st.state !== "unavailable" && st.state !== "unknown") return "Not playing";
  return stateText(hass, st);
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
// A timestamp by device_class, or by shape: some integrations don't expose device_class,
// and parseFloat("2026-09-26T…") would otherwise read the year as a number.
const isTimestamp = (st) => !!st && (st.attributes.device_class === "timestamp" || st.attributes.device_class === "date"
  || ISO_TIMESTAMP.test(st.state || ""));
