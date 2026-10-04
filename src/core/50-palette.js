// ---------------------------------------------------------------------------------------
// core/palette: HA's named colours, and the mode dictionary that gives every option of a
// mode / scene select an icon and a colour without any configuration.
// ---------------------------------------------------------------------------------------

// HA's own named colours, as its themes define them; the hex is the fallback when a theme
// doesn't. `color: blue` in config becomes var(--blue-color, #2196f3).
const HA_COLORS = {
  red: "#f44336", pink: "#e91e63", purple: "#926bc7", "deep-purple": "#6e41ab", indigo: "#3f51b5",
  blue: "#2196f3", "light-blue": "#03a9f4", cyan: "#00bcd4", teal: "#009688", green: "#4caf50",
  "light-green": "#8bc34a", lime: "#cddc39", yellow: "#ffeb3b", amber: "#ffc107", orange: "#ff9800",
  "deep-orange": "#ff6f22", brown: "#795548", grey: "#9e9e9e", "blue-grey": "#607d8b",
};
const colorOf = (c) => {
  if (!c) return "";
  const k = String(c).toLowerCase().replace(/[\s_]+/g, "-");
  return HA_COLORS[k] ? `var(--${k}-color, ${HA_COLORS[k]})` : c;
};

// The mode dictionary. Each entry: keywords, an MDI icon, a colour. Colours are grouped by
// meaning (CARD-DESIGN.md 5.3): warm for daytime and food, cool for night and sleep,
// violet for screens, green for company, red for away, and no colour at all for the
// resting states (sync, auto, normal), which keep the theme's text colour.
// Matching (modeLook): case, spaces, underscores and plurals are ignored, and the longest
// keyword found wins, so "Movie Night" is a movie, not a night.
const MODE_DICTIONARY = [
  // ---- resting / control
  [["sync", "synced", "follow", "follow house", "default"], "mdi:sync", ""],
  [["auto", "automatic", "normal", "standard", "regular"], "mdi:autorenew", ""],
  [["basic", "simple"], "mdi:home-outline", "#8FA3B8"],
  [["manual", "override", "hand"], "mdi:hand-back-right-outline", "#4FB3A5"],
  [["off", "disabled", "none", "idle"], "mdi:power", "#8A9099"],
  [["eco", "economy", "energy saving", "saving", "green"], "mdi:leaf", "#6FBF73"],
  [["boost", "turbo", "max", "maximum", "full"], "mdi:rocket-launch-outline", "#E8934A"],
  [["silent", "mute", "muted", "quiet", "do not disturb", "dnd"], "mdi:volume-off", "#7F8CA3"],
  [["holiday", "vacation", "trip", "travel", "travelling", "traveling"], "mdi:airplane", "#E06666"],
  [["test", "testing", "debug", "maintenance", "service"], "mdi:wrench-outline", "#8FA3B8"],
  // ---- time of day
  [["morning", "sunrise", "dawn", "wake", "wake up", "waking", "breakfast time"], "mdi:weather-sunset-up", "#F5C04D"],
  [["daytime", "day", "day time", "noon", "midday", "afternoon", "sunny", "bright day"], "mdi:white-balance-sunny", "#F5B83D"],
  [["evening", "sunset", "dusk", "golden hour", "twilight"], "mdi:weather-sunset", "#F2915E"],
  [["night", "nighttime", "night time", "late", "late night", "midnight", "moon"], "mdi:weather-night", "#4F8FE0"],
  // ---- sleep and rest
  [["sleep", "sleeping", "asleep", "bedtime", "bed time", "bed", "goodnight", "good night"], "mdi:sleep", "#7B6FE0"],
  [["nap", "napping", "siesta", "rest", "resting", "lie down"], "mdi:power-sleep", "#8F84E8"],
  [["baby", "baby sleep", "nursery", "kids sleep", "kid sleep"], "mdi:baby-face-outline", "#9A8FE8"],
  [["night light", "nightlight", "night lamp"], "mdi:lightbulb-night-outline", "#5E7FD6"],
  // ---- presence
  [["home", "at home", "someone home", "occupied", "present", "arrive", "arriving", "welcome"], "mdi:home", "#6FA8DC"],
  [["away", "out", "leave", "leaving", "left", "nobody home", "empty", "gone", "absent"], "mdi:home-export-outline", "#E06666"],
  [["guest", "guests", "visitor", "visitors", "company", "hosting"], "mdi:account-group-outline", "#5FBF8A"],
  [["party", "celebration", "celebrate", "birthday", "friends", "gathering", "fiesta"], "mdi:party-popper", "#E36AB5"],
  [["pet", "pets", "dog", "cat", "pet mode"], "mdi:paw", "#C4A57B"],
  [["security", "secure", "armed", "alarm", "lockdown", "protect"], "mdi:shield-home-outline", "#D9534F"],
  // ---- food
  [["cooking", "cook", "kitchen", "baking", "bake", "prep", "meal prep"], "mdi:silverware-fork-knife", "#E8934A"],
  [["dinner", "dining", "lunch", "breakfast", "brunch", "eating", "meal", "supper"], "mdi:food", "#E0A65A"],
  [["coffee", "tea", "cafe"], "mdi:coffee-outline", "#B98552"],
  [["drinks", "cocktail", "cocktails", "wine", "bar", "happy hour"], "mdi:glass-cocktail", "#D0679A"],
  // ---- work and study
  [["work", "working", "office", "home office", "wfh", "work from home", "busy"], "mdi:briefcase-outline", "#5B8DB8"],
  [["focus", "focus time", "concentrate", "concentration", "deep work", "productive"], "mdi:head-cog-outline", "#3FB6C9"],
  [["meeting", "in a meeting", "call", "video call", "zoom", "conference", "on call"], "mdi:account-voice", "#C4566E"],
  [["study", "studying", "homework", "school", "learning", "exam"], "mdi:school-outline", "#6A8FD9"],
  [["reading", "read", "book", "books", "library"], "mdi:book-open-page-variant-outline", "#B7925C"],
  [["writing", "write", "journal", "creative", "art", "drawing", "painting", "craft", "crafts"], "mdi:palette-outline", "#C98BD9"],
  // ---- screens and sound
  [["tv", "watching tv", "television", "watching", "show", "shows", "series", "binge"], "mdi:television-play", "#5BA3D9"],
  [["movie", "movies", "movie time", "watching movie", "cinema", "film", "theater", "theatre", "home theater", "netflix"], "mdi:movie-open", "#9B7BD9"],
  [["gaming", "game", "games", "playstation", "xbox", "nintendo", "switch", "console", "esports"], "mdi:gamepad-variant", "#A8C74F"],
  [["music", "listening", "spotify", "playlist", "concert", "dj", "karaoke", "dance", "dancing"], "mdi:music", "#D97FB8"],
  [["podcast", "radio", "audiobook"], "mdi:podcast", "#C77FB0"],
  [["sport", "sports", "match", "football", "soccer", "basketball", "game day"], "mdi:soccer", "#6DBA6A"],
  // ---- wellness
  [["workout", "exercise", "gym", "training", "fitness", "cardio", "running", "run"], "mdi:dumbbell", "#E57A5A"],
  [["yoga", "stretch", "stretching", "pilates"], "mdi:yoga", "#8CC7A1"],
  [["meditate", "meditation", "mindful", "mindfulness", "breathe", "calm", "zen"], "mdi:meditation", "#7FB3A6"],
  [["bath", "bathing", "shower", "spa", "sauna", "hot tub", "jacuzzi"], "mdi:shower-head", "#5FA8E0"],
  [["getting ready", "dress", "dressing", "makeup", "get ready"], "mdi:hanger", "#D98FA8"],
  // ---- chores
  [["cleaning", "clean", "tidy", "tidying", "housework", "chores"], "mdi:broom", "#7CC4B5"],
  [["vacuum", "vacuuming", "robot", "mopping", "mop"], "mdi:robot-vacuum", "#7CB9C4"],
  [["laundry", "washing", "wash", "dryer", "ironing"], "mdi:washing-machine", "#72A7D8"],
  [["gardening", "garden", "plants", "watering", "yard", "lawn"], "mdi:flower-outline", "#7DBF63"],
  // ---- ambience
  [["relax", "relaxing", "relaxed", "chill", "chilling", "chillout", "lounge", "unwind", "lazy"], "mdi:sofa-outline", "#C4A57B"],
  [["cozy", "cosy", "warm", "hygge", "fireplace", "candle", "candles"], "mdi:fireplace", "#E39A5C"],
  [["romantic", "romance", "date", "date night", "love", "intimate"], "mdi:heart-outline", "#E0677F"],
  [["bright", "full bright", "all lights", "daylight", "concentrate light"], "mdi:brightness-7", "#F2C94C"],
  [["dim", "dimmed", "low light", "soft", "soft light", "ambient", "ambience", "mood", "moody"], "mdi:brightness-4", "#B79CD9"],
  [["dark", "lights off", "blackout", "all off"], "mdi:lightbulb-off-outline", "#7F8CA3"],
  [["colorful", "colourful", "rainbow", "disco", "rgb"], "mdi:palette", "#D97FB8"],
  [["christmas", "xmas", "holiday lights", "festive", "hanukkah", "halloween", "easter"], "mdi:pine-tree", "#5FAF6A"],
  // ---- family
  [["kids", "kid", "children", "family", "family time", "play", "playtime", "toys"], "mdi:human-male-female-child", "#F0A05A"],
];

