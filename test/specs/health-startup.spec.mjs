// While Home Assistant (or an integration) is still coming up the health cog is a loading ring with no count, and the
// health card says so instead of listing what is offline. Real signals only: the connection, the core's state, the
// integrations whose setup is in progress. `startup_wait: false` turns it off. "Show anyway" opens the lists.
import { openPage, centerOf } from "./_util.mjs";

const W = ["sensor.watchman_missing_entities", "sensor.watchman_missing_actions"];

export default async function ({ browser, base, check }) {
  const { page, errors } = await openPage(browser, base, { theme: "dark", width: 420 });
  const r = await page.evaluate(async (W) => {
    const S = window.__savvy, out = {};
    const base = window.hass;
    const info = (patch, entries) => { window.hass = { ...base, ...patch, config: { ...base.config, ...(patch.config || {}) } }; S.entryStore.map = new Map(entries || []); return S.startupInfo(window.hass, {}); };
    out.up = info({}, []);
    out.connecting = info({ connected: false }, [])?.phase;
    out.starting = info({ config: { state: "NOT_RUNNING" } }, [])?.phase;
    const loading = info({}, [["a", { domain: "zha", title: "ZHA", state: "setup_in_progress", disabled: false }], ["b", { domain: "mqtt", title: "MQTT", state: "loaded", disabled: false }]]);
    out.integrations = [loading?.phase, loading?.detail];
    out.off = S.startupInfo(window.hass, { startup_wait: false });
    out.fast = S.entryStore.fast;
    // the cards while it loads
    info({ config: { state: "STARTING" } }, []);
    const head = window.mount("savvy-home-header-card", { health: { watchman: W } }, 420);
    const card = window.mount("savvy-system-health-card", { watchman: W }, 420);
    await new Promise((res) => setTimeout(res, 600));
    const cog = head.shadowRoot.getElementById("health");
    out.cog = { loading: cog.hasAttribute("data-loading"), icon: cog.querySelector("ha-icon").getAttribute("icon"), count: !head.shadowRoot.getElementById("count").hidden, alert: cog.hasAttribute("data-alert") };
    const R = card.shadowRoot;
    out.card = { boot: !R.getElementById("boot").hidden, cols: !R.getElementById("cols").hidden, title: R.getElementById("bt").textContent, pill: R.getElementById("pill").textContent };
    R.getElementById("bany").click();
    await new Promise((res) => setTimeout(res, 200));
    out.any = { boot: !R.getElementById("boot").hidden, cols: !R.getElementById("cols").hidden };
    // it is up again: the normal view returns
    info({}, []);
    head.hass = window.hass; card.hass = window.hass;
    await new Promise((res) => setTimeout(res, 300));
    out.done = { loading: cog.hasAttribute("data-loading"), icon: cog.querySelector("ha-icon").getAttribute("icon"), boot: !R.getElementById("boot").hidden, cols: !R.getElementById("cols").hidden };
    // turned off
    info({ config: { state: "STARTING" } }, []);
    const plain = window.mount("savvy-system-health-card", { watchman: W, startup_wait: false }, 420);
    await new Promise((res) => setTimeout(res, 300));
    out.plain = { boot: !plain.shadowRoot.getElementById("boot").hidden };
    return out;
  }, W);
  check("up: no startup state", r.up === null, JSON.stringify(r.up));
  check("the connection, the core's state and integrations in setup each count", r.connecting === "connecting" && r.starting === "starting" && r.integrations[0] === "integrations" && /ZHA/.test(r.integrations[1]) && !/MQTT/.test(r.integrations[1]), JSON.stringify([r.connecting, r.starting, r.integrations]));
  check("startup_wait: false turns it off; while loading the integrations are asked for often", r.off === null, JSON.stringify([r.off, r.fast]));
  check("the cog is a loading ring with no count or alert", r.cog.loading && r.cog.icon !== "mdi:cog" && !r.cog.count && !r.cog.alert, JSON.stringify(r.cog));
  check("the card says it is starting instead of listing", r.card.boot && !r.card.cols && /starting/i.test(r.card.title) && /Starting/.test(r.card.pill), JSON.stringify(r.card));
  check("Show anyway opens the lists", !r.any.boot && r.any.cols, JSON.stringify(r.any));
  check("once it is up the cog and the lists are back", !r.done.loading && r.done.icon === "mdi:cog" && !r.done.boot && r.done.cols, JSON.stringify(r.done));
  check("a card with startup_wait: false never shows it", r.plain.boot === false, JSON.stringify(r.plain));
  check("no errors", errors.length === 0, errors.join(" | "));
  await page.close();
}
