// Builds dist/savvy-cards.js: the core files, then every card, in one scope. No
// dependencies, no bundler: `node build.mjs`. `node build.mjs --check` exits 1 when the
// committed dist file isn't what the sources build to (CI runs this).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const version = readFileSync(join(root, "VERSION"), "utf8").trim();
const list = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".js")).sort();

const parts = [
  `/*! Savvy Cards v${version} | MIT License | built from src/ by build.mjs, do not edit */`,
  "(() => {",
  '"use strict";',
  `const SAVVY_VERSION = ${JSON.stringify(version)};`,
];
for (const f of list("src/core")) {
  parts.push(`\n// ===== core/${f} =====\n${readFileSync(join(root, "src/core", f), "utf8").trimEnd()}`);
}
// each card in its own scope: a card can keep private helpers without clashing
for (const f of list("src/cards")) {
  parts.push(`\n// ===== cards/${f} =====\n(() => {\n${readFileSync(join(root, "src/cards", f), "utf8").trimEnd()}\n})();`);
}
parts.push(
  '\nconsole.info(`%c SAVVY CARDS %c ${SAVVY_VERSION} `, "color:#fff;background:#588ee9;font-weight:700;border-radius:4px 0 0 4px;padding:2px 4px",',
  '  "color:#588ee9;background:transparent;border:1px solid #588ee9;border-radius:0 4px 4px 0;padding:1px 4px");',
  "})();\n",
);
const out = parts.join("\n");
const dest = join(root, "dist/savvy-cards.js");

if (process.argv.includes("--check")) {
  const current = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  if (current !== out) {
    console.error("dist/savvy-cards.js is out of date: run `node build.mjs` and commit the result.");
    process.exit(1);
  }
  console.log("dist is current");
} else {
  writeFileSync(dest, out);
  console.log(`built dist/savvy-cards.js v${version} (${(out.length / 1024).toFixed(1)} KB, ${list("src/core").length} core, ${list("src/cards").length} cards)`);
}
