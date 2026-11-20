// The smoke workflow holds a production API key, and the publish workflow is gated on it. YAML cannot be unit
// tested, so these read the two files as text and pin the properties that keep the key safe and the gate real.
// If one fails, read the comment at the top of .github/workflows/smoke.yml before changing the test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
const smoke = read("smoke.yml");
const publish = read("publish.yml");
// the comments say things like "no id-token permission"; only the YAML itself counts
const code = (text) => text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

test("the smoke workflow can only be started by hand or by the publish gate, never by a pull request or a push", () => {
  const on = code(smoke).match(/^on:\n((?:[ ]+.*\n)+)/m)[1];
  const triggers = on.split("\n").map((l) => l.trim().replace(/:$/, "")).filter(Boolean);
  assert.deepEqual(triggers.sort(), ["workflow_call", "workflow_dispatch"]);
  assert.ok(!/pull_request|push:|schedule:/.test(code(smoke).split("jobs:")[0]));
});

test("the key lives in a protected environment and is never a plain repository secret reference outside it", () => {
  assert.match(code(smoke), /environment: production-smoke/);
  assert.match(code(smoke), /secrets\.AIVANA_API_KEY/);
  const others = [...code(smoke).matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(others)], ["AIVANA_API_KEY"]);
});

test("the key reaches only the two steps that run the script, never the install or build steps", () => {
  const steps = code(smoke).split(/\n      - name: /).slice(1);
  const withKey = steps.filter((s) => s.includes("secrets.AIVANA_API_KEY")).map((s) => s.split("\n")[0]);
  assert.deepEqual(withKey, ["Check the setup (no calls)", "Run the smoke test against production"]);
});

test("the job can read the repository and nothing else: no id-token, no write permission", () => {
  assert.ok(!/id-token/.test(code(smoke)));
  assert.ok(!/: write\b/.test(code(smoke)));
  assert.match(code(smoke), /permissions:\n  contents: read/);
});

test("only one run at a time, and a run in progress is never cancelled halfway through spending", () => {
  assert.match(code(smoke), /concurrency:\n  group: production-smoke\n  cancel-in-progress: false/);
});

test("it tests the built package installed in an empty folder, with the version it expects", () => {
  assert.match(code(smoke), /npm pack --silent/);
  assert.match(code(smoke), /npm install --prefix "\$prefix"/);
  assert.match(code(smoke), /EXPECTED_SDK_VERSION=/);
  assert.match(code(smoke), /working-directory: \$\{\{ env\.SMOKE_DIR \}\}/);
});

test("the job has a time limit", () => {
  assert.match(code(smoke), /timeout-minutes: \d+/);
});

test("publishing to npm waits for the smoke test, and the gate is passed no repository secrets", () => {
  const c = code(publish);
  assert.match(c, /\n  smoke:\n    uses: \.\/\.github\/workflows\/smoke\.yml\n/);
  assert.match(c, /\n  publish:\n    needs: smoke\n/);
  assert.ok(!/secrets: inherit/.test(c), "the smoke job must not be handed every repository secret");
});

test("the publish job is still the only one that can publish (the only id-token: write)", () => {
  const c = code(publish);
  assert.equal((c.match(/id-token: write/g) || []).length, 1);
  const before = c.split("\n  publish:\n")[0];
  assert.ok(!before.includes("id-token"), "the smoke job came to hold id-token");
});

test("the gate cannot be skipped by a condition", () => {
  const smokeJob = code(publish).split("\n  publish:\n")[0].split("\n  smoke:\n")[1];
  assert.ok(!/\bif:/.test(smokeJob));
  assert.ok(!/continue-on-error/.test(code(publish)));
});
