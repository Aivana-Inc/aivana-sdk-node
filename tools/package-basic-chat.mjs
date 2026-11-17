import { copyFile, mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const FILES = ['package.json', 'package-lock.json', '.env.example', '.gitignore',
  'verify-live.mjs', 'server.mjs', 'config.mjs', 'app.mjs', 'setup.mjs', 'doctor.mjs', 'README.md',
  'public/app.js', 'public/conversation.mjs', 'public/index.html', 'public/styles.css', 'public/assets/aivana-logo.avif', 'public/assets/aivana-sparkle.avif', 'public/assets/README.md'];
export async function packageChat(destination, source = fileURLToPath(new URL('../examples/basic-chat/', import.meta.url))) {
  const target = resolve(destination);
  // Refuse to mix a release with any pre-existing files, including an old .env.
  await mkdir(target);
  const sha256 = {};
  for (const file of FILES) {
    const from = resolve(source, file);
    if (!(await lstat(from)).isFile()) throw new Error('Release inputs must be regular files.');
    await mkdir(dirname(resolve(target, file)), { recursive: true });
    await copyFile(from, resolve(target, file));
    sha256[file] = createHash('sha256').update(await readFile(from)).digest('hex');
  }
  await copyFile(new URL('../LICENSE', import.meta.url), resolve(target, 'LICENSE'));
  sha256.LICENSE = createHash('sha256').update(await readFile(resolve(target, 'LICENSE'))).digest('hex');
  await writeFile(resolve(target, 'MANIFEST.json'), JSON.stringify({ formatVersion: 1,
    version: JSON.parse(await readFile(resolve(source, 'package.json'))).version, sha256 }, null, 2) + '\n');
  return target;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node tools/package-basic-chat.mjs NEW_OUTPUT_DIRECTORY');
  console.log(await packageChat(process.argv[2]));
}
