// ---------------------------------------------------------------------------------------
// core/history: state history, long-term statistics, and the chart helpers built on them.
// Rows always come back normalized to { s, lu } (state, last-updated in seconds).
// ---------------------------------------------------------------------------------------

const LONG_RANGE_H = 7 * 24;   // past a week: statistics, since the recorder keeps ~10 days

const rowTime = (r) => {
  const lu = r.lu ?? r.last_updated ?? r.last_changed;
  return typeof lu === "number" ? lu * 1000 : Date.parse(lu);
};

function normalizeRows(raw) {
  const out = {};
  for (const id in raw || {}) {
    out[id] = (raw[id] || []).map((r) => ({ s: r.s ?? r.state, lu: r.lu ?? r.last_updated ?? r.last_changed }));
  }
  return out;
}

// WS history with the REST fallback older cores need.
async function fetchHistory(hass, ids, hours) {
  if (!ids?.length) return {};
  const now = Date.now(), start = new Date(now - hours * 3600000);
  try {
    return normalizeRows(await hass.callWS({
      type: "history/history_during_period",
      start_time: start.toISOString(), end_time: new Date(now).toISOString(),
      entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
    }));
  } catch (err) {
    const path = `history/period/${start.toISOString()}?filter_entity_id=${encodeURIComponent(ids.join(","))}&minimal_response&no_attributes`;
    const list = await hass.callApi("GET", path);
    const raw = {};
    for (const arr of list || []) if (arr?.length) raw[arr[0].entity_id] = arr;
    return normalizeRows(raw);
  }
}

// One attribute's history (a climate entity's current_temperature, say), as { s, lu }
// rows. Attributes only come with the full response, so this is for one entity at a time.
async function fetchAttributeHistory(hass, id, attribute, hours) {
  const now = Date.now(), start = new Date(now - hours * 3600000);
  const raw = await hass.callWS({
    type: "history/history_during_period",
    start_time: start.toISOString(), end_time: new Date(now).toISOString(),
    entity_ids: [id], minimal_response: false, no_attributes: false, significant_changes_only: false,
  });
  let last = null;
  return (raw?.[id] || []).map((r) => {
    const a = r.a || r.attributes;
    if (a && a[attribute] != null) last = a[attribute];
    return { s: last, lu: r.lu ?? r.last_updated ?? r.last_changed };
  }).filter((r) => r.s != null);
}

// Up to a week: state history. Longer: long-term statistics (hourly, daily past a month),
// which HA keeps forever for any sensor with a state_class; a sensor without them falls
// back to whatever state history the recorder still has.
async function fetchRange(hass, ids, hours) {
  if (hours <= LONG_RANGE_H) return fetchHistory(hass, ids, hours);
  const end = Date.now(), start = end - hours * 3600000;
  let stats = {};
  try {
    stats = await hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
      statistic_ids: ids, period: hours > 31 * 24 ? "day" : "hour", types: ["mean", "state"],
    }) || {};
  } catch (err) { /* older core, or no recorder: history below */ }
  const out = {}, missing = [];
  for (const id of ids) {
    const rows = (stats[id] || []).map((r) => ({
      s: r.mean ?? r.state,
      lu: (typeof r.start === "number" ? r.start : Date.parse(r.start)) / 1000,
    })).filter((r) => r.s != null && Number.isFinite(r.lu));
    if (rows.length) out[id] = rows;
    else missing.push(id);
  }
  if (missing.length) Object.assign(out, await fetchHistory(hass, missing, hours));
  return out;
}

// Numeric rows to points, with the live value appended so a line always reaches now.
function numericPoints(rows, liveState, end = Date.now()) {
  const pts = [];
  for (const r of rows || []) {
    const v = parseFloat(r.s), t = rowTime(r);
    if (Number.isFinite(v) && Number.isFinite(t)) pts.push({ t, v });
  }
  const live = parseFloat(liveState);
  if (Number.isFinite(live)) pts.push({ t: end, v: live });
  return pts;
}

// On/off runs clamped to [start, end]: [{ t0, t1, state }].
function stateRuns(rows, start, end, live) {
  const runs = [];
  for (const r of rows || []) {
    const t = rowTime(r), state = r.s;
    if (!Number.isFinite(t)) continue;
    const prev = runs[runs.length - 1];
    if (prev && prev.state === state) continue;
    const t0 = clamp(t, start, end);
    if (prev) prev.t1 = t0;
    runs.push({ t0, t1: end, state });
  }
  const last = runs[runs.length - 1];
  if (last && live && last.state !== live.state) {
    const lc = Date.parse(live.last_changed);
    const t0 = clamp(Number.isFinite(lc) ? lc : end, last.t0, end);
    last.t1 = t0;
    runs.push({ t0, t1: end, state: live.state });
  }
  return runs.filter((r) => r.t1 > r.t0);
}

// Even buckets, averaged, holding the last value across gaps: keeps the line honest and
// the path short enough to redraw cheaply.
function resample(points, start, end, buckets = 120) {
  points.sort((a, b) => a.t - b.t);
  const width = (end - start) / buckets;
  const sums = new Float64Array(buckets), counts = new Float64Array(buckets);
  let carry = null;
  for (const p of points) {
    if (p.t < start) { carry = p; continue; }
    const i = clamp(Math.floor((p.t - start) / width), 0, buckets - 1);
    sums[i] += p.v;
    counts[i]++;
  }
  const out = [];
  let held = carry ? carry.v : null;
  for (let i = 0; i < buckets; i++) {
    if (counts[i]) held = sums[i] / counts[i];
    if (held == null) continue;
    out.push({ t: start + (i + 0.5) * width, v: held });
  }
  return out;
}

// min / max / average of a series, with where the extremes fall.
function seriesStats(points) {
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  return {
    min, max, avg: vals.reduce((a, b) => a + b, 0) / vals.length, last: vals[vals.length - 1],
    minAt: points[vals.indexOf(min)], maxAt: points[vals.indexOf(max)],
  };
}

// Catmull-Rom through the samples, converted to cubic beziers.
function linePath(pts) {
  const f = (v) => v.toFixed(2);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} `
      + `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
