// The smoke test holds a production API key, and the publish workflow is gated on it. YAML cannot be unit tested, so
// these read the workflow files and the shared composite action as text and pin the properties that keep the key safe
// and the gate real. If one fails, read the comments at the top of .github/workflows/smoke.yml and
// .github/actions/production-smoke/action.yml before changing the test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../.github/${path}`, import.meta.url), "utf8");
// the comments say things like "no id-token permission"; only the YAML itself counts
const code = (text) => text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

const smokeYml = code(read("workflows/smoke.yml"));
const publishYml = code(read("workflows/publish.yml"));
const action = code(read("actions/production-smoke/action.yml"));

// the text of one top-level job, from its name to the next job (or the end of the file)
function job(text, name) {
  const start = text.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `no job named ${name}`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const smokeJobs = { "smoke.yml": job(smokeYml, "smoke"), "publish.yml": job(publishYml, "smoke") };
const publishJob = job(publishYml, "publish");

test("the manual workflow can only be started by hand, never by a pull request, a push or another workflow", () => {
  const on = smokeYml.match(/^on:\n((?:[ ]+.*\n)+)/m)[1];
  const triggers = on.split("\n").map((l) => l.trim().replace(/:$/, "")).filter(Boolean);
  assert.deepEqual(triggers, ["workflow_dispatch"]);
  assert.ok(!/pull_request|push:|schedule:|workflow_call/.test(smokeYml.split("jobs:")[0]));
});

test("the release gate is a job of publish.yml, NOT a reusable workflow: a called workflow got the key empty (v0.8.0)", () => {
  assert.ok(!/uses:\s*\.\/\.github\/workflows\//.test(publishYml), "publish.yml calls a reusable workflow again");
  assert.ok(!/workflow_call/.test(smokeYml), "smoke.yml became a reusable workflow again");
  assert.ok(!/secrets: inherit/.test(publishYml), "the gate must not be handed every repository secret");
});

for (const [file, body] of Object.entries(smokeJobs)) {
  test(`${file}: the job declares the protected environment and reads the key from it`, () => {
    assert.match(body, /\n    environment: production-smoke\n/);
    assert.match(body, /api-key: \$\{\{ secrets\.AIVANA_API_KEY \}\}/);
    assert.deepEqual([...new Set([...body.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))], ["AIVANA_API_KEY"]);
  });

  test(`${file}: the job can read the repository and nothing else, with a time limit`, () => {
    assert.ok(!/id-token/.test(body));
    assert.ok(!/: write\b/.test(body));
    assert.match(body, /timeout-minutes: \d+/);
  });
}

test("smoke.yml has read-only permissions and one run at a time that is never cancelled halfway through spending", () => {
  assert.match(smokeYml, /permissions:\n  contents: read/);
  assert.ok(!/id-token|: write\b/.test(smokeYml));
  assert.match(smokeYml, /concurrency:\n  group: production-smoke\n  cancel-in-progress: false/);
});

test("the gate in publish.yml has the same permissions and concurrency lock, set on the job", () => {
  const body = smokeJobs["publish.yml"];
  assert.match(body, /permissions:\n      contents: read/);
  assert.match(body, /concurrency:\n      group: production-smoke\n      cancel-in-progress: false/);
});

test("the key is the only secret anywhere in the smoke workflow or the gate's job", () => {
  const all = [smokeYml, smokeJobs["publish.yml"]].join("\n");
  assert.deepEqual([...new Set([...all.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))], ["AIVANA_API_KEY"]);
});

test("the composite action never reads the secrets context: the key arrives as an input", () => {
  assert.ok(!/secrets\./.test(action));
  assert.match(action, /inputs:\n  api-key:/);
});

test("the key reaches only the two steps of the action that run the script, never the install or build steps", () => {
  const steps = action.split(/\n    - name: /).slice(1);
  const withKey = steps.filter((s) => s.includes("inputs.api-key")).map((s) => s.split("\n")[0]);
  assert.deepEqual(withKey, ["Check the setup (no calls)", "Run the smoke test against production"]);
});

test("it tests the built package installed in an empty folder, with the version it expects", () => {
  assert.match(action, /npm pack --silent/);
  assert.match(action, /npm install --prefix "\$prefix"/);
  assert.match(action, /EXPECTED_SDK_VERSION=/);
  assert.equal((action.match(/working-directory: \$\{\{ env\.SMOKE_DIR \}\}/g) || []).length, 2);
});

test("both jobs use the shared action, so the manual run and the gate cannot drift apart", () => {
  for (const body of Object.values(smokeJobs)) assert.match(body, /uses: \.\/\.github\/actions\/production-smoke\n/);
});

test("publishing to npm waits for the smoke test", () => {
  assert.match(publishYml, /\n  publish:\n    needs: smoke\n/);
});

test("the publish job is still the only one that can publish (the only id-token: write)", () => {
  assert.equal((publishYml.match(/id-token: write/g) || []).length, 1);
  assert.ok(publishJob.includes("id-token: write"));
  assert.ok(!smokeJobs["publish.yml"].includes("id-token"));
});

test("the gate cannot be skipped by a condition", () => {
  assert.ok(!/\bif:/.test(smokeJobs["publish.yml"]));
  assert.ok(!/continue-on-error/.test(publishYml));
});

test("every run step of the composite action names a shell (GitHub refuses the action at run time otherwise)", () => {
  const steps = action.split(/\n    - name: /).slice(1).filter((st) => /\n      run:/.test(st));
  assert.ok(steps.length >= 4);
  for (const st of steps) assert.match(st, /\n      shell: bash\n/, `step without a shell: ${st.split("\n")[0]}`);
});

test("the composite action declares itself composite", () => {
  assert.match(action, /\nruns:\n  using: composite\n/);
});

test("the publish job installs the Chat starter's dependencies before it runs the suite, as ci.yml does (v0.8.0 stopped here)", () => {
  const steps = publishJob.split(/\n      - name: /).slice(1).map((st) => ({ name: st.split("\n")[0], text: st }));
  const names = steps.map((st) => st.name);
  const install = names.indexOf("Install the Basic AI Chat starter");
  const test = names.indexOf("Test");
  assert.ok(install >= 0, "the publish job does not install examples/basic-chat");
  assert.ok(test > install, "the starter must be installed before the suite runs");
  assert.match(steps[install].text, /npm ci --prefix examples\/basic-chat/);
  // the same command the repository's own CI uses, so the two cannot disagree about what the suite needs
  assert.match(code(read("workflows/ci.yml")), /npm ci --prefix examples\/basic-chat/);
});
