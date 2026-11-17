import { readConfiguration } from './config.mjs';
try {
  await import('@aivana/sdk');
  await import('./app.mjs');
  const { port } = readConfiguration();
  console.log(`Local configuration and dependencies are ready. Start with npm start, then open http://127.0.0.1:${port}.`);
  console.log('No API request was made. Key validity, account credit and port availability are checked when used.');
} catch {
  console.error('Not ready. Run npm ci and check AIVANA_API_KEY, AIVANA_API_BASE and PORT in your local .env.');
  process.exitCode = 1;
}
