// Keyboard walk
// Tab through the page in both themes: a logical order, every control reachable with a visible focus ring, Enter in the message box makes a new line.
// Opt-in: not run by `npm test` or CI. See README.md in this folder.
import { pathToFileURL } from 'node:url';
import { STARTER, loadPlaywright } from './harness.mjs';
const { chromium } = await loadPlaywright();
const RICH = ['## Title', '', 'Text with a [link](https://example.com).', '', '```js', 'const a = 1;', '```', '', '| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
(async () => {
  const { createChatServer } = await import(pathToFileURL(STARTER + 'app.mjs'));
  const client = { async generate() { return { answer: RICH }; }, async *generateStream(_p, o) { yield { event: 'delta', data: { text: RICH } }; yield { event: 'done', data: { usage: { input_tokens: 5, output_tokens: 9 } } }; } };
  const server = createChatServer({ client }); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let bad = 0, enterOk = true;
  for (const scheme of ['light', 'dark']) {
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 }, colorScheme: scheme })).newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => !document.querySelector('#message').disabled);
    await page.fill('#message', 'rich'); await page.keyboard.press('Control+Enter');
    await page.waitForSelector('[data-action="regenerate"]', { timeout: 15000 });
    await page.click('#settings summary'); await page.click('#session-details summary');
    // Land on the first control with real key presses (Shift+Tab wraps to the last control, Tab returns to the first), so the
    // browser treats focus as keyboard focus and draws its ring; programmatic focus() would not.
    await page.focus('.brand'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const stops = [];
    for (let i = 0; i < 40; i++) {
      if (i) await page.keyboard.press('Tab');
      const s = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const name = e.getAttribute('aria-label') || e.innerText?.trim().slice(0, 28) || e.id || e.tagName; const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') || (e.id === 'message' && getComputedStyle(e.closest('.composer')).boxShadow !== 'none'); const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), name, ring: !!ring, visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, size: Math.round(r.width) + 'x' + Math.round(r.height) }; });
      if (!s) break; if (stops.length && stops[0].key === s.tag + s.name) break; s.key = s.tag + s.name; stops.push(s);
    }
    console.log(`\n${scheme}: ${stops.length} tab stops`);
    for (const s of stops) { const flag = !s.ring || !s.visible ? '  <-- CHECK' : ''; if (flag) bad++; console.log(`   ${s.tag.padEnd(9)} ${String(s.name).padEnd(30)} ${s.size.padEnd(8)} focus ring: ${s.ring ? 'yes' : 'NO'}  on screen: ${s.visible ? 'yes' : 'NO'}${flag}`); }
    // keyboard-only: Escape does nothing harmful; Enter in the message box makes a new line (not send)
    await page.focus('#message'); await page.keyboard.type('a'); await page.keyboard.press('Enter'); await page.keyboard.type('b');
    const entered = await page.inputValue('#message'); if (entered !== 'a\nb') enterOk = false;
    console.log('   Enter in the message box inserts a new line (does not send):', entered === 'a\nb');
  }
  await browser.close(); server.closeAllConnections(); server.close(); console.log(bad ? `\n${bad} stop(s) to check` : '\nevery tab stop has a focus ring and is on screen'); process.exit(bad || !enterOk ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
