// Chat flow
// The page, the starter server and a scripted fake client: Thinking to streaming, Copy fidelity, Regenerate, Interrupted and Retry, Stop, smart scroll and Jump to latest, settings, the Blueprint view, and no console or CSP errors.
// Opt-in: not run by `npm test` or CI. See README.md in this folder.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { STARTER, FIXTURE, loadPlaywright, outDir } from './harness.mjs';
const { chromium } = await loadPlaywright();
const OUT = outDir();
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MD = [
  '## Debounce in JavaScript', '',
  'A **debounce** delays a call until input stops. See [MDN](https://developer.mozilla.org/) and `clearTimeout`.', '',
  '<script>window.__pwned = 1</script>', '',
  '```js', 'function debounce(fn, wait = 200) {', '  let timer; // keep the handle', '  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };', '}', '```', '',
  '| Approach | Best for |', '|---|---|', '| Debounce | search boxes |', '| Throttle | scroll handlers |', '',
  '1. First', '2. Second',
].join('\n');
const LONG = Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1}: streaming keeps adding text so the transcript grows beyond one screen.`).join('\n\n');

(async () => {
  const { createChatServer } = await import(pathToFileURL(STARTER + 'app.mjs'));
  const calls = []; const failedOnce = new Set();
  const client = {
    async generate(_p, o) { calls.push({ kind: 'generate', messages: o.messages.map((m) => m.content), o }); return { answer: MD, intent: { name: 'analysis' }, usage: { input_tokens: 21, output_tokens: 99, credits: 0.2 }, latency_ms: 2400 }; },
    async *generateStream(_p, o) {
      const last = o.messages.at(-1).content;
      calls.push({ kind: 'stream', messages: o.messages.map((m) => m.content), o });
      const text = last.includes('long') ? LONG : MD;
      const pause = (ms) => new Promise((r, j) => { const t = setTimeout(r, ms); o.signal.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('x', 'AbortError')); }); });
      await pause(last.includes('slow') ? 1500 : 500);
      const step = last.includes('long') ? 60 : 14;
      for (let i = 0; i < text.length; i += step) {
        yield { event: 'delta', data: { text: text.slice(i, i + step) } };
        if (last.includes('fail') && !failedOnce.has(last) && i > 40) { failedOnce.add(last); yield { event: 'error', data: { message: 'secret provider detail' } }; return; }
        await pause(last.includes('long') ? 25 : 12);
      }
      yield { event: 'done', data: { usage: { input_tokens: 21, output_tokens: 99, credits: 0.2 }, latency_ms: 2400, intent: { name: 'analysis' } } };
    },
  };
  const bpDef = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  bpDef.purpose = 'Answers customer questions about our landscaping services.'; bpDef.configuration.effort = 'high'; bpDef.configuration.max_tokens = 1200; bpDef.configuration.web_search = true;
  const plain = createChatServer({ client }); const bp = createChatServer({ client, blueprint: bpDef });
  await Promise.all([plain, bp].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  const url = (s) => `http://127.0.0.1:${s.address().port}/`;
  const browser = await chromium.launch();
  const ready = (page) => page.waitForFunction(() => !document.querySelector('#message').disabled);
  const send = async (page, text) => { await page.fill('#message', text); await page.click('#send'); };
  const state = (page) => page.evaluate(() => ({ stopHidden: document.querySelector('#stop').hidden, sendHidden: document.querySelector('#send').hidden, thinking: !!document.querySelector('.thinking'), caret: !!document.querySelector('.caret'), text: document.querySelector('.message.assistant.live .markdown-body')?.textContent.length ?? 0 }));

  // ---- A. empty state, light/dark, desktop/phone
  for (const [vp, size] of [['desktop', { width: 1280, height: 820 }], ['phone', { width: 390, height: 800 }]]) for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: scheme }); const page = await ctx.newPage();
    const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url(plain)); await ready(page);
    if (vp === 'desktop' && scheme === 'light') {
      const t = await page.evaluate(() => ({ kicker: document.querySelector('#empty-kicker-text').textContent, h1: document.querySelector('#empty-title').textContent, p: document.querySelector('#empty-text').textContent, chips: [...document.querySelectorAll('.suggestion')].map((b) => b.textContent), powered: document.querySelector('.powered').textContent.trim(), links: [...document.querySelectorAll('.footer-links a')].map((a) => a.textContent) }));
      check('empty state copy', t.kicker === 'Build with Aivana Intelligence' && t.h1 === 'Your AI chat starter is ready.' && t.p.startsWith('Experiment with intelligent responses'), JSON.stringify(t.chips));
      check('four product-oriented prompts', t.chips.join('|') === 'Explain a complex topic|Generate sample code|Compare two approaches|Build a project plan');
      check('developer identity + links', /Powered by Aivana MMI API/.test(t.powered) && t.links.join('|') === 'View source code ↗|API documentation ↗', t.powered);
    }
    await page.screenshot({ path: `${OUT}/A-empty-${vp}-${scheme}.png` });
    check(`no console errors/CSP violations (empty ${vp} ${scheme})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- B-F. main chat flow on a phone-width, light
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url(plain)); await ready(page);
  await send(page, 'explain debounce');
  await page.waitForSelector('.thinking');
  let s = await state(page);
  check('Thinking… shows first, with Stop available (Send hidden)', s.thinking && !s.stopHidden && s.sendHidden);
  await page.screenshot({ path: `${OUT}/B-thinking.png` });
  await page.waitForFunction(() => !document.querySelector('.thinking'));
  s = await state(page);
  check('Thinking becomes streaming text, Stop still available', !s.thinking && s.text > 0 && !s.stopHidden && s.caret);
  await sleep(250); await page.screenshot({ path: `${OUT}/B-streaming.png` });
  await page.waitForSelector('.message-actions [data-action="regenerate"]');
  s = await state(page);
  check('after completion: Send back, Stop gone, caret gone', !s.sendHidden && s.stopHidden && !s.caret);
  const dom = await page.evaluate(() => ({ pwned: window.__pwned, scriptEls: document.querySelectorAll('.markdown-body script').length, h3: document.querySelector('.markdown-body h4')?.textContent, link: (() => { const a = document.querySelector('.markdown-body a'); return a && { href: a.href, rel: a.rel, target: a.target }; })(), tokens: [...document.querySelectorAll('.code-block [class^="tok-"]')].map((e) => e.className).filter((v, i, a) => a.indexOf(v) === i), table: !!document.querySelector('.table-wrap table th'), ol: document.querySelector('.markdown-body ol')?.children.length, rawScriptText: document.querySelector('.markdown-body').textContent.includes('<script>window.__pwned = 1</script>') }));
  check('Markdown rendered; raw <script> shown as text and never run', dom.pwned === undefined && dom.scriptEls === 0 && dom.rawScriptText, JSON.stringify({ h: dom.h3, ol: dom.ol, table: dom.table }));
  check('safe link attributes', dom.link && dom.link.target === '_blank' && /noopener/.test(dom.link.rel), JSON.stringify(dom.link));
  check('code is syntax highlighted', ['tok-keyword', 'tok-comment'].every((c) => dom.tokens.includes(c)), dom.tokens.join(','));
  const toolbar = await page.evaluate(() => ({ btns: [...document.querySelectorAll('.message-actions .action')].map((b) => b.textContent), note: document.querySelector('#regen-note')?.textContent, described: document.querySelector('[data-action="regenerate"]').getAttribute('aria-describedby') }));
  check('toolbar: Copy + Regenerate, with billable note', toolbar.btns.join('|') === 'Copy|Regenerate' && /new request/.test(toolbar.note) && /uses credit/.test(toolbar.note) && toolbar.described === 'regen-note', toolbar.note);
  await page.click('.message-actions [data-action="copy"]');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy preserves the original Markdown exactly', copied === MD, `${copied.length} vs ${MD.length} chars`);
  await page.click('.code-copy');
  const codeCopied = await page.evaluate(() => navigator.clipboard.readText());
  check('code-block Copy copies exactly the code', codeCopied.startsWith('function debounce') && codeCopied.endsWith('}') && !codeCopied.includes('```'), JSON.stringify(codeCopied.slice(0, 30)));
  const sd = await page.evaluate(() => ({ hidden: document.querySelector('#session-details').hidden, text: document.querySelector('#session-list').textContent }));
  check('Session details: tokens and time, never credits', !sd.hidden && /Input tokens\s*21/.test(sd.text) && /Output tokens\s*99/.test(sd.text) && /Response time\s*2\.4 s/.test(sd.text) && !/credit/i.test(sd.text), sd.text);
  await page.screenshot({ path: `${OUT}/B-complete.png` });

  // D. regenerate
  const before = calls.length;
  await page.click('[data-action="regenerate"]');
  await page.waitForSelector('.thinking');
  const during = await page.evaluate(() => ({ regenDisabledOrGone: !document.querySelector('[data-action="regenerate"]') || document.querySelector('[data-action="regenerate"]').disabled, bubbles: document.querySelectorAll('.message').length }));
  await page.waitForSelector('.message-actions [data-action="regenerate"]:not([disabled])');
  check('Regenerate sent ONE new request with only the question (old answer discarded)', calls.length === before + 1 && JSON.stringify(calls.at(-1).messages) === JSON.stringify(['explain debounce']), JSON.stringify(calls.at(-1).messages));
  check('Regenerate replaces the answer (still one exchange on screen)', during.bubbles === 2 && (await page.$$('.message.assistant')).length === 1);

  // E. interrupted + retry
  await page.click('#reset');
  await send(page, 'please fail midway');
  await page.waitForSelector('.message.is-interrupted');
  const intr = await page.evaluate(() => ({ chip: document.querySelector('.state-chip.interrupted')?.textContent, partial: document.querySelector('.message.is-interrupted .markdown-body').textContent.length, retry: document.querySelector('[data-action="retry"]')?.textContent, note: document.querySelector('#retry-note')?.textContent, error: document.querySelector('#error').textContent, errHidden: document.querySelector('#error').hidden, leaked: document.body.textContent.includes('secret provider detail'), saved: document.querySelectorAll('[data-action="regenerate"]').length }));
  check('failure keeps partial visible, labelled Interrupted, with Retry (billable note)', intr.chip === 'Interrupted' && intr.partial > 0 && intr.retry === 'Retry' && /uses credit/.test(intr.note) && !intr.errHidden && !intr.leaked, JSON.stringify({ partial: intr.partial }));
  check('interrupted output is not saved (no completed-answer toolbar)', intr.saved === 0);
  await page.screenshot({ path: `${OUT}/E-interrupted.png` });
  const n0 = calls.length;
  await page.fill('#message', 'a fresh follow up'); // typed after the failure: must survive a Retry
  await page.click('[data-action="retry"]');
  await page.waitForSelector('.message-actions [data-action="regenerate"]');
  check('Retry sent ONE new request: the same message, unchanged history, and it completed', calls.length === n0 + 1 && JSON.stringify(calls.at(-1).messages) === JSON.stringify(['please fail midway']), JSON.stringify(calls.at(-1).messages));
  check('Retry never wipes what was typed since', (await page.inputValue('#message')) === 'a fresh follow up');

  // F. smart scroll
  await page.click('#reset');
  await send(page, 'a long answer');
  await page.waitForFunction(() => document.querySelector('#transcript').scrollHeight > document.querySelector('#transcript').clientHeight + 200);
  await sleep(300);
  const follow1 = await page.evaluate(() => { const t = document.querySelector('#transcript'); return t.scrollHeight - t.scrollTop - t.clientHeight; });
  check('follows the answer while streaming', follow1 < 80, `${Math.round(follow1)}px from bottom`);
  const composerBefore = await page.evaluate(() => Math.round(document.querySelector('#composer').getBoundingClientRect().bottom));
  await page.evaluate(() => { const t = document.querySelector('#transcript'); t.scrollTop = 0; });
  await sleep(500);
  const pos1 = await page.evaluate(() => document.querySelector('#transcript').scrollTop);
  await sleep(700);
  const pos2 = await page.evaluate(() => document.querySelector('#transcript').scrollTop);
  const jumpShown = await page.evaluate(() => !document.querySelector('#jump').hidden);
  check('scrolling up stops auto-scroll while it keeps streaming', pos2 < 120 && Math.abs(pos2 - pos1) < 120 && jumpShown, `scrollTop ${Math.round(pos1)} -> ${Math.round(pos2)}`);
  const composerAfter = await page.evaluate(() => Math.round(document.querySelector('#composer').getBoundingClientRect().bottom));
  const pageScrolls = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1 || document.body.scrollHeight > innerHeight + 1);
  check('composer stays anchored while the transcript scrolls independently', composerBefore === composerAfter && !pageScrolls, `${composerBefore} -> ${composerAfter}`);
  await page.screenshot({ path: `${OUT}/F-scrolled-up-jump.png` });
  await page.click('#jump');
  await sleep(600);
  const atBottom = await page.evaluate(() => { const t = document.querySelector('#transcript'); return { gap: t.scrollHeight - t.scrollTop - t.clientHeight, jumpHidden: document.querySelector('#jump').hidden }; });
  check('Jump to latest returns to the newest text and hides itself', atBottom.gap < 80 && atBottom.jumpHidden, JSON.stringify(atBottom));
  await page.click('#stop');
  await page.waitForSelector('.message.is-stopped');
  check('Stop keeps text, labelled Stopped', !!(await page.$('.state-chip.stopped')));
  check(`no console errors/CSP violations (chat flow)`, errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---- G. settings (plain)
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 820 } }); const p2 = await c2.newPage();
  await p2.goto(url(plain)); await ready(p2);
  await p2.click('summary');
  const g = await p2.evaluate(() => ({ title: document.querySelector('.settings-head h2').textContent, badge: document.querySelector('.demo-badge').textContent, effort: document.querySelector('#effort').value, help: document.querySelector('#effort-help').textContent, length: document.querySelector('#length-help').textContent, search: document.querySelector('#search-help').textContent, stream: document.querySelector('#stream-help').textContent, summary: document.querySelector('#settings-summary').textContent, searchOn: document.querySelector('#web-search').checked, streamOn: document.querySelector('#streaming').checked }));
  check('settings panel is educational with the requested copy', g.title === 'Intelligence settings' && g.badge === 'Demo controls' && g.effort === 'auto' && g.help === 'Aivana determines the appropriate intelligence effort for each request.' && g.length === 'Controls the maximum output tokens, not a guaranteed response length.' && g.search === 'Allow Aivana to retrieve current information.' && g.stream === 'Display the answer progressively as it arrives.', JSON.stringify(g));
  check('defaults: Auto, search off, streaming on, panel collapsed by default', g.effort === 'auto' && !g.searchOn && g.streamOn && g.summary === '' && (await (async () => { const c = await browser.newContext(); const pg = await c.newPage(); await pg.goto(url(plain)); const open = await pg.evaluate(() => document.querySelector('#settings').open); await c.close(); return !open; })()));
  await p2.selectOption('#effort', 'high'); await p2.check('#web-search');
  const g2 = await p2.evaluate(() => ({ help: document.querySelector('#effort-help').textContent, summary: document.querySelector('#settings-summary').textContent }));
  check('effort help text and summary update', /deeper reasoning/.test(g2.help) && /High effort/.test(g2.summary) && /Web search/.test(g2.summary), JSON.stringify(g2));
  check('effort help makes no claim about models or price', !/model|perspective|price|cost/i.test(g2.help + g.help));
  await p2.screenshot({ path: `${OUT}/G-settings-open.png` });
  await p2.click('#settings-reset');
  check('Reset to defaults', (await p2.evaluate(() => document.querySelector('#effort').value + document.querySelector('#web-search').checked)) === 'autofalse');
  // settings actually reach the SDK
  await p2.selectOption('#effort', 'low'); await p2.selectOption('#max-tokens', '1600'); await p2.check('#web-search');
  await send(p2, 'check settings'); await p2.waitForSelector('.message-actions');
  const o = calls.at(-1).o;
  check('chosen settings are what the SDK receives', o.effort === 'low' && o.maxTokens === 1600 && o.webSearch === true, JSON.stringify({ e: o.effort, m: o.maxTokens, w: o.webSearch }));
  await c2.close();

  // ---- H. blueprint
  for (const [vp, size] of [['desktop', { width: 1280, height: 820 }], ['phone', { width: 390, height: 820 }]]) {
    const c3 = await browser.newContext({ viewport: size, colorScheme: vp === 'phone' ? 'dark' : 'light' }); const p3 = await c3.newPage();
    await p3.goto(url(bp)); await ready(p3); await p3.click('summary');
    const h = await p3.evaluate(() => ({ kicker: document.querySelector('#empty-kicker-text').textContent, h1: document.querySelector('#empty-title').textContent, p: document.querySelector('#empty-text').textContent, chipsHidden: document.querySelector('#suggestions').hidden, ro: !document.querySelector('#blueprint-settings').hidden, fieldsetHidden: document.querySelector('#chat-settings').hidden, rows: [...document.querySelectorAll('#blueprint-settings dd')].map((d) => d.textContent), summary: document.querySelector('#settings-summary').textContent, anyDisabledLooking: [...document.querySelectorAll('#settings select:disabled, #settings input:disabled')].length }));
    if (vp === 'desktop') check('Blueprint: purpose replaces the welcome, generic prompts hidden', h.kicker === 'Loaded from Agent Kit' && h.p === 'Answers customer questions about our landscaping services.' && h.chipsHidden, JSON.stringify({ h1: h.h1 }));
    check(`Blueprint settings read-only, not "broken" (${vp})`, h.ro && h.fieldsetHidden && h.rows.join('|') === 'High|Up to 1,200 tokens|Allowed' && h.anyDisabledLooking === 0, JSON.stringify(h.rows));
    await p3.screenshot({ path: `${OUT}/H-blueprint-${vp}.png` });
    if (vp === 'desktop') { await send(p3, 'hi'); await p3.waitForSelector('.message-actions'); const bo = calls.at(-1).o; check('Blueprint options reach the SDK unchanged', bo.effort === 'high' && bo.maxTokens === 1200 && bo.webSearch === true && typeof bo.system === 'string'); }
    await c3.close();
  }
  await browser.close(); plain.closeAllConnections(); bp.closeAllConnections(); plain.close(); bp.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
