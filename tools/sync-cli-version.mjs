// Keeps @aivana/cli in lockstep with the SDK. `npm version` runs this (the
// "version" script in package.json) after it has bumped package.json and
// package-lock.json, so one command updates all four version fields: it copies
// the new version into cli/package.json, as the CLI's own version and as its
// exact @aivana/sdk dependency.
import { readFileSync, writeFileSync } from "node:fs";

const root = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const path = new URL("../cli/package.json", import.meta.url);
const cli = JSON.parse(readFileSync(path, "utf8"));

cli.version = root.version;
cli.dependencies["@aivana/sdk"] = root.version;
writeFileSync(path, `${JSON.stringify(cli, null, 2)}\n`);
console.log(`cli/package.json: version and @aivana/sdk dependency set to ${root.version}`);
