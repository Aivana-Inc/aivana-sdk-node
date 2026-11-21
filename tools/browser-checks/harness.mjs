// Shared helpers for the opt-in browser checks. See README.md in this folder.
//
// Playwright and axe-core are deliberately NOT dependencies of this repository (the SDK has none, and these
// checks are not part of `npm test` or CI). They are loaded here only when you run a check, with a clear message
// if they are missing.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const STARTER = join(ROOT, 'examples/basic-chat/');
export const FIXTURE = join(ROOT, 'test/fixtures/basic-chat/agent-kit-definition.json');
const require = createRequire(import.meta.url);

function missing(what, install) {
  console.error(`\n${what} is not installed. These checks are opt-in and the repository does not depend on it.\nInstall it without changing package.json:\n\n    ${install}\n`);
  process.exit(2);
}

/** Playwright, with Chromium. */
export async function loadPlaywright() {
  try { return require('playwright'); }
  catch { return missing('Playwright', 'npm install --no-save playwright && npx playwright install chromium'); }
}

/** The path of axe-core's browser script, and its version. */
export function loadAxe() {
  try { return { path: require.resolve('axe-core/axe.min.js'), version: require('axe-core/package.json').version }; }
  catch { return missing('axe-core', 'npm install --no-save axe-core'); }
}

/** Where screenshots go: the first argument, else a folder under the system temp directory. */
export function outDir() {
  const dir = process.argv.find((arg, i) => i >= 2 && !arg.startsWith('--')) ?? join(tmpdir(), 'basic-chat-browser-checks');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const hasFlag = (name) => process.argv.includes(name);
