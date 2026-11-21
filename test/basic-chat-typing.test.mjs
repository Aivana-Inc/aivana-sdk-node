import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, TYPING } from "../examples/basic-chat/public/typing.mjs";

const FRAME = 1000 / 60;
// Run the animation to the end at 60 frames a second; returns the time it took and every step shown.
function run(text, { start = 0, dt = FRAME } = {}) {
  let shown = start, elapsed = 0; const steps = [];
  while (shown < text.length) {
    const next = advance({ text, shown, dt });
    assert.ok(next > shown, "every frame makes progress");
    assert.ok(next <= text.length, "never past the end");
    steps.push(next); shown = next; elapsed += dt;
    assert.ok(elapsed < 60_000, "it must finish");
  }
  return { elapsed, steps };
}
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("always moves forward by at least one character and never past the end", () => {
  assert.equal(advance({ text: "abc", shown: 3, dt: 16 }), 3);
  assert.equal(advance({ text: "abc", shown: 5, dt: 16 }), 3, "a stale count is pulled back to the length");
  assert.ok(advance({ text: "abcdef", shown: 0, dt: 0 }) >= 1, "even with no time elapsed");
  assert.ok(advance({ text: "abcdef", shown: 0, dt: -50 }) >= 1, "a clock that went backwards");
  assert.equal(advance({ text: "", shown: 0, dt: 16 }), 0);
  assert.ok(advance({ text: " x y z", shown: 0, dt: 0 }) >= 1, "progress does not depend on a word boundary being near");
});

test("a large burst is caught up in about a second or two, at any size the starter allows", () => {
  for (const [chars, limitMs] of [[370, 1500], [1_100, 2000], [5_000, 2600], [16_000, 3800]]) {
    const { elapsed } = run("x ".repeat(chars / 2));
    assert.ok(elapsed < limitMs, `${chars} characters took ${Math.round(elapsed)} ms (limit ${limitMs})`);
  }
});

test("it eases out: faster while far behind, slower as it catches up, never below the minimum pace", () => {
  const text = words(400);
  const { steps } = run(text);
  const sizes = steps.map((s, i) => s - (steps[i - 1] ?? 0));
  const early = sizes.slice(0, 5).reduce((a, b) => a + b) / 5, late = sizes.slice(-5).reduce((a, b) => a + b) / 5;
  assert.ok(early > late * 2, `early steps (${early.toFixed(1)}) should be well above late ones (${late.toFixed(1)})`);
  // the slowest sustained pace is at least the minimum (word snapping can only add to a step)
  const floor = Math.floor(TYPING.minCps * (FRAME / 1000));
  assert.ok(sizes.slice(0, -1).every((size) => size >= Math.max(1, floor)), "no step below the minimum pace");
});

test("a slow stream is followed as it arrives, with no added delay once caught up", () => {
  // 40 characters arrive every 250 ms (160 characters a second): the display must never lag by more than one arrival
  let text = "", shown = 0, worst = 0;
  for (let t = 0; t < 5000; t += FRAME) {
    if (Math.floor(t / 250) > Math.floor((t - FRAME) / 250)) text += words(6).slice(0, 40);
    shown = advance({ text, shown, dt: FRAME });
    worst = Math.max(worst, text.length - shown);
  }
  assert.ok(worst <= 40, `display lagged by ${worst} characters`);
});

test("text grows by whole words, not by fragments of words", () => {
  const text = words(200);
  const { steps } = run(text);
  const mid = steps.slice(0, -1);
  const atBoundary = mid.filter((n) => /\s/.test(text[n]) || n >= text.length);
  assert.ok(atBoundary.length / mid.length > 0.95, `${Math.round(100 * atBoundary.length / mid.length)}% of steps end at a word boundary`);
});

test("one very long word is still revealed (it is cut after the snap limit, never stalled)", () => {
  const text = "a".repeat(5_000);
  const { elapsed } = run(text);
  assert.ok(elapsed < 5000);
});

test("never ends between the two halves of an emoji or other astral character", () => {
  const text = "😀".repeat(400); // every character is a surrogate pair
  for (let shown = 0, guard = 0; shown < text.length && guard < 10_000; guard++) {
    shown = advance({ text, shown, dt: FRAME });
    if (shown < text.length) assert.ok(!(text.charCodeAt(shown - 1) >= 0xd800 && text.charCodeAt(shown - 1) <= 0xdbff), `cut inside a pair at ${shown}`);
  }
});

test("a long pause between frames (busy or background tab) does not reveal everything at once", () => {
  const text = words(2000);
  const jump = advance({ text, shown: 0, dt: 60_000 });
  const capped = advance({ text, shown: 0, dt: TYPING.maxDtMs });
  assert.equal(jump, capped, "time beyond the cap counts as the cap");
  assert.ok(jump < text.length / 2);
});

test("revealing text in pieces always ends with exactly the text that arrived", () => {
  const full = "# Title\n\nSome **bold** text and `code`.\n\n```js\nconst a = 1;\n```\n";
  let text = "", shown = 0;
  for (let i = 0; i < full.length; i += 7) { text = full.slice(0, i + 7); shown = advance({ text, shown, dt: FRAME }); assert.ok(full.startsWith(text.slice(0, shown))); }
  for (let guard = 0; shown < text.length && guard < 5_000; guard++) shown = advance({ text, shown, dt: FRAME }); // bounded: a bug must fail this test, not hang it
  assert.equal(text.slice(0, shown), full);
});

