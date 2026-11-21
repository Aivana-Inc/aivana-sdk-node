// Runs the opt-in browser checks one after another and prints a summary. Exits 1 if any failed.
//
//   node tools/browser-checks/run.mjs [OUTPUT_DIR]                  the checks that need no API key (free, offline)
//   node tools/browser-checks/run.mjs --live --billable [OUTPUT_DIR]  also the live check (needs AIVANA_API_KEY; uses credit)
//
// Not run by `npm test` or CI. See README.md in this folder.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasFlag, outDir } from './harness.mjs';

const live = hasFlag('--live');
if (live && !hasFlag('--billable')) {
  console.error('--live sends real requests and uses account credit. Add --billable to confirm.');
  process.exit(3);
}
const out = outDir();
const checks = ['chat-flow', 'typing-animation', 'markdown-reveal', 'keyboard', 'a11y', ...(live ? ['live'] : [])];
const summary = [];
for (const name of checks) {
  console.log(`\n==================== ${name} ====================`);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url)), out, ...(name === 'live' ? ['--billable'] : [])], { stdio: 'inherit' });
  summary.push([name, child.status]);
}
console.log('\n==================== summary ====================');
for (const [name, status] of summary) console.log(`${status === 0 ? 'PASS' : 'FAIL'}  ${name}${status === 0 ? '' : ` (exit ${status})`}`);
console.log(`screenshots: ${out}`);
process.exit(summary.every(([, status]) => status === 0) ? 0 : 1);
