import { copyFile, chmod, constants } from 'node:fs/promises';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 6)) {
  console.error('Install Node.js 20.6 or newer, then run setup again.');
  process.exitCode = 1;
} else {
  const target = new URL('.env', import.meta.url);
  try {
    await copyFile(new URL('.env.example', import.meta.url), target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
    console.log('Created .env. Add your own AIVANA_API_KEY in your editor.');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Kept your existing .env unchanged.');
  }
  console.log('Next: npm ci, edit .env, npm run doctor, then npm start.');
}
