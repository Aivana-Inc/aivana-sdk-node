// Live check: the real page, the real starter server and the real SDK against a real Aivana API.
//
// BILLABLE. It sends about four short requests (two are cut off early) and uses account credit, so it does nothing
// without --billable. The key is read from AIVANA_API_KEY and is never printed or logged; AIVANA_API_BASE is optional
// (blank is the SDK's production default). Needs `npm ci` in examples/basic-chat for the SDK the starter uses.
//
// What it proves, against the real stream:
//   1. A request streams and completes: "Thinking" first, Stop available throughout, text typed out over many frames,
//      the toolbar only after the text has caught up, tokens in Session details and no credits, settings sent as chosen.
//   2. Stop keeps the partial text, labelled Stopped, and the cancellation reaches the SDK.
//   3. A dropped connection mid-answer shows Interrupted with a Retry, the abandoned request is cancelled, and Retry
//      sends exactly one new request with the same message and unchanged history. (The connection between the browser
//      and the starter is severed after the first text; the call to the API itself is real.)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { STARTER, loadPlaywright, outDir, hasFlag } from './harness.mjs';

if (!hasFlag('--billable')) {
  console.error('This check sends about four short requests to a real API and uses account credit.\nRe-run with --billable to confirm that is what you want.');
  process.exit(3);
}
const apiKey = process.env.AIVANA_API_KEY?.trim();
if (!apiKey) { console.error('Set AIVANA_API_KEY to the key the check should use (it is read from the environment and never printed).'); process.exit(2); }
const apiBase = process.env.AIVANA_API_BASE?.trim();
let Aivana;
try { ({ default: Aivana } = await import(pathToFileURL(STARTER + 'node_modules/@aivana/sdk/src/index.js'))); }
catch { console.error('The starter\'s SDK is not installed. Run `npm ci` in examples/basic-chat first.'); process.exit(2); }
const { chromium } = await loadPlaywright();
const { createChatServer } = await import(pathToFileURL(STARTER + 'app.mjs'));
const OUT = outDir();

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sdk = new Aivana({ apiKey, ...(apiBase ? { apiBase } : {}), timeoutMs: 120_000 });
const calls = []; // one record per request that reached the SDK: shapes and timings only, never headers or keys
const cut = { armed: false };
const client = {
  generate: (p, o) => sdk.generate(p, o),
  async *generateStream(p, o) {
    const rec = { id: calls.length + 1, t0: Date.now(), message: o.messages.at(-1).content, historyLen: o.messages.length - 1, events: {}, arrivals: [], doneAt: null, aborted: false, endedMs: null,
      options: { effort: o.effort, maxTokens: o.maxTokens, webSearch: o.webSearch }, doneKeys: null };
    calls.push(rec);
    o.signal?.addEventListener('abort', () => { rec.aborted = Date.now() - rec.t0; });
    try {
      for await (const chunk of sdk.generateStream(p, o)) {
        rec.events[chunk.event] = (rec.events[chunk.event] ?? 0) + 1;
        if (chunk.event === 'delta') rec.arrivals.push([Date.now() - rec.t0, chunk.data.text.length]);
        if (chunk.event === 'done') { rec.doneAt = Date.now() - rec.t0; rec.doneKeys = Object.keys(chunk.data).sort(); }
        yield chunk;
        if (chunk.event === 'delta' && rec.arrivals.length === 1 && cut.armed) { cut.armed = false; await sleep(120); server.closeAllConnections(); }
      }
    } finally { rec.endedMs = Date.now() - rec.t0; }
  },
};

