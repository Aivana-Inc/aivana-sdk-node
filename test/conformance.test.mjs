// The shared `aivana` CLI conformance suite, run against this implementation.
//
// conformance/cli.json is the behaviour spec both CLIs must meet: this one, and the
// Python CLI in aivana-sdk-python, which runs the same file. conformance/README.md
// has the format and the rule for changing it: the two copies stay byte-identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main, REQUEST_SOURCE } from "../src/cli.js";
import { capture, fakeApi, stdin } from "./support/cli-doubles.mjs";

const SUITE = JSON.parse(readFileSync(new URL("../conformance/cli.json", import.meta.url), "utf8"));

const EXPECT_KEYS = new Set([
  "exit", "stdout", "stderr", "stdout_contains", "stderr_contains", "stdout_excludes",
  "stderr_excludes", "stdout_starts_with", "stdout_json", "stderr_counts", "requests", "request",
]);
const REQUEST_KEYS = new Set(["url", "headers", "body", "body_keys"]);
const SCENARIO_KEYS = new Set(["name", "argv", "env", "stdin", "files", "response", "expect"]);

test("the suite is well formed", () => {
  // A typo in the suite must fail loudly, not quietly check nothing.
  assert.equal(SUITE.suite, "aivana-cli");
  assert.ok(Number.isInteger(SUITE.version));
  const names = SUITE.scenarios.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "scenario names must be unique");
  for (const s of SUITE.scenarios) {
    for (const key of Object.keys(s)) assert.ok(SCENARIO_KEYS.has(key), `${s.name}: ${key}`);
    assert.ok(Array.isArray(s.argv), s.name);
    assert.ok("exit" in s.expect, s.name);
    for (const key of Object.keys(s.expect)) assert.ok(EXPECT_KEYS.has(key), `${s.name}: ${key}`);
    for (const key of Object.keys(s.expect.request || {})) {
      assert.ok(REQUEST_KEYS.has(key), `${s.name}: request.${key}`);
    }
  }
});

// Replace the suite's placeholders in argv and expected values.
function fill(value, tmp) {
  if (typeof value === "string") {
    return value.replaceAll("{tmp}", tmp).replaceAll("{request_source}", REQUEST_SOURCE);
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, tmp));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, tmp)]));
  }
  return value;
}

const count = (text, part) => text.split(part).length - 1;

for (const scenario of SUITE.scenarios) {
  test(scenario.name, async () => {
    const { defaults } = SUITE;
    const tmp = await mkdtemp(join(tmpdir(), "aivana-conformance-"));
    try {
      const env = {};
      for (const [name, value] of Object.entries({ ...defaults.env, ...scenario.env })) {
        if (value !== null) env[name] = value;
      }
      for (const [name, content] of Object.entries(scenario.files || {})) {
        await writeFile(join(tmp, name), Buffer.from(content, "base64"));
      }
      const api = fakeApi(scenario.response ?? defaults.response);
      const stdout = capture();
      const stderr = capture();
      const piped = "stdin" in scenario ? scenario.stdin : defaults.stdin;

      const code = await main(fill(scenario.argv, tmp), {
        env, stdin: stdin(piped), stdout, stderr, fetch: api.fetch,
      });
      const out = stdout.text;
      const err = stderr.text;
      const expect = fill(scenario.expect, tmp);
      const shown = `\n--- exit ${code}\n--- stdout\n${out}\n--- stderr\n${err}`;

      assert.equal(code, expect.exit, `exit code${shown}`);
      if ("stdout" in expect) assert.equal(out, expect.stdout, `stdout${shown}`);
      if ("stderr" in expect) assert.equal(err, expect.stderr, `stderr${shown}`);
      for (const text of expect.stdout_contains || []) {
        assert.ok(out.includes(text), `stdout lacks ${JSON.stringify(text)}${shown}`);
      }
      for (const text of expect.stderr_contains || []) {
        assert.ok(err.includes(text), `stderr lacks ${JSON.stringify(text)}${shown}`);
      }
      for (const text of expect.stdout_excludes || []) {
        assert.ok(!out.includes(text), `stdout has ${JSON.stringify(text)}${shown}`);
      }
      for (const text of expect.stderr_excludes || []) {
        assert.ok(!err.includes(text), `stderr has ${JSON.stringify(text)}${shown}`);
      }
      if ("stdout_starts_with" in expect) {
        assert.ok(out.startsWith(expect.stdout_starts_with), `stdout prefix${shown}`);
      }
      for (const [key, value] of Object.entries(expect.stdout_json || {})) {
        assert.deepEqual(JSON.parse(out)[key], value, `stdout JSON ${key}${shown}`);
      }
      for (const [text, n] of Object.entries(expect.stderr_counts || {})) {
        assert.equal(count(err, text), n, `stderr has ${JSON.stringify(text)} x${count(err, text)}${shown}`);
      }
      if ("requests" in expect) {
        assert.equal(api.requests.length, expect.requests, `request count${shown}`);
      }
      const want = expect.request;
      if (want) {
        assert.ok(api.requests.length, `no request was made${shown}`);
        const request = api.requests.at(-1);
        if ("url" in want) assert.equal(request.url, want.url);
        for (const [header, value] of Object.entries(want.headers || {})) {
          assert.equal(request.headers[header], value, header);
        }
        for (const [key, value] of Object.entries(want.body || {})) {
          assert.deepEqual(api.sent[key], value, `body.${key}`);
        }
        if ("body_keys" in want) assert.deepEqual(Object.keys(api.sent).sort(), want.body_keys);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
}
