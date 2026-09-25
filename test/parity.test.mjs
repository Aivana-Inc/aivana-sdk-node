// Option parity with the Python SDK (aivana-sdk-python): the same call must send the
// same request from either SDK. Drift here is silent by nature. An option one SDK
// ignores still "works", it just has no effect: webSearch, effort,
// intelligenceTrace, assistantName, pendingAction, topP and stopSequences used to
// exist only in Python, and chat() kept five options and dropped the rest.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana, { InvalidRequestError } from "../src/index.js";

const client = new Aivana({ apiKey: "ai_live_test" });
const body = (opts) => client._body(opts);

// aivana/client.py's WIRE_FIELDS, less `continue`: this SDK sends that inside
// `metadata` (see body.test.mjs), where the API and engine already read it.
const PYTHON_WIRE_FIELDS = [
  "assistant_name", "attachments", "effort", "intelligence_trace", "max_tokens",
  "messages", "metadata", "mode", "output_shape", "pending_action", "previous_intent",
  "prompt", "stop_sequences", "system", "temperature", "top_p", "web_search",
];

test("an option for every field the Python SDK sends", () => {
  const b = body({
    prompt: "hi", messages: [{ role: "user", content: "hi" }], system: "You are Acme.",
    assistantName: "Acme Copilot", temperature: 0.3, maxTokens: 256,
    outputShape: "summary", attachments: [{ mimeType: "image/png", data: "AAA" }],
    metadata: { trace: "1" }, previousIntent: "tech_comparison", pendingAction: "code_fix",
    webSearch: true, topP: 0.4, stopSequences: ["###"], intelligenceTrace: true,
    effort: "low",
  });
  assert.deepEqual(Object.keys(b).sort(), PYTHON_WIRE_FIELDS);
  assert.equal(b.assistant_name, "Acme Copilot");
  assert.equal(b.pending_action, "code_fix");
  assert.equal(b.web_search, true);
  assert.equal(b.top_p, 0.4);
  assert.deepEqual(b.stop_sequences, ["###"]);
  assert.equal(b.intelligence_trace, true);
  assert.equal(b.effort, "low");
});

test("new options are omitted unless the caller sets them", () => {
  const b = body({ prompt: "hi" });
  for (const field of ["assistant_name", "pending_action", "web_search", "top_p",
                       "stop_sequences", "intelligence_trace", "effort"]) {
    assert.equal(field in b, false, field);
  }
});

// Omitted means "you decide"; false means "never search". A truthiness check would
// turn every opt-out into the first.
test("webSearch false reaches the wire", () => {
  assert.equal(body({ prompt: "hi", webSearch: false }).web_search, false);
});

test("topP 0 reaches the wire", () => {
  const b = body({ prompt: "hi", topP: 0 });
  assert.equal("top_p" in b, true);
  assert.equal(b.top_p, 0);
});

test("an explicit intelligenceTrace false is forwarded, not dropped", () => {
  assert.equal(body({ prompt: "hi", intelligenceTrace: false }).intelligence_trace, false);
});

test("effort is normalised so High and high are one request", () => {
  assert.equal(body({ prompt: "hi", effort: "  High " }).effort, "high");
});

test("empty stopSequences are omitted", () => {
  assert.equal("stop_sequences" in body({ prompt: "hi", stopSequences: [] }), false);
});

function recordingClient(responses) {
  const sent = [];
  const client = new Aivana({
    apiKey: "k",
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      const answer = responses.shift() || {};
      return {
        ok: true,
        json: async () => ({
          id: "g", answer: "ok", intent: { name: "chat", confidence: 1, signal: "" },
          structured: null, structured_error: null, models_used: ["aivana-mmi"],
          usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, credits: 0 },
          latency_ms: 1, finish_reason: "stop", ...answer,
        }),
      };
    },
  });
  return { client, sent };
}

test("chat applies every option to every turn, and a send() option wins for its turn", async () => {
  const { client, sent } = recordingClient([]);
  const chat = client.chat({ webSearch: false, effort: "low", assistantName: "Acme Support",
                             system: "Three bullets maximum." });
  await chat.send("Refund after 40 days?");
  await chat.send("Summarise that as a table", { webSearch: true });

  for (const b of sent) {
    assert.equal(b.effort, "low");
    assert.equal(b.assistant_name, "Acme Support");
    assert.equal(b.system, "Three bullets maximum.");
  }
  assert.equal(sent[0].web_search, false);
  assert.equal(sent[1].web_search, true);
  assert.equal(chat.system, "Three bullets maximum.");
});

test("chat carries forward the last offer, and only the last", async () => {
  const { client, sent } = recordingClient([
    { pending_action: "code_fix" },   // "Want me to apply these fixes?"
    {},                                // a turn that offers nothing
  ]);
  const chat = client.chat();
  await chat.send("Review this function");
  await chat.send("yes");
  await chat.send("thanks");

  assert.equal("pending_action" in sent[0], false);
  assert.equal(sent[1].pending_action, "code_fix");
  assert.equal("pending_action" in sent[2], false, "a stale offer must not linger");
});

test("a 422 keeps the per-field list that says which field was wrong", async () => {
  const details = [{ loc: ["body", "temperature"], msg: "less than or equal to 2",
                     type: "less_than_equal" }];
  const client = new Aivana({
    apiKey: "k",
    fetch: async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: { type: "invalid_request", code: "invalid_request",
                                    message: "Request validation failed.",
                                    request_id: "req_1", details } }),
    }),
  });
  await assert.rejects(client.generate("hi", { temperature: 3 }), (err) => {
    assert.ok(err instanceof InvalidRequestError);
    assert.deepEqual(err.details, details);
    return true;
  });
});

test("errors without a field list carry an empty one", async () => {
  const client = new Aivana({
    apiKey: "k",
    fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  await assert.rejects(client.generate("hi"), (err) => {
    assert.deepEqual(err.details, []);
    return true;
  });
});
