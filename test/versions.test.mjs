// @aivana/cli is released in lockstep with the SDK and depends on exactly the same
// version, so these fields must always agree. `npm version` keeps them in step
// (tools/sync-cli-version.mjs); this catches a hand edit that missed one on the
// pull request, instead of at release time, when publish.yml would refuse the tag.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

test("the SDK, its lockfile and the CLI all carry the same version", () => {
  const version = read("package.json").version;
  const lock = read("package-lock.json");
  const cli = read("cli/package.json");
  assert.equal(lock.version, version, "package-lock.json version");
  assert.equal(lock.packages[""].version, version, "package-lock.json packages[\"\"].version");
  assert.equal(cli.version, version, "cli/package.json version");
  assert.equal(cli.dependencies["@aivana/sdk"], version, "cli/package.json @aivana/sdk dependency");
});
