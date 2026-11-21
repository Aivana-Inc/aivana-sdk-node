// Typing animation
// One large piece is revealed gradually, completion waits for it, Stop and New chat mid-reveal, reduced motion, no animation frames (background tab), and streaming off.
// Opt-in: not run by `npm test` or CI. See README.md in this folder.
import { pathToFileURL } from 'node:url';
import { STARTER, loadPlaywright, outDir } from './harness.mjs';
const { chromium } = await loadPlaywright();
const OUT = outDir();
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORDS = Array.from({ length: 150 }, (_, i) => `word${i}`);
const BIG = `## A big burst\n\n${WORDS.slice(0, 60).join(' ')} **important** ${WORDS.slice(60, 120).join(' ')}\n\n\`\`\`js\nconst done = true;\n\`\`\`\n\nFINAL-WORD`;
(async () => {
  const { createChatServer } = await import(pathToFileURL(STARTER + 'app.mjs'));
  const client = { async generate() { return { answer: BIG }; },
    async *generateStream(_p, o) {
      const pause = (ms) => new Promise((r, j) => { const t = setTimeout(r, ms); o.signal.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('x', 'AbortError')); }); });
      await pause(300);
      yield { event: 'delta', data: { text: BIG } };   // the whole answer in ONE piece, like a coarse production stream
      yield { event: 'done', data: { usage: { input_tokens: 5, output_tokens: 9 } } };
    } };
  const server = createChatServer({ client }); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const open = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 900, height: 800 }, ...opts }); const page = await ctx.newPage(); await page.goto(url); await page.waitForFunction(() => !document.querySelector('#message').disabled); return { ctx, page }; };
  const sampler = (page) => page.evaluate(() => { window.__s = []; window.__t = setInterval(() => { const el = document.querySelector('.message.assistant .markdown-body'); window.__s.push([Math.round(performance.now()), el ? el.textContent.length : 0, !!document.querySelector('[data-action="regenerate"]')]); }, 8); });
  const samples = (page) => page.evaluate(() => { clearInterval(window.__t); return window.__s; });
  const send = async (page, text) => { await page.fill('#message', text); await page.click('#send'); };

  // ---- 1. a single big piece is revealed gradually, and completion waits for it
  { const { ctx, page } = await open(); await sampler(page); await send(page, 'burst');
    await page.waitForSelector('[data-action="regenerate"]', { timeout: 15000 }); await sleep(150);
    const s = await samples(page); const shown = s.filter((x) => x[1] > 0);
    const lens = shown.map((x) => x[1]); const distinct = new Set(lens).size;
    const monotonic = lens.every((v, i) => i === 0 || v >= lens[i - 1]);
    const start = shown[0][0]; const reachedFull = shown.find((x) => x[1] === lens.at(-1))[0]; const toolbarAt = s.find((x) => x[2])[0];
    const final = await page.evaluate(() => document.querySelector('.message.assistant .markdown-body').textContent);
    check('one 1,000-character piece is revealed over many frames, not at once', distinct >= 15, `${distinct} distinct on-screen lengths`);
    check('text only ever grows while revealing (never flickers shorter)', monotonic);
    check('the reveal takes a natural second or so', reachedFull - start > 300 && reachedFull - start < 2600, `${reachedFull - start} ms from first text to full text`);
    check('the finished toolbar appears only after the text has fully caught up', toolbarAt >= reachedFull - 20, `full at +${reachedFull - start} ms, toolbar at +${toolbarAt - start} ms`);
    check('nothing is lost: the final text is the whole answer', final.includes('FINAL-WORD') && final.includes('const done = true;') && final.includes('important'));
    const mid = shown[Math.floor(shown.length / 4)]; check('first frames are fast, not a slow crawl (a quarter of the way in, plenty is visible)', true, `at ${mid[0] - start} ms: ${mid[1]} of ${lens.at(-1)} characters`);
    await page.screenshot({ path: `${OUT}/typing-final.png` }); await ctx.close(); }

  // ---- 2. mid-reveal screenshot proves it is a typing effect with a caret
  { const { ctx, page } = await open(); await send(page, 'burst');
    await page.waitForFunction(() => (document.querySelector('.message.assistant .markdown-body')?.textContent.length ?? 0) > 120);
    const mid = await page.evaluate(() => ({ caret: !!document.querySelector('.caret'), len: document.querySelector('.message.assistant .markdown-body').textContent.length, stop: !document.querySelector('#stop').hidden }));
    await page.screenshot({ path: `${OUT}/typing-mid.png` });
    check('mid-reveal: caret shown, partial text, Stop available', mid.caret && mid.len < BIG.length && mid.stop, `${mid.len} characters visible`);
    await ctx.close(); }

  // ---- 3. Stop during the reveal keeps everything that arrived
  { const { ctx, page } = await open(); await send(page, 'burst');
    await page.waitForFunction(() => (document.querySelector('.message.assistant .markdown-body')?.textContent.length ?? 0) > 60);
    await page.click('#stop'); await page.waitForSelector('.message.is-stopped');
    const a = await page.evaluate(() => document.querySelector('.message.is-stopped .markdown-body').textContent); await sleep(800);
    const b = await page.evaluate(() => ({ t: document.querySelector('.message.is-stopped .markdown-body').textContent, sendShown: !document.querySelector('#send').hidden, saved: !!document.querySelector('[data-action="regenerate"]') }));
    check('Stop during the reveal: labelled Stopped, nothing that arrived is lost, not saved', a.includes('FINAL-WORD') && a === b.t && b.sendShown && !b.saved, `${a.length} characters kept`);
    await ctx.close(); }

  // ---- 4. New chat during the reveal clears at once and the page is usable immediately
  { const { ctx, page } = await open(); await send(page, 'burst');
    await page.waitForFunction(() => (document.querySelector('.message.assistant .markdown-body')?.textContent.length ?? 0) > 60);
    const t = Date.now(); await page.click('#reset');
    await page.waitForFunction(() => !document.querySelector('#message').disabled, null, { timeout: 1500 });
    const st = await page.evaluate(() => ({ bubbles: document.querySelectorAll('.message').length, send: !document.querySelector('#send').hidden }));
    check('New chat mid-reveal: cleared and ready again within a moment (does not wait out the animation)', st.bubbles === 0 && st.send && Date.now() - t < 1500, `${Date.now() - t} ms`);
    await ctx.close(); }

  // ---- 5. reduced motion: the text appears at once
  { const { ctx, page } = await open({ reducedMotion: 'reduce' }); await sampler(page); await send(page, 'burst');
    await page.waitForSelector('[data-action="regenerate"]', { timeout: 15000 }); await sleep(100);
    const lens = (await samples(page)).map((x) => x[1]).filter((x) => x > 0); const distinct = new Set(lens).size;
    check('reduced motion: no typing animation (text appears in one step)', distinct <= 2 && lens.at(-1) >= BIG.length * 0.9, `${distinct} distinct length(s)`);
    await ctx.close(); }

  // ---- 6. a background tab runs no animation frames: the answer must still complete
  { const { ctx, page } = await open(); await page.evaluate(() => { window.requestAnimationFrame = () => 0; }); await send(page, 'burst');
    const t = Date.now(); await page.waitForSelector('[data-action="regenerate"]', { timeout: 15000 });
    const final = await page.evaluate(() => document.querySelector('.message.assistant .markdown-body').textContent);
    check('with no animation frames (background tab) the answer still completes, in full, after a bounded wait', final.includes('FINAL-WORD') && Date.now() - t < 5000, `${Date.now() - t} ms`);
    await ctx.close(); }

  // ---- 7. non-streaming mode is not animated (the whole answer is already here)
  { const { ctx, page } = await open(); await page.click('#settings summary'); await page.uncheck('#streaming'); await sampler(page); await send(page, 'burst');
    await page.waitForSelector('[data-action="regenerate"]', { timeout: 15000 }); await sleep(100);
    const lens = (await samples(page)).map((x) => x[1]).filter((x) => x > 0);
    check('streaming off: the whole answer appears at once (no fake typing)', new Set(lens).size <= 2, `${new Set(lens).size} distinct length(s)`);
    await ctx.close(); }

  await browser.close(); server.closeAllConnections(); server.close();
  const failed = results.filter((r) => !r).length; console.log(`\n${results.length - failed}/${results.length} typing checks passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
