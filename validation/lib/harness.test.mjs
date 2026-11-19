// Offline unit tests for the validation harness helpers (run by `node --test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { escCell, matchesFilter } from "./harness.mjs";

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
