// effort: the one option about how much intelligence Aivana applies, rather
// than about sampling.
//
// The trap here is the opposite of topP's. Omitted must stay omitted, because an
// absent field is what leaves Aivana's own judgement in charge — the same
// meaning "auto" has. A client-side default would make "I didn't choose"
// indistinguishable from "I chose auto", and every untouched caller would start
// sending a body they never sent before.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana from "../src/index.js";

const client = new Aivana({ apiKey: "ai_live_test" });
const body = (opts) => client._body(opts);

test("omits effort entirely when the caller says nothing", () => {
  assert.equal("effort" in body({ prompt: "hi" }), false);
});

test("sends each band the caller can choose", () => {
  for (const band of ["auto", "low", "medium", "high"]) {
    assert.equal(body({ prompt: "hi", effort: band }).effort, band);
  }
});

test("normalizes case and surrounding whitespace", () => {
  assert.equal(body({ prompt: "hi", effort: "  High " }).effort, "high");
  assert.equal(body({ prompt: "hi", effort: "LOW" }).effort, "low");
});

test("an empty string is not a choice", () => {
  // A dropdown that was never touched commonly serializes as "". That is an
  // absence, not a band, and must not reach the wire as one.
  assert.equal("effort" in body({ prompt: "hi", effort: "" }), false);
  assert.equal("effort" in body({ prompt: "hi", effort: null }), false);
  assert.equal("effort" in body({ prompt: "hi", effort: undefined }), false);
});

test("an unknown band is forwarded, not guessed at", () => {
  // The server normalizes anything it does not recognize to "auto". Rewriting it
  // here too would hide a client typo behind silently different behaviour.
  assert.equal(body({ prompt: "hi", effort: "turbo" }).effort, "turbo");
});

test("chat carries the band across turns and a per-turn value wins", async () => {
  const sent = [];
  const spy = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ answer: "ok", intent: { name: "qa" } }) };
    },
  });
  const chat = spy.chat({ effort: "low" });
  await chat.send("first");
  assert.equal(sent[0].effort, "low");
  await chat.send("second", { effort: "high" });
  assert.equal(sent[1].effort, "high");
});
