// Pacing for the typing animation.
//
// The API delivers an answer in a few large pieces. Showing each piece the moment it arrives makes the
// text jump, so the page keeps two numbers: how much text has ARRIVED and how much is SHOWN. Every frame
// it asks `advance` how far to move the second towards the first. Nothing is ever delayed for its own sake:
// the further behind the display is, the faster it moves, so it always catches up within about a second
// or two, and a slow stream is simply followed as it arrives.
//
// This file only decides numbers. It never touches the page, so it can be tested exactly.

export const TYPING = Object.freeze({
  minCps: 120,      // never slower than this many characters a second, so the tail always finishes
  catchUp: 3,       // otherwise move at (backlog x this) characters a second: it closes about two thirds of the gap each third of a second
  maxDtMs: 100,     // a long pause between frames (a busy or background tab) counts as at most this much time
  maxSnap: 24,      // finish the current word if it ends within this many characters, so text grows by words
});

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isSpace = (char) => char === " " || char === "\n" || char === "\t" || char === "\r";

/**
 * How many characters of `text` to show after `dt` more milliseconds, given that `shown` are showing now.
 * Always at least one more while any are hidden, never more than `text.length`, never backwards.
 */
export function advance({ text, shown, dt }) {
  const length = text.length;
  if (shown >= length) return length;
  const backlog = length - shown;
  const rate = Math.max(TYPING.minCps, backlog * TYPING.catchUp);
  const seconds = Math.min(Math.max(dt, 0), TYPING.maxDtMs) / 1000;
  let target = Math.min(length, shown + Math.max(1, Math.round(rate * seconds)));
  if (target < length) {
    // Stop at the end of a word, not in the middle of one (a very long word, such as an address, is cut anyway).
    const limit = Math.min(length, target + TYPING.maxSnap);
    while (target < limit && !isSpace(text[target])) target++;
    // Never end between the two halves of a character such as an emoji.
    if (target < length && isHighSurrogate(text.charCodeAt(target - 1))) target++;
  }
  return Math.min(target, length);
}
