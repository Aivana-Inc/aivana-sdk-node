// Runs the Node SDK validation suite and writes results/matrix.md, matrix.csv, evidence.jsonl.
//   node run.mjs                 all cases (live ones skip without AIVANA_API_KEY)
//   node run.mjs STR             only cases whose ID or title contains STR (plain text, any case)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RateLimitError } from "@aivana/sdk";
import { runAll, verdict, ROOT } from "./lib/harness.mjs";
import "./tests/offline.mjs";
import { LIVE_BASE } from "./tests/live.mjs";
import "./tests/cli.mjs";
import "./tests/docs_snippets.mjs";

const versionOf = (pkg) => {
  try { return JSON.parse(readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf8")).version; }
  catch { return "not installed"; }
};
const v = versionOf("@aivana/sdk");
const cliV = versionOf("@aivana/cli");
const meta = `@aivana/sdk ${v} | @aivana/cli ${cliV} | Node ${process.versions.node} | ${process.platform} | live base ${LIVE_BASE}`;
console.log(meta + "\n");

// A gate must test the release candidate, not whatever happens to be in node_modules.
for (const [name, have, want] of [["SDK", v, process.env.AIVANA_EXPECT_SDK_VERSION],
                                  ["CLI", cliV, process.env.AIVANA_EXPECT_CLI_VERSION]]) {
  if (want && have !== want) {
    console.error(`SETUP PROBLEM: installed ${name} is ${have}, expected ${want} (AIVANA_EXPECT_${name}_VERSION). Nothing was run.`);
    process.exit(2);
  }
}

const filter = process.argv[2] || null;
const rows = await runAll({ meta, filter, isRateLimit: (e) => e instanceof RateLimitError,
                            pace: Number(process.env.AIVANA_LIVE_PACE || 6) * 1000 });

const { code, reasons } = verdict(rows, { requireLive: process.env.AIVANA_REQUIRE_LIVE === "1" });
for (const r of rows.filter((r) => r.result.startsWith("FIXED?"))) {
  console.log(`NOTICE  ${r.id} now passes (${r.finding}): the SDK changed, so update the known-defect list and the report`);
}
console.log(code === 0 ? "\nVERDICT: no unexpected failures (exit 0)" : `\nVERDICT: ${reasons.join("; ")} (exit ${code})`);
process.exit(code);
