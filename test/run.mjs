// Runs every test/specs/*.spec.mjs in a headless browser. No dependencies of its own:
// needs Playwright, resolved as `playwright` or from PLAYWRIGHT=/path/to/playwright.
//   node test/run.mjs            all specs
//   node test/run.mjs core       only specs whose file name contains "core"
//   BROWSER=webkit node test/run.mjs   the same in WebKit (Safari, the iOS app)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT || "playwright");
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/test/`;
const filter = process.argv[2] || "";
const specs = fs.readdirSync(path.join(ROOT, "test/specs")).filter((f) => f.endsWith(".spec.mjs") && f.includes(filter)).sort();
const browser = await (process.env.BROWSER === "webkit" ? webkit : chromium).launch();
let pass = 0, fail = 0;
const failed = [];
for (const f of specs) {
  const results = [];
  const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); ok ? pass++ : fail++; };
  const mod = await import(pathToFileURL(path.join(ROOT, "test/specs", f)).href);
  try { await mod.default({ browser, base, check }); }
  catch (err) { check(`${f} crashed`, false, err.stack || String(err)); }
  console.log(`\n${f}`);
  for (const r of results) {
    const line = `${r.ok ? "PASS" : "FAIL"} ${r.name}${!r.ok && r.detail ? ` — ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}` : ""}`;
    console.log(`  ${line}`);
    if (!r.ok) failed.push({ spec: f, line });
  }
}
await browser.close();
server.close();
// every failure again at the very end, so a long log (or CI's summary) shows what broke without searching
if (failed.length) {
  console.log(`\n${failed.length} failing:`);
  for (const x of failed) {
    console.log(`  ${x.spec}: ${x.line.slice(0, 600)}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${x.spec}::${x.line.replace(/[\r\n]+/g, " ").slice(0, 400)}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${failed.length} failing checks\n\n${failed.map((x) => `- \`${x.spec}\`: ${x.line.slice(0, 500).replace(/\|/g, "\\|")}`).join("\n")}\n`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
