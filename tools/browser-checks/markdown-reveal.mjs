// Markdown reveal
// While text is typed out, raw Markdown markers (**, `, [, ](, ~~) are never visible on screen.
// Opt-in: not run by `npm test` or CI. See README.md in this folder.
import { pathToFileURL } from 'node:url';
import { STARTER, loadPlaywright } from './harness.mjs';
const { chromium } = await loadPlaywright();
const SRC = 'Here is **a bold phrase that runs on for a while** and `someCode(withArgs)` and a [link to the docs](https://example.com/docs/page) and ~~old text here~~ plus a final plain sentence to finish.';
(async () => {
  const { createChatServer } = await import(pathToFileURL(STARTER + 'app.mjs'));
  const client = { async generate() { return { answer: SRC }; },
    async *generateStream(_p, o) {
      const pause = (ms) => new Promise((r, j) => { const t = setTimeout(r, ms); o.signal.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('x', 'AbortError')); }); });
      await pause(200);
      for (let i = 0; i < SRC.length; i += 6) { yield { event: 'delta', data: { text: SRC.slice(i, i + 6) } }; await pause(30); }   // slow trickle: pieces land mid-span
      yield { event: 'done', data: {} };
    } };
  const server = createChatServer({ client }); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => !document.querySelector('#message').disabled);
  await page.evaluate(() => { window.__bad = new Set(); window.__n = 0; window.__i = setInterval(() => { const el = document.querySelector('.message.assistant .markdown-body'); if (!el) return; window.__n++; const t = el.textContent; for (const m of ['**', '`', '](', '[', '~~']) if (t.includes(m)) window.__bad.add(m + ' in "…' + t.slice(-30) + '"'); }, 6); });
  await page.fill('#message', 'trickle'); await page.click('#send');
  await page.waitForSelector('[data-action="regenerate"]', { timeout: 20000 });
  const r = await page.evaluate(() => { clearInterval(window.__i); const el = document.querySelector('.message.assistant .markdown-body'); return { samples: window.__n, bad: [...window.__bad].slice(0, 4), final: el.textContent, strong: !!el.querySelector('strong'), code: !!el.querySelector('code.md-inline-code'), a: el.querySelector('a')?.getAttribute('href'), del: !!el.querySelector('del') }; });
  const ok = r.bad.length === 0 && r.strong && r.code && r.a === 'https://example.com/docs/page' && r.del && r.final.includes('final plain sentence to finish.');
  console.log(`${ok ? 'PASS' : 'FAIL'}  no raw markers ever shown while ${r.samples} on-screen samples were taken`, r.bad.length ? '\n   raw markers seen: ' + JSON.stringify(r.bad) : '');
  console.log(`       final render ok: strong=${r.strong} code=${r.code} link=${r.a} del=${r.del}`);
  await browser.close(); server.closeAllConnections(); server.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
