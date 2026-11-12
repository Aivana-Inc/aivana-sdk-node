// Runs the Node SDK validation suite and writes results/matrix.md, matrix.csv, evidence.jsonl.
//   node run.mjs                 all cases (live ones skip without AIVANA_API_KEY)
//   node run.mjs STR             only cases whose ID or title matches /STR/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RateLimitError } from "@aivana/sdk";
import { runAll, ROOT } from "./lib/harness.mjs";
import "./tests/offline.mjs";
import { LIVE_BASE } from "./tests/live.mjs";
import "./tests/cli.mjs";
import "./tests/docs_snippets.mjs";

const v = JSON.parse(readFileSync(join(ROOT, "node_modules/@aivana/sdk/package.json"), "utf8")).version;
const meta = `@aivana/sdk ${v} | Node ${process.versions.node} | ${process.platform} | live base ${LIVE_BASE}`;
console.log(meta + "\n");
const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
await runAll({ meta, filter, isRateLimit: (e) => e instanceof RateLimitError,
               pace: Number(process.env.AIVANA_LIVE_PACE || 6) * 1000 });
process.exit(0);
