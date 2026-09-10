// topP: the one sampling knob every model behind Aivana accepts.
//
// The trap it shares with webSearch is the falsy check: `topP: 0` is legal and
// is the most deterministic setting the parameter has, so a truthiness guard
// would drop exactly the value someone chose deliberately. Omitted must stay
// omitted too — that is how each model keeps its own default, and it is not the
// same request as topP: 1.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana from "../src/index.js";

const client = new Aivana({ apiKey: "ai_live_test" });
const body = (opts) => client._body(opts);

test("sends top_p when the caller sets it", () => {
  assert.equal(body({ prompt: "hi", topP: 0.4 }).top_p, 0.4);
});

test("sends top_p: 0 rather than dropping it", () => {
  assert.equal(body({ prompt: "hi", topP: 0 }).top_p, 0);
});

test("omits top_p entirely when the caller says nothing", () => {
  assert.equal("top_p" in body({ prompt: "hi" }), false);
});

test("treats explicit null as unset", () => {
  assert.equal("top_p" in body({ prompt: "hi", topP: null }), false);
});

test("maps camelCase topP onto the wire's snake_case top_p", () => {
  const b = body({ prompt: "hi", topP: 0.9 });
  assert.equal(b.top_p, 0.9);
  assert.equal("topP" in b, false);
});

test("temperature and topP can both be sent — the engine resolves it", () => {
  const b = body({ prompt: "hi", temperature: 0.2, topP: 0.9 });
  assert.equal(b.temperature, 0.2);
  assert.equal(b.top_p, 0.9);
});

test("chat() keeps topP across turns", async () => {
  const sent = [];
  const spy = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ answer: "ok", intent: { name: "qa" } }) };
    },
  });
  const chat = spy.chat({ topP: 0 });
  await chat.send("first");
  await chat.send("second");

  assert.equal(sent.length, 2);
  for (const b of sent) assert.equal(b.top_p, 0, "a sticky 0 must survive every turn");
});

test("a per-turn topP overrides the conversation default", async () => {
  const sent = [];
  const spy = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ answer: "ok", intent: { name: "qa" } }) };
    },
  });
  await spy.chat({ topP: 0.1 }).send("be creative", { topP: 0.95 });
  assert.equal(sent[0].top_p, 0.95);
});

// stopSequences: the answer ends at the first marker and the marker is dropped.
// Applied by the engine to the final answer, so it behaves the same whatever
// produced it — the SDK's only job is to get the list onto the wire.

test("sends stop_sequences when the caller sets them", () => {
  assert.deepEqual(body({ prompt: "hi", stopSequences: ["###"] }).stop_sequences, ["###"]);
});

test("omits stop_sequences when absent or empty", () => {
  assert.equal("stop_sequences" in body({ prompt: "hi" }), false);
  assert.equal("stop_sequences" in body({ prompt: "hi", stopSequences: [] }), false);
});

test("coerces entries to strings", () => {
  assert.deepEqual(body({ prompt: "hi", stopSequences: ["a", 1] }).stop_sequences, ["a", "1"]);
});

test("chat() keeps stopSequences across turns", async () => {
  const sent = [];
  const spy = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ answer: "ok", intent: { name: "qa" } }) };
    },
  });
  const chat = spy.chat({ stopSequences: ["\n\nUser:"] });
  await chat.send("first");
  await chat.send("second");
  for (const b of sent) assert.deepEqual(b.stop_sequences, ["\n\nUser:"]);
});