// keyword -> [icon, colour], built once; each keyword also indexed by its singular
const MODE_INDEX = (() => {
  const m = new Map();
  for (const [words, icon, color] of MODE_DICTIONARY) {
    for (const w of words) {
      const k = norm(w);
      if (!m.has(k)) m.set(k, { icon, color, len: k.length });
    }
  }
  return m;
})();
const singular = (w) => {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;       // parties -> party
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};

// The look of one option: { icon, color }. Config overrides (keyed loosely) win; then the
// exact phrase; then the longest dictionary keyword found inside the option.
function modeLook(option, overrides = {}) {
  const o = norm(option);
  const icons = overrides.icons || {}, colors = overrides.colors || {};
  const hit = (() => {
    const exact = MODE_INDEX.get(o) || MODE_INDEX.get(o.split(" ").map(singular).join(" "));
    if (exact) return exact;
    const words = o.split(" ");
    let best = null;
    for (let i = 0; i < words.length; i++) {
      for (let j = words.length; j > i; j--) {
        const phrase = words.slice(i, j).join(" ");
        const e = MODE_INDEX.get(phrase) || MODE_INDEX.get(words.slice(i, j).map(singular).join(" "));
        if (e && (!best || e.len > best.len)) best = e;
      }
    }
    return best;
  })();
  return {
    icon: icons[o] || hit?.icon || "mdi:shape-outline",
    color: colors[o] !== undefined ? colorOf(colors[o]) : (hit?.color ?? ""),
  };
}

// Any CSS colour (hex, rgb(), a name) as [r, g, b]; a colour the browser cannot read is amber.
let paint2d;
const toRgb = (css) => {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(css).trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  paint2d = paint2d || document.createElement("canvas").getContext("2d");
  paint2d.fillStyle = "#000";
  paint2d.fillStyle = css;
  const out = paint2d.fillStyle;
  if (out[0] === "#") return toRgb(out);
  const n = out.match(/[\d.]+/g);
  return n ? n.slice(0, 3).map(Number) : [245, 184, 61];
};
