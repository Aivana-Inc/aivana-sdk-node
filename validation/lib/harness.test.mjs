// Offline unit tests for the validation harness helpers (run by `node --test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escCell, matchesFilter, verdict } from "./harness.mjs";

// The cases below start run.mjs as a real process, which imports the SDK under test from validation/node_modules. The
// repository's own CI runs `node --test` from the repo root, finds this file, and does not install that folder, so
// without it these cases are skipped (with the reason) instead of failing. Run `npm ci` in validation/ to run them.
const here = fileURLToPath(new URL("..", import.meta.url));
const needsInstall = existsSync(here + "node_modules/@aivana/sdk/package.json")
  ? {} : { skip: "run `npm ci` in validation/ to run this (the repository's CI does not install it)" };

// Split a Markdown table row on unescaped pipes, then unescape \\ and \| the way a renderer does.
function parseRow(row) {
  const cells = [];
  let cur = "";
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && i + 1 < row.length) { cur += row[++i]; continue; }
    if (ch === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells.slice(1, -1);
}

test("escCell escapes backslashes before pipes", () => {
  assert.equal(escCell("a\\b"), "a\\\\b");
  assert.equal(escCell("a|b"), "a\\|b");
  assert.equal(escCell("a\\|b"), "a\\\\\\|b");
  assert.equal(escCell("C:\\path\\"), "C:\\\\path\\\\");
  assert.equal(escCell(42), "42");
});

test("cells with backslashes and pipes round-trip through a table row", () => {
  const values = ["C:\\tmp\\x", "ends with \\", "a\\|b", "x | y", "plain"];
  const row = `| ${values.map(escCell).join(" | ")} |`;
  assert.deepEqual(parseRow(row), values);
});

test("matchesFilter is a case-insensitive plain-text substring match", () => {
  const c = { id: "NODE-GEN-01", title: "Generate returns text (basic)" };
  assert.equal(matchesFilter(c, null), true);
  assert.equal(matchesFilter(c, ""), true);
  assert.equal(matchesFilter(c, "gen-01"), true);
  assert.equal(matchesFilter(c, "RETURNS TEXT"), true);
  assert.equal(matchesFilter(c, "(basic)"), true);
  assert.equal(matchesFilter(c, "NODE.GEN"), false); // "." is literal, not "any char"
  assert.equal(matchesFilter(c, "GEN.*"), false);
});

test("matchesFilter never throws on regex metacharacters", () => {
  const c = { id: "X-[1]", title: "a*b+c? \\d (open" };
  for (const f of ["(", "[", "\\", "*", "+", "?", ")", "{2,", "a*b+c?", "\\d", "X-[1]", "(open"]) {
    assert.doesNotThrow(() => matchesFilter(c, f));
  }
  assert.equal(matchesFilter(c, "X-[1]"), true);
  assert.equal(matchesFilter(c, "a*b+c?"), true);
  assert.equal(matchesFilter(c, "\\d"), true);
  assert.equal(matchesFilter(c, "(open"), true);
  assert.equal(matchesFilter(c, "["), true);
  assert.equal(matchesFilter(c, "{2,"), false);
});

const row = (result, mode = "offline", id = "NODE-X-01") => ({ id, mode, result });

test("verdict: PASS, known defects, FIXED? and SKIP are all exit 0", () => {
  const rows = [row("PASS"), row("DEFECT (known)"), row("FIXED? (re-check)"), row("SKIP", "live")];
  assert.deepEqual(verdict(rows), { code: 0, reasons: [] });
});

test("verdict: any FAIL is exit 1 and names the case", () => {
  const v = verdict([row("PASS"), row("FAIL", "offline", "NODE-ERR-01")]);
  assert.equal(v.code, 1);
  assert.match(v.reasons[0], /NODE-ERR-01/);
});

test("verdict: a run in which no case ran is exit 2, never a pass", () => {
  assert.equal(verdict([]).code, 2);
});

test("verdict: with AIVANA_REQUIRE_LIVE a skipped live case is exit 3, a skipped offline case is not", () => {
  assert.equal(verdict([row("PASS"), row("SKIP", "live")], { requireLive: true }).code, 3);
  assert.equal(verdict([row("PASS"), row("SKIP", "offline")], { requireLive: true }).code, 0);
  assert.equal(verdict([row("PASS"), row("SKIP", "live")], { requireLive: false }).code, 0);
});

test("verdict: a FAIL outranks a skipped live case", () => {
  assert.equal(verdict([row("FAIL"), row("SKIP", "live")], { requireLive: true }).code, 1);
});

test("run.mjs stops with exit 2, before running anything, when the installed SDK is not the expected version", needsInstall, () => {
  const dir = fileURLToPath(new URL("..", import.meta.url));
  const r = spawnSync(process.execPath, ["run.mjs"], { cwd: dir, encoding: "utf8",
    env: { ...process.env, AIVANA_API_KEY: "", AIVANA_RESULTS_DIR: dir + "/.tmp-results-test", AIVANA_EXPECT_SDK_VERSION: "0.0.0-not-this" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /expected 0\.0\.0-not-this/);
  assert.ok(!/^ok /m.test(r.stdout));
});

test("run.mjs exits 2 when the filter matches no case (the verdict reaches the process exit code)", needsInstall, () => {
  const dir = fileURLToPath(new URL("..", import.meta.url));
  const r = spawnSync(process.execPath, ["run.mjs", "NO-SUCH-CASE-ANYWHERE"], { cwd: dir, encoding: "utf8",
    env: { ...process.env, AIVANA_API_KEY: "", AIVANA_RESULTS_DIR: dir + "/.tmp-results-test" } });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /VERDICT: no case ran/);
});

test("run.mjs stops with exit 2 when the installed CLI is not the expected version", needsInstall, () => {
  const dir = fileURLToPath(new URL("..", import.meta.url));
  const r = spawnSync(process.execPath, ["run.mjs"], { cwd: dir, encoding: "utf8",
    env: { ...process.env, AIVANA_API_KEY: "", AIVANA_RESULTS_DIR: dir + "/.tmp-results-test", AIVANA_EXPECT_CLI_VERSION: "0.0.0-not-this" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /installed CLI is .*expected 0\.0\.0-not-this/);
});