// ---------- unfinished inline spans ----------
import { openSpan } from "../examples/basic-chat/public/typing.mjs";

// What a reader would see flicker: the current line's prefix ends with an unfinished span.
const endsInsideSpan = (prefix) => {
  const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if ((line.match(/\*\*/g) || []).length % 2) return "bold";
  if ((line.match(/~~/g) || []).length % 2) return "strike";
  if ((line.replace(/``/g, "").match(/`/g) || []).length % 2) return "code";
  if (/\[[^\]]*$/.test(line) || /\]\([^)]*$/.test(line)) return "link";
  return null;
};
const reveal = (text, opts = {}) => { // reveal all of `text` at 60 fps, returning every value `shown` took
  const seen = []; let shown = 0;
  for (let guard = 0; shown < text.length && guard < 20_000; guard++) {
    const next = advance({ text, shown, dt: FRAME, complete: true, ...opts });
    assert.ok(next > shown, "once complete, every frame makes progress");
    seen.push(next); shown = next;
  }
  return seen;
};

test("never shows a bold, strike, code or link span half-typed once its end has arrived", () => {
  const samples = {
    bold: "Intro text here. This is **a fairly long bold phrase that goes on** and then more words follow after it. ".repeat(6),
    strike: "Some words ~~struck through phrase that is long enough~~ and the rest of the sentence continues here. ".repeat(6),
    code: "Call `someFunction(withArguments, andMore)` to do it, then `other()` as well and keep going for a while. ".repeat(6),
    link: "See [the documentation page for details](https://example.com/some/long/path?x=1) and then carry on reading. ".repeat(6),
  };
  for (const [kind, text] of Object.entries(samples)) {
    for (const shown of reveal(text, { complete: false }).filter((n) => n < text.length)) {
      assert.equal(endsInsideSpan(text.slice(0, shown)), null, `${kind}: ended inside a span at ${shown}: …${JSON.stringify(text.slice(Math.max(0, shown - 25), shown))}`);
    }
  }
});

test("holds back at the start of a span whose end has not arrived, then releases it when the end does", () => {
  const partial = "Before the span **bold that is not fini";
  let shown = 0;
  for (let i = 0; i < 200; i++) shown = advance({ text: partial, shown, dt: FRAME });
  assert.equal(shown, partial.indexOf("**"), "stopped right before the unfinished marker");
  const withEnd = partial + "shed** and after";
  for (let i = 0; i < 200 && shown < withEnd.length; i++) shown = advance({ text: withEnd, shown, dt: FRAME });
  assert.equal(shown, withEnd.length, "released once the end arrived");
});

test("a stream that completes releases everything, even a span that never closed", () => {
  const text = "A **never closed span and more words after it";
  let shown = 0;
  for (let i = 0; i < 200 && shown < text.length; i++) shown = advance({ text, shown, dt: FRAME, complete: true });
  assert.equal(shown, text.length);
});

test("a stray marker cannot hide text for ever: after a bounded wait it is shown as it is", () => {
  const text = "A **" + "word ".repeat(100); // no closer, and far more text than the hold limit
  let shown = 0;
  for (let i = 0; i < 2000 && shown < text.length; i++) shown = advance({ text, shown, dt: FRAME });
  assert.equal(shown, text.length);
});

test("fenced code is shown exactly as typed: markers inside it never hold anything back", () => {
  const text = "```js\nconst s = `unclosed;\nlet x = **y;\nconst t = [a](b\n";
  let shown = 0;
  for (let i = 0; i < 400 && shown < text.length; i++) shown = advance({ text, shown, dt: FRAME });
  assert.equal(shown, text.length, "no hold inside a fence");
  assert.equal(openSpan(text, text.length), null);
});

test("it only looks at the current line, and understands escapes, nested code and finished spans", () => {
  assert.equal(openSpan("done **bold** and `code` and [a](b) all finished", 49), null);
  assert.equal(openSpan("a \\*\\*not bold", 14), null, "escaped markers are text");
  assert.equal(openSpan("`a ** b` fine", 9), null, "markers inside a code span are text");
  assert.equal(openSpan("first **open\nsecond line", 20), null, "an unfinished span on an earlier line is not this line's");
  const span = openSpan("see **bold and more", 12);
  assert.deepEqual([span.start, span.end], [4, -1]);
  const outer = openSpan("**bold with `code and more", 20);
  assert.equal(outer.start, 0, "the outermost unfinished span wins");
});

test("deciding costs little per frame even for the largest answer the starter accepts", () => {
  const text = "Some **bold** words, `code`, and [a link](https://example.com/x) in a paragraph.\n\n".repeat(200).slice(0, 16_000);
  const started = performance.now();
  let shown = 0;
  for (let i = 0; i < 300 && shown < text.length; i++) shown = advance({ text, shown: Math.min(shown, 8_000), dt: FRAME, complete: true });
  const perFrame = (performance.now() - started) / 300;
  assert.ok(perFrame < 1.5, `${perFrame.toFixed(3)} ms per frame`);
});
