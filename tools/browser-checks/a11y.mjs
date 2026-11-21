// Accessibility audit
// axe-core over every page state, in light and dark, desktop and phone width. Exits 1 on any violation and lists what axe could not decide.
// Opt-in: not run by `npm test` or CI. See README.md in this folder.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { STARTER, FIXTURE, loadAxe, loadPlaywright } from './harness.mjs';
const { chromium } = await loadPlaywright();
const axeInfo = loadAxe();
const AXE = fs.readFileSync(axeInfo.path, 'utf8');
const RICH = ['## A heading', '', 'Text with **bold**, *italic*, `inline code` and a [link](https://example.com/docs).', '', '```js', 'const answer = await client.generate("hi"); // comment', '```', '', '| Approach | Best for |', '|---|---|', '| Debounce | search |', '', '> a quote', '', '1. one', '2. two'].join('\n');
const found = new Map(); // rule id -> { impact, help, helpUrl, states: Set, nodes: [] }
const incomplete = new Map(); let runs = 0;
(async () => {
  const { createChatServer } = await import(pathToFileURL(STARTER + 'app.mjs'));
  const bp = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')); bp.purpose = 'Answers customer questions about landscaping services.';
  const client = { async generate() { return { answer: RICH, usage: { input_tokens: 5, output_tokens: 9 }, latency_ms: 800 }; },
    async *generateStream(_p, o) {
      const m = o.messages.at(-1).content; const pause = (ms) => new Promise((r, j) => { const t = setTimeout(r, ms); o.signal.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('x', 'AbortError')); }); });
      if (m === 'hold') { await pause(60000); return; }
      await pause(150);
      const text = m === 'trickle' ? RICH.repeat(3) : RICH;
      for (let i = 0; i < text.length; i += (m === 'trickle' ? 5 : 40)) { yield { event: 'delta', data: { text: text.slice(i, i + (m === 'trickle' ? 5 : 40)) } }; if (m === 'fail' && i > 60) { yield { event: 'error', data: {} }; return; } await pause(m === 'trickle' ? 60 : 5); }
      yield { event: 'done', data: { usage: { input_tokens: 5, output_tokens: 9 } } };
    } };
  const servers = { plain: createChatServer({ client }), bp: createChatServer({ client, blueprint: bp }) };
  await Promise.all(Object.values(servers).map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  const browser = await chromium.launch();
  const audit = async (page, label) => {
    await page.evaluate(AXE);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
    runs++;
    for (const v of res.violations) { const e = found.get(v.id) ?? { impact: v.impact, help: v.help, url: v.helpUrl, states: new Set(), nodes: [] }; e.states.add(label); for (const n of v.nodes.slice(0, 2)) e.nodes.push({ label, target: n.target.join(' '), html: n.html.slice(0, 120), why: (n.failureSummary || '').split('\n').slice(0, 3).join(' | ').slice(0, 260) }); found.set(v.id, e); }
    for (const v of res.incomplete) { const e = incomplete.get(v.id) ?? { help: v.help, states: new Set(), n: 0, why: new Map() }; e.states.add(label); e.n += v.nodes.length; for (const n of v.nodes) { const m = (n.any[0] || n.all[0] || n.none[0] || {}).message || '?'; const k = m.slice(0, 110); const w = e.why.get(k) ?? { n: 0, states: new Set(), sample: n.target.join(' ') + ' :: ' + n.html.slice(0, 80) }; w.n++; w.states.add(label); e.why.set(k, w); } incomplete.set(v.id, e); }
  };
  for (const [vpName, size] of [['desktop', { width: 1280, height: 820 }], ['phone', { width: 390, height: 820 }]]) for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, bypassCSP: true }); const page = await ctx.newPage();
    const tag = (s) => `${s} ${vpName}/${scheme}`;
    const open = async (which) => { await page.goto(`http://127.0.0.1:${servers[which].address().port}/`); await page.waitForFunction(() => !document.querySelector('#message').disabled); };
    const send = async (text) => { await page.fill('#message', text); await page.click('#send'); };
    await open('plain');
    await audit(page, tag('empty'));
    await page.click('#settings summary'); await audit(page, tag('settings-open')); await page.click('#settings summary');
    await send('hold'); await page.waitForSelector('.thinking'); await audit(page, tag('thinking'));
    await page.click('#stop'); await page.waitForSelector('#send:not([hidden])');
    await page.click('#reset'); await send('trickle'); await page.waitForFunction(() => (document.querySelector('.message.assistant .markdown-body')?.textContent.length ?? 0) > 60); await audit(page, tag('streaming'));
    await page.click('#stop'); await page.waitForSelector('.message.is-stopped'); await audit(page, tag('stopped'));
    await page.click('#reset'); await send('rich'); await page.waitForSelector('[data-action="regenerate"]', { timeout: 20000 }); await audit(page, tag('complete-rich'));
    await page.click('#session-details summary'); await audit(page, tag('session-details-open'));
    await page.click('#reset'); await send('fail'); await page.waitForSelector('.message.is-interrupted', { timeout: 20000 }); await audit(page, tag('interrupted'));
    // long conversation: the jump control
    await page.click('#reset'); await page.evaluate(() => { document.querySelector('#message').value = ''; });
    await open('bp'); await audit(page, tag('blueprint-empty')); await page.click('#settings summary'); await audit(page, tag('blueprint-settings-open'));
    await ctx.close();
  }
  await browser.close(); Object.values(servers).forEach((s) => { s.closeAllConnections(); s.close(); });
  console.log(`axe ${axeInfo.version}: ${runs} audits (states x viewports x themes)\n`);
  if (!found.size) console.log('NO VIOLATIONS');
  for (const [id, e] of [...found].sort((a, b) => b[1].states.size - a[1].states.size)) {
    console.log(`VIOLATION  ${id}  [${e.impact}]  in ${e.states.size} state(s): ${e.help}`);
    const seen = new Set(); for (const n of e.nodes) { const k = n.target; if (seen.has(k) || seen.size >= 3) continue; seen.add(k); console.log(`   - ${n.target}\n     ${n.html}\n     ${n.why}`); }
  }
  console.log('\nNEEDS-REVIEW (axe could not decide), with its stated reason:');
  for (const [id, e] of incomplete) { console.log(`  ${id}  x${e.n} in ${e.states.size} states`); for (const [m, w] of e.why) console.log(`     ${w.n} x "${m}"\n        e.g. ${w.sample}` + (/obscured/.test(m) ? `\n        in: ${[...w.states].join('; ')}` : '')); }
  process.exit(found.size ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
