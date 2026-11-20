// Tiny test harness that produces the same matrix format as the Python suite.
//
//   kase("NODE-GEN-01", "Generate", "what it checks", async (t) => { ... })
//   kase(id, area, title, fn, { live: true })                 // needs AIVANA_API_KEY
//   kase(id, area, title, fn, { known: "F1: why it fails" })  // documents a defect
//
// Outcomes: PASS, FAIL, DEFECT (known), FIXED? (re-check), SKIP - same meaning as the
// Python suite, so the two SDKs can be compared row by row.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cases = [];
const evidence = [];

export function kase(id, area, title, fn, opts = {}) {
  cases.push({ id, area, title, fn, live: !!opts.live, known: opts.known || null,
               timeoutMs: opts.timeoutMs || (opts.live ? 120_000 : 5_000) });
}

export class Skip extends Error {}
export const skip = (why) => { throw new Skip(why); };

function redact(obj) {
  const key = process.env.AIVANA_API_KEY || "";
  let s = JSON.stringify(obj);
  if (key) s = s.split(key).join("[REDACTED]");
  s = s.replace(/ai_(live|test)_[A-Za-z0-9_-]{6,}/g, "ai_$1_[REDACTED]");
  return JSON.parse(s);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(p, ms) {
  let timer;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); }),
  ]);
}

// Markdown table cell: escape backslashes first, then pipes, so a cell renders as written
// and can't split into extra columns.
export const escCell = (v) => String(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

// Case filter: plain-text, case-insensitive substring of the case ID or title. Regex
// metacharacters in the argument match themselves.
export function matchesFilter(c, filter) {
  if (!filter) return true;
  const f = String(filter).toLowerCase();
  return c.id.toLowerCase().includes(f) || c.title.toLowerCase().includes(f);
}

// What a run means for a script or a release gate. Read the rows, not the console:
//   0  nothing unexpected: PASS, DEFECT (known), FIXED? (re-check) and SKIP all leave it at 0
//   1  at least one FAIL: the SDK or CLI does something other than what the docs (or a documented defect) say
//   2  nothing ran at all (a filter that matches no case): a gate must never pass on zero cases
//   3  AIVANA_REQUIRE_LIVE=1 and a live case was skipped (no key, or a 429): live behaviour was not checked
// FIXED? is good news that needs a person to update the report, so it is a notice, never a failure.
export function verdict(rows, { requireLive = false } = {}) {
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.id);
  if (failed.length) return { code: 1, reasons: [`${failed.length} unexpected failure(s): ${failed.join(", ")}`] };
  if (rows.length === 0) return { code: 2, reasons: ["no case ran (does the filter match anything?)"] };
  const unlive = requireLive ? rows.filter((r) => r.mode === "live" && r.result === "SKIP").map((r) => r.id) : [];
  if (unlive.length) return { code: 3, reasons: [`${unlive.length} live case(s) skipped but AIVANA_REQUIRE_LIVE=1: ${unlive.join(", ")}`] };
  return { code: 0, reasons: [] };
}

export async function runAll({ meta, isRateLimit, pace = 6000, filter = null }) {
  const haveKey = !!(process.env.AIVANA_API_KEY || "").trim();
  const rows = [];
  let lastLive = 0;
  for (const c of cases) {
    if (!matchesFilter(c, filter)) continue;
    const row = { id: c.id, area: c.area, title: c.title, mode: c.live ? "live" : "offline",
                  result: "", finding: "", detail: "" };
    rows.push(row);
    if (c.live && !haveKey) { row.result = "SKIP"; row.detail = "live test: set AIVANA_API_KEY to run"; print(row); continue; }
    if (c.live) {
      const wait = pace - (Date.now() - lastLive);
      if (wait > 0) await sleep(wait);
    }
    const t = { evidence: (fields) => evidence.push({ case: c.id, at: new Date().toISOString(), ...fields }) };
    try {
      await withTimeout(Promise.resolve().then(() => c.fn(t)), c.timeoutMs);
      if (c.known) { row.result = "FIXED? (re-check)"; row.finding = c.known.split(":")[0]; }
      else row.result = "PASS";
    } catch (e) {
      if (e instanceof Skip) { row.result = "SKIP"; row.detail = e.message; }
      else if (c.live && isRateLimit(e)) { row.result = "SKIP"; row.detail = "rate-limited (429) by the API - rerun later"; }
      else if (c.known) { row.result = "DEFECT (known)"; row.finding = c.known.split(":")[0]; row.detail = oneLine(e); }
      else { row.result = "FAIL"; row.detail = oneLine(e); }
    }
    if (c.live) lastLive = Date.now();
    print(row);
  }
  write(rows, meta, haveKey, filter ? "-partial" : "");
  return rows;
}

function oneLine(e) {
  return `${e && e.name ? e.name + ": " : ""}${(e && e.message) || e}`.split("\n")[0].slice(0, 200);
}

const ICON = { "PASS": "ok  ", "FAIL": "FAIL", "DEFECT (known)": "defx", "FIXED? (re-check)": "FIX?", "SKIP": "skip" };
function print(r) {
  const extra = r.finding ? `  [${r.finding}]` : r.result === "FAIL" ? `  ${r.detail}` : "";
  console.log(`${ICON[r.result] || r.result}  ${r.id.padEnd(12)} ${r.title}${extra}`);
}

function write(rows, meta, haveKey, suffix = "") {
  // AIVANA_RESULTS_DIR keeps a gate run from overwriting the committed evidence in results/.
  const dir = process.env.AIVANA_RESULTS_DIR ? resolve(process.env.AIVANA_RESULTS_DIR) : join(ROOT, "results");
  mkdirSync(dir, { recursive: true });
  const counts = {};
  for (const r of rows) counts[r.result] = (counts[r.result] || 0) + 1;
  const md = [
    "# Aivana Node SDK - validation matrix", "",
    `${meta} | key set: ${haveKey ? "yes" : "no"} | ${new Date().toISOString().slice(0, 19)}`, "",
    "Totals: " + Object.entries(counts).sort().map(([k, v]) => `${k} ${v}`).join(", "), "",
    "| ID | Area | Check | Mode | Result | Finding | Detail |", "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${[r.id, r.area, r.title, r.mode, r.result, r.finding, r.detail].map(escCell).join(" | ")} |`),
  ].join("\n") + "\n";
  writeFileSync(join(dir, `matrix${suffix}.md`), md);
  const csvq = (v) => `"${String(v).replace(/"/g, '""')}"`;
  writeFileSync(join(dir, `matrix${suffix}.csv`),
    ["id,area,title,mode,result,finding,detail", ...rows.map((r) =>
      [r.id, r.area, r.title, r.mode, r.result, r.finding, r.detail].map(csvq).join(","))].join("\n") + "\n");
  if (evidence.length) {
    writeFileSync(join(dir, `evidence${suffix}.jsonl`), evidence.map((e) => JSON.stringify(redact(e))).join("\n") + "\n");
  }
  console.log(`\nTotals: ${Object.entries(counts).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`Matrix:   ${join(dir, `matrix${suffix}.md`)}`);
  if (evidence.length) console.log(`Evidence: ${join(dir, `evidence${suffix}.jsonl`)}`);
}