const server = createChatServer({ client, timeoutMs: 120_000 });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 820 } });
const page = await ctx.newPage();
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
const posts = []; page.on('request', (r) => { if (r.url().includes('/api/chat')) posts.push(JSON.parse(r.postData() || '{}')); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => !document.querySelector('#message').disabled);
const configure = async (effort, length) => { if (!(await page.evaluate(() => document.querySelector('#settings').open))) await page.click('#settings summary'); await page.selectOption('#effort', effort); await page.selectOption('#max-tokens', length); };
const textLen = () => page.evaluate(() => document.querySelector('.message.assistant.live .markdown-body')?.textContent.length ?? 0);

try {
  // ===== 1. streaming, typing animation and completion =====
  console.log('\n--- 1. Streaming, typing animation and completion');
  await configure('low', '800');
  await page.evaluate(() => { window.__s = []; window.__i = setInterval(() => { const el = document.querySelector('.message.assistant .markdown-body'); window.__s.push([Math.round(performance.now()), el ? el.textContent.length : 0, !!document.querySelector('[data-action="regenerate"]'), !!document.querySelector('.thinking'), !document.querySelector('#stop').hidden]); }, 8); });
  await page.fill('#message', 'Explain in about 120 words how a library card catalog works.');
  await page.click('#send');
  await page.waitForSelector('[data-action="regenerate"]', { timeout: 90_000 });
  await sleep(200);
  const s = await page.evaluate(() => { clearInterval(window.__i); return window.__s; });
  const c1 = calls[0];
  const done1 = await page.evaluate(() => ({ text: document.querySelector('.message.assistant .markdown-body').textContent, session: document.querySelector('#session-details').hidden ? null : document.querySelector('#session-list').textContent, err: document.querySelector('#error').hidden, chip: !!document.querySelector('.state-chip') }));
  const shown = s.filter((x) => x[1] > 0); const lens = shown.map((x) => x[1]);
  const firstShown = shown[0][0], fullAt = shown.find((x) => x[1] === lens.at(-1))[0], toolbarAt = s.find((x) => x[2])[0];
  const thinkingAt = s.findIndex((x) => x[3]), toolbarIdx = s.findIndex((x) => x[2]), firstTextIdx = s.findIndex((x) => x[1] > 0);
  const inflight = s.slice(thinkingAt, toolbarIdx);
  check('the request completed (answer and done event, no error)', c1.events.done === 1 && !c1.events.error && done1.text.trim().length > 200 && done1.err, `${done1.text.length} characters, events ${JSON.stringify(c1.events)}`);
  console.log(`   arrival from the API: ${c1.arrivals.length} piece(s): ${c1.arrivals.map(([t, n]) => `${n} chars @ ${t} ms`).join(' | ')}`);
  check('"Thinking" first, then text; Stop available the whole time it was in flight', thinkingAt >= 0 && thinkingAt < firstTextIdx && inflight.length > 20 && inflight.every((x) => x[4]) && !done1.chip, `${inflight.length} in-flight samples`);
  check('the text was typed out over many frames', new Set(lens).size >= 15, `${new Set(lens).size} distinct on-screen lengths from ${c1.arrivals.length} arrival(s)`);
  check('text never shrank while revealing', lens.every((v, i) => i === 0 || v >= lens[i - 1]));
  check('the typing did not run long', fullAt - firstShown < 3500, `first text to all text: ${fullAt - firstShown} ms`);
  check('the toolbar appeared only after all text was shown', toolbarAt >= fullAt - 20, `all text at +${fullAt - firstShown} ms, toolbar at +${toolbarAt - firstShown} ms`);
  check('Session details show token counts and never credits', !!done1.session && /Input tokens/.test(done1.session) && /Output tokens/.test(done1.session) && !/credit/i.test(done1.session), done1.session);
  console.log('   the real done message carried:', JSON.stringify(c1.doneKeys));
  check('the chosen settings reached the API', c1.options.effort === 'low' && c1.options.maxTokens === 800 && c1.options.webSearch === false, JSON.stringify(c1.options));
  await page.screenshot({ path: `${OUT}/live-1-complete.png` });

  // ===== 2. Stop =====
  console.log('\n--- 2. Stop mid-response');
  await page.click('#reset');
  await configure('low', '1600');
  await page.fill('#message', 'Write a detailed 600-word essay about the history of the printing press.');
  await page.click('#send');
  await page.waitForFunction(() => (document.querySelector('.message.assistant.live .markdown-body')?.textContent.length ?? 0) > 250, null, { timeout: 90_000 });
  await page.click('#stop');
  await page.waitForSelector('.message.is-stopped', { timeout: 10_000 });
  const len1 = await textLen(); await sleep(2500); const len2 = await textLen();
  await sleep(500);
  const c2 = calls[1];
  const stopped = await page.evaluate(() => ({ chip: document.querySelector('.state-chip.stopped')?.textContent, saved: !!document.querySelector('[data-action="regenerate"]'), send: !document.querySelector('#send').hidden }));
  check('Stop kept the partial text, labelled Stopped, and did not save it as an answer', stopped.chip === 'Stopped' && len1 > 250 && !stopped.saved && stopped.send, `${len1} characters kept`);
  check('the text stopped growing after Stop', len1 === len2, `${len1} -> ${len2} characters 2.5 s later`);
  check('the cancellation reached the SDK and its stream ended', c2.aborted !== false && c2.endedMs !== null, `ended ${c2.endedMs} ms after it started`);
  await page.screenshot({ path: `${OUT}/live-2-stopped.png` });

  // ===== 3. Interrupted, then Retry =====
  console.log('\n--- 3. Interrupted, then Retry');
  await page.click('#reset');
  await configure('low', '800');
  await page.fill('#message', 'Write about 150 words on why the sky is blue.');
  const postsBefore = posts.length;
  cut.armed = true; // the starter's connection to the browser is dropped after the first text arrives
  await page.click('#send');
  await page.waitForSelector('.message.is-interrupted', { timeout: 30_000 });
  const intr = await page.evaluate(() => ({ chip: document.querySelector('.state-chip.interrupted')?.textContent, partial: document.querySelector('.message.is-interrupted .markdown-body').textContent.length, retry: document.querySelector('[data-action="retry"]')?.textContent, note: document.querySelector('#retry-note')?.textContent, saved: document.querySelectorAll('[data-action="regenerate"]').length }));
  await sleep(500);
  const c3a = calls[2];
  check('the dropped connection kept the partial text, labelled Interrupted, with Retry and its billing note', intr.chip === 'Interrupted' && intr.partial > 20 && intr.retry === 'Retry' && /uses credit/.test(intr.note), `${intr.partial} characters kept`);
  check('the interrupted text was not saved as an answer', intr.saved === 0);
  check('the abandoned request was cancelled', c3a.aborted !== false && c3a.endedMs !== null, `ended ${c3a.endedMs} ms after it started`);
  await page.screenshot({ path: `${OUT}/live-3-interrupted.png` });
  await page.click('[data-action="retry"]');
  await page.waitForSelector('[data-action="regenerate"]', { timeout: 90_000 });
  const retried = await page.evaluate(() => ({ answers: document.querySelectorAll('.message.assistant').length, interrupted: !!document.querySelector('.is-interrupted'), len: document.querySelector('.message.assistant .markdown-body').textContent.length, err: document.querySelector('#error').hidden }));
  const c3b = calls[3]; const retryPost = posts.slice(postsBefore).at(-1);
  check('Retry completed with exactly one new request', calls.length === 4 && c3b.events.done === 1 && retried.answers === 1 && !retried.interrupted && retried.err && retried.len > 50);
  check('Retry resent the same message with unchanged (empty) history', c3b.message === c3a.message && c3b.historyLen === 0 && retryPost.history.length === 0, `history sent: ${retryPost.history.length} messages`);
  await page.screenshot({ path: `${OUT}/live-3-retried.png` });

  check('no unexpected console or CSP errors', errors.filter((e) => !/ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_INTERNET_DISCONNECTED|Failed to load resource|net::/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('the run did not crash', false, String(e).split('\n')[0]);
  await page.screenshot({ path: `${OUT}/live-crash.png` }).catch(() => {});
}
console.log('\n--- what actually reached the API');
for (const c of calls) console.log(`   #${c.id} "${c.message.slice(0, 48)}…" pieces=${c.arrivals.length} first-text=${c.arrivals[0]?.[0] ?? '-'}ms ended=${c.endedMs}ms cancelled=${c.aborted === false ? 'no' : 'yes'} done=${c.events.done ? 'yes' : 'no'}`);
await browser.close(); server.closeAllConnections(); server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} live checks passed (${calls.length} request(s) sent)`);
process.exit(failed ? 1 : 0);
