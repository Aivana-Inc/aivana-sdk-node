// Offline validation of @aivana/sdk (no key, no network, no credit).
// IDs mirror the Python suite (PY-XXX-NN -> NODE-XXX-NN) so the SDKs compare row by row.
// `known:` cases assert DOCUMENTED behaviour the SDK does not meet; the finding IDs
// (F1...) match the Python report, N1/N2 are Node-only.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AivanaDefault, * as sdk from "@aivana/sdk";
import { kase, ROOT } from "../lib/harness.mjs";
import { OFFLINE_BASE, REAL_OK, REAL_401, err, json, sse, sseResponse, mockFetch, endlessStream } from "../lib/mock.mjs";

const { Aivana, Chat, AivanaError, AuthError, ForbiddenError, RateLimitError, InvalidRequestError, UpstreamError } = sdk;
const client = (fetch, extra = {}) => new Aivana({ apiKey: "ai_test_offline", apiBase: OFFLINE_BASE, fetch, ...extra });
const rejects = async (p, cls, check) => {
  let caught;
  try { await p; } catch (e) { caught = e; }
  assert.ok(caught, "expected a rejection, got success");
  if (cls) assert.ok(caught instanceof cls, `expected ${cls.name}, got ${caught?.constructor?.name}: ${caught?.message}`);
  if (check) check(caught);
  return caught;
};
const collect = async (it) => { const out = []; for await (const c of it) out.push(c); return out; };

// ------------------------------------------------------------------ install

kase("NODE-INS-01", "Install", "Package installs from npm and reports its version", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "node_modules/@aivana/sdk/package.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
});

kase("NODE-INS-02", "Install", "Runs on the documented minimum (Node >= 18)", () => {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 18);
});

kase("NODE-INS-03", "Install", "Every name the docs use is exported (default + named)", () => {
  for (const n of ["Aivana", "Chat", "AivanaError", "AuthError", "ForbiddenError", "RateLimitError",
                   "InvalidRequestError", "UpstreamError"]) assert.ok(sdk[n], n);
  assert.equal(AivanaDefault, Aivana);
});

// ------------------------------------------------------------------ configure

kase("NODE-CFG-01", "Configure", "apiKey option is sent as X-API-Key", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await client(f).generate("hi");
  assert.equal(f.last().headers["X-API-Key"], "ai_test_offline");
});

kase("NODE-CFG-05", "Configure", "No key: no header sent; 401 is AuthError and names the missing key", async () => {
  const f = mockFetch(json(401, REAL_401));
  const c = new Aivana({ apiBase: OFFLINE_BASE, fetch: f });
  await rejects(c.generate("hi"), AuthError, (e) => {
    assert.equal(e.code, "invalid_api_key");
    assert.match(e.message, /No API key was set/);
  });
  assert.ok(!("X-API-Key" in f.last().headers));
});

kase("NODE-CFG-06", "Configure", "Default apiBase is the documented hosted API; trailing slash normalised", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await new Aivana({ apiKey: "k", fetch: f }).generate("hi");
  assert.equal(f.last().url, "https://api.aivana.ai/v1/generate");   // 0.7.1+ (developers.aivana.ai before 2026-10-11)
  assert.equal(new Aivana({ apiBase: "https://x.test/" }).apiBase, "https://x.test");
});

kase("NODE-CFG-07", "Configure", "Docs Quickstart Node snippet runs as written (default import, intelligenceTrace)", async () => {
  const f = mockFetch(json(200, { ...REAL_OK, trace: { steps: [], summary: {} } }));
  const c = new AivanaDefault({ apiKey: process.env.AIVANA_API_KEY || "ai_test_x", apiBase: OFFLINE_BASE, fetch: f });
  const response = await c.generate("Write a haiku about the ocean.", { intelligenceTrace: true });
  assert.ok(response.answer && response.trace);
  assert.equal(f.last().body.intelligence_trace, true);
});

kase("NODE-CFG-08", "Configure", "Requests omit cookies and never follow redirects", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await client(f).generate("hi");
  assert.equal(f.last().init.credentials, "omit");
  assert.equal(f.last().init.redirect, "manual");
});

// ------------------------------------------------------------------ generate

kase("NODE-GEN-01", "Generate", "Parses a real dev-API response: answer, usage, finish_reason, notices", async () => {
  const res = await client(mockFetch(json(200, REAL_OK))).generate("Write a haiku about the ocean.");
  assert.match(res.answer, /^Moon/);
  assert.equal(res.usage.output_tokens, 23);
  assert.equal(res.finish_reason, "stop");
  assert.deepEqual(res.notices, []);
});

kase("NODE-GEN-02", "Generate", "POSTs /v1/generate with prompt; unset options are omitted", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await client(f).generate("hello");
  assert.equal(f.last().url, OFFLINE_BASE + "/v1/generate");
  assert.equal(f.last().init.method, "POST");
  assert.deepEqual(f.last().body, { mode: "aivana_mmi", prompt: "hello" });
});

kase("NODE-GEN-03", "Generate", "camelCase options reach the wire in snake_case", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await client(f).generate("q", { effort: "HIGH", webSearch: false, topP: 0, temperature: 0.2, maxTokens: 50,
    stopSequences: ["###"], intelligenceTrace: true, outputShape: "summary", system: "Be brief.",
    assistantName: "Acme", metadata: { k: "v" } });
  const b = f.last().body;
  assert.equal(b.effort, "high");
  assert.equal(b.web_search, false);
  assert.equal(b.top_p, 0);
  assert.equal(b.temperature, 0.2); assert.equal(b.max_tokens, 50);
  assert.deepEqual(b.stop_sequences, ["###"]); assert.equal(b.intelligence_trace, true);
  assert.equal(b.output_shape, "summary"); assert.equal(b.system, "Be brief.");
  assert.equal(b.assistant_name, "Acme"); assert.deepEqual(b.metadata, { k: "v" });
});

kase("NODE-GEN-04", "Generate", "System prompt > 8000 chars rejected before any request", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await rejects(client(f).generate("q", { system: "x".repeat(8001) }), InvalidRequestError);
  assert.equal(f.calls.length, 0);
});

kase("NODE-GEN-05", "Generate", "Attachments: mimeType normalised to mime_type", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await client(f).generate("q", { attachments: [{ mimeType: "image/png", data: "AAAA" }] });
  assert.deepEqual(f.last().body.attachments, [{ mime_type: "image/png", data: "AAAA" }]);
});

kase("NODE-GEN-06", "Generate", "responseFormat sent exactly as given (schema keys not re-cased); non-object rejected", async () => {
  const f = mockFetch(json(200, REAL_OK));
  const fmt = { type: "json_schema", schema: { type: "object", properties: { vendorName: { type: "string" } } } };
  await client(f).generate("q", { responseFormat: fmt });
  assert.deepEqual(f.last().body.response_format, fmt);
  await rejects(client(f).generate("q", { responseFormat: "json" }), InvalidRequestError);
});

kase("NODE-GEN-07", "Generate", "Tolerates new fields the server adds (forward compatible)", async () => {
  const res = await client(mockFetch(json(200, { ...REAL_OK, brand_new_field: { x: 1 } }))).generate("q");
  assert.ok(res.answer);
});

kase("NODE-GEN-08", "Generate", "Non-JSON 200 (proxy page) throws AivanaError, not SyntaxError", async () => {
  const f = mockFetch(new Response("<html>gateway</html>", { status: 200 }));
  await rejects(client(f).generate("q"), AivanaError, (e) => assert.equal(e.code, "invalid_response"));
});

kase("NODE-GEN-09", "Generate", "Redirects are reported, so the key never leaves apiBase", async () => {
  const f = mockFetch(new Response(null, { status: 307, headers: { Location: "https://evil.test/" } }));
  await rejects(client(f).generate("q"), AivanaError, (e) => assert.equal(e.code, "redirect"));
});

kase("NODE-GEN-10", "Generate", "An AbortSignal cancels an in-flight generate() (README > Configuration)", async () => {
  const f = mockFetch((url, init) => new Promise((_, rej) => {
    init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
  }));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await rejects(client(f).generate("q", { signal: ac.signal }));
});

kase("NODE-GEN-11", "Generate", "messages are sent instead of prompt (manual history)", async () => {
  const f = mockFetch(json(200, REAL_OK));
  const msgs = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }];
  await client(f).generate(null, { messages: msgs, previousIntent: "creative" });
  assert.deepEqual(f.last().body.messages, msgs);
  assert.ok(!("prompt" in f.last().body));
  assert.equal(f.last().body.previous_intent, "creative");
});

kase("NODE-GEN-12", "Generate", "continue: true is sent as metadata.continue (README > Resuming)", async () => {
  const f = mockFetch(json(200, REAL_OK));
  await client(f).generate(null, { messages: [{ role: "user", content: "a" }], continue: true, metadata: { k: 1 } });
  assert.deepEqual(f.last().body.metadata, { k: 1, continue: true });
});

// ------------------------------------------------------------------ streaming

const STREAM_OK = sse(["delta", { text: "Hello " }], ["delta", { text: "world" }],
  ["done", { usage: { input_tokens: 3, output_tokens: 2 }, finish_reason: "stop", notices: [] }]);

kase("NODE-STR-01", "Streaming", "generateStream yields deltas that join into the answer; done carries usage", async () => {
  const chunks = await collect(client(mockFetch(sseResponse(STREAM_OK))).generateStream("q"));
  assert.equal(chunks.filter((c) => c.event === "delta").map((c) => c.data.text).join(""), "Hello world");
  const done = chunks.find((c) => c.event === "done");
  assert.equal(done.data.finish_reason, "stop");
  assert.ok("notices" in done.data);
});

kase("NODE-STR-02", "Streaming", "Streams POST /v1/generate:stream with the same body", async () => {
  const f = mockFetch(sseResponse(STREAM_OK));
  await collect(client(f).generateStream("q", { effort: "low" }));
  assert.equal(f.last().url, OFFLINE_BASE + "/v1/generate:stream");
  assert.equal(f.last().body.effort, "low");
});

kase("NODE-STR-03", "Streaming", "responseFormat json_schema + stream refused client-side with the documented code", async () => {
  const f = mockFetch(sseResponse(STREAM_OK));
  await rejects(collect(client(f).generateStream("q", { responseFormat: { type: "json_schema", schema: {} } })),
    InvalidRequestError, (e) => assert.equal(e.code, "structured_output_streaming_not_supported"));
  assert.equal(f.calls.length, 0);
});

kase("NODE-STR-04", "Streaming", "HTTP 401 on the stream throws AuthError", async () => {
  await rejects(collect(client(mockFetch(json(401, REAL_401))).generateStream("q")), AuthError);
});

kase("NODE-STR-05", "Streaming", "Leaving a for-await loop early cancels the response body", async () => {
  let s;
  const f = mockFetch((url, init) => { s = endlessStream(init); return s.response; });
  for await (const c of client(f).generateStream("q")) { if (c.event === "delta") break; }
  await new Promise((r) => setTimeout(r, 50));
  const cancelled = s.state.cancelled || s.state.aborted;
  s.stop();
  assert.ok(cancelled, "body still open after break: the server keeps generating (and billing) the rest");
}, { known: "N2: breaking out of a stream only releases the reader; the response body is never cancelled, so the request keeps running" });

kase("NODE-STR-06", "Streaming", "Unknown/trace events pass through without breaking iteration", async () => {
  const body = sse(["trace", { step: { status: "started" } }], ["future_event", { x: 1 }], ["delta", { text: "ok" }], ["done", {}]);
  const chunks = await collect(client(mockFetch(sseResponse(body))).generateStream("q", { intelligenceTrace: true }));
  assert.deepEqual(chunks.map((c) => c.event), ["trace", "future_event", "delta", "done"]);
});

kase("NODE-STR-07", "Streaming", "Mid-stream `error` event throws AivanaError ('every failure throws')", async () => {
  const body = sse(["delta", { text: "partial" }], ["error", { code: "upstream", message: "engine failed", request_id: "req_x" }]);
  let text = "";
  await rejects((async () => {
    for await (const chunk of client(mockFetch(sseResponse(body))).generateStream("q")) {
      if (chunk.event === "delta") text += chunk.data.text;      // README streaming example
    }
  })(), AivanaError);
}, { known: "F1: a mid-stream error event is yielded as an ordinary chunk; the README loop ends silently with a partial answer" });

kase("NODE-STR-08", "Streaming", "An AbortSignal stops a stream that is already sending", async () => {
  let s;
  const f = mockFetch((url, init) => { s = endlessStream(init); return s.response; });
  const ac = new AbortController();
  let n = 0;
  const run = (async () => { for await (const c of client(f).generateStream("q", { signal: ac.signal })) { if (++n === 2) ac.abort(); } })();
  const outcome = await Promise.race([run.then(() => "ended", () => "rejected"),
    new Promise((r) => setTimeout(() => r("still running"), 400))]);
  s.stop();
  assert.equal(outcome, "rejected", "abort after the first chunks had no effect");
}, { known: "N1: the signal and timeout listeners are removed once headers arrive, so neither can stop a stream mid-answer" });

kase("NODE-STR-09", "Streaming", "timeoutMs still applies while a stream is being read", async () => {
  let s;
  const f = mockFetch((url, init) => { s = endlessStream(init); return s.response; });
  const run = (async () => { for await (const _ of client(f, { timeoutMs: 100 }).generateStream("q")) { /* read */ } })();
  const outcome = await Promise.race([run.then(() => "ended", () => "rejected"),
    new Promise((r) => setTimeout(() => r("still running"), 500))]);
  s.stop();
  assert.equal(outcome, "rejected", "stream kept running past timeoutMs");
}, { known: "N1: timeoutMs is cleared as soon as response headers arrive; a stalled stream hangs forever" });

// ------------------------------------------------------------------ errors

const MAP = [
  [401, REAL_401, AuthError, "invalid_api_key"],
  [403, err("forbidden"), ForbiddenError, "forbidden"],
  [400, err("invalid_request"), InvalidRequestError, "invalid_request"],
  [422, err("invalid_response_schema", { details: [{ loc: ["schema"], msg: "bad", type: "x" }] }), InvalidRequestError, "invalid_response_schema"],
  [422, err("invalid_request", { details: [{ loc: ["body", "temperature"], msg: "<= 2", type: "x" }] }), InvalidRequestError, "invalid_request"],
  [429, err("rate_limit_exceeded", { retry_after_ms: 12000 }), RateLimitError, "rate_limit_exceeded"],
  [429, err("spend_limit_reached"), RateLimitError, "spend_limit_reached"],
  [502, err("structured_output_failed"), UpstreamError, "structured_output_failed"],
  [402, err("insufficient_credit"), AivanaError, "insufficient_credit"],
];
kase("NODE-ERR-01", "Errors", "Each documented status maps to the documented AivanaError subclass + code", async () => {
  for (const [status, body, cls, code] of MAP) {
    await rejects(client(mockFetch(json(status, body))).generate("q"), cls, (e) => {
      assert.ok(e instanceof AivanaError);
      assert.equal(e.code, code, `HTTP ${status}`);
      assert.equal(e.status, status);
    });
  }
});

kase("NODE-ERR-02", "Errors", "422 details (which field is wrong) are kept on the error", async () => {
  const d = [{ loc: ["body", "temperature"], msg: "<= 2", type: "less_than_equal" }];
  await rejects(client(mockFetch(json(422, err("invalid_request", { details: d })))).generate("q"), InvalidRequestError,
    (e) => { assert.deepEqual(e.details, d); assert.equal(e.requestId, "req_test"); });
});

kase("NODE-ERR-03", "Errors", "Any 422 is an InvalidRequestError (README: validation error = InvalidRequestError)", async () => {
  await rejects(client(mockFetch(json(422, err("validation_error")))).generate("q", { temperature: 5 }), InvalidRequestError);
}, { known: "F3: a 422 whose code is not on the SDK's allowlist falls through to base AivanaError" });

kase("NODE-ERR-04", "Errors", "requestId available on errors (falls back to X-Request-Id header)", async () => {
  await rejects(client(mockFetch(json(401, REAL_401, { "X-Request-Id": "req_from_header" }))).generate("q"), AuthError,
    (e) => assert.equal(e.requestId, "req_from_header"));
}, { known: "F4: requestId is read only from the body; production 401 bodies have none, so it is null" });

kase("NODE-ERR-05", "Errors", "Network failure throws an AivanaError subclass ('every failure throws')", async () => {
  const f = mockFetch(() => { throw new TypeError("fetch failed"); });
  await rejects(client(f).generate("q"), AivanaError);
}, { known: "F5: fetch's TypeError('fetch failed') escapes unwrapped; `instanceof AivanaError` misses it" });

kase("NODE-ERR-06", "Errors", "timeoutMs expiry throws an AivanaError subclass", async () => {
  const f = mockFetch((url, init) => new Promise((_, rej) => {
    init.signal.addEventListener("abort", () => rej(new DOMException("This operation was aborted", "AbortError")));
  }));
  await rejects(client(f, { timeoutMs: 50 }).generate("q"), AivanaError);
}, { known: "F5: a timeout surfaces as a bare DOMException AbortError, indistinguishable from a caller's own abort" });

kase("NODE-ERR-07", "Errors", "RateLimitError exposes the Retry-After wait the docs say to honour", async () => {
  await rejects(client(mockFetch(json(429, err("rate_limit_exceeded", { retry_after_ms: 12000 }), { "Retry-After": "12" }))).generate("q"),
    RateLimitError, (e) => assert.ok(e.retryAfterMs === 12000 || e.retryAfter === 12, "no retry-after on the error"));
}, { known: "F6: retry_after_ms / Retry-After are dropped" });

kase("NODE-ERR-08", "Errors", "504 (documented retryable) throws a retryable error class", async () => {
  await rejects(client(mockFetch(json(504, err("timeout")))).generate("q"), UpstreamError);
}, { known: "F7: 504 (and 413/500/503) become base AivanaError; only 502 is UpstreamError" });

// ------------------------------------------------------------------ chat

const ok = (answer, intent = "general", pending = null) =>
  json(200, { ...REAL_OK, answer, intent: { name: intent, confidence: 1 }, pending_action: pending });

kase("NODE-CHT-01", "Conversations", "chat() sends full history plus previous_intent / pending_action", async () => {
  const f = mockFetch((u, i, n) => n === 0 ? ok("A1", "advice", "offer_example") : ok("A2"));
  const chat = client(f).chat();
  await chat.send("Q1"); await chat.send("Q2");
  const b = f.last().body;
  assert.deepEqual(b.messages.map((m) => m.content), ["Q1", "A1", "Q2"]);
  assert.equal(b.previous_intent, "advice"); assert.equal(b.pending_action, "offer_example");
});

kase("NODE-CHT-02", "Conversations", "chat options apply every turn; send() options win for that turn", async () => {
  const f = mockFetch(() => ok("A"));
  const chat = client(f).chat({ system: "Three bullets.", webSearch: true });
  await chat.send("Q1");
  assert.equal(f.last().body.system, "Three bullets."); assert.equal(f.last().body.web_search, true);
  await chat.send("Q2", { webSearch: false });
  assert.equal(f.last().body.web_search, false); assert.equal(f.last().body.system, "Three bullets.");
});

kase("NODE-CHT-03", "Conversations", "reset() starts a fresh conversation", async () => {
  const f = mockFetch(() => ok("A"));
  const chat = client(f).chat();
  await chat.send("Q1"); chat.reset(); await chat.send("Q2");
  assert.deepEqual(f.last().body.messages.map((m) => m.content), ["Q2"]);
});

kase("NODE-CHT-04", "Conversations", "A failed send() does not corrupt history (retry is safe)", async () => {
  const f = mockFetch((u, i, n) => n === 0 ? json(502, err("upstream")) : ok("A"));
  const chat = client(f).chat();
  await rejects(chat.send("Q1"), UpstreamError);
  await chat.send("Q1");
  assert.deepEqual(f.last().body.messages.map((m) => m.content), ["Q1"]);
}, { known: "F8: the user turn is pushed before the request; on error it stays, so a retry sends the question twice" });

kase("NODE-CHT-05", "Conversations", "chat.continue() appends the continuation onto the last answer", async () => {
  const f = mockFetch((u, i, n) => n === 0 ? json(200, { ...REAL_OK, answer: "Part one", finish_reason: "length" }) : ok(" part two"));
  const chat = client(f).chat();
  await chat.send("Write a long thing");
  await chat.continue();
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[1].content, "Part one part two");
  assert.equal(f.last().body.metadata.continue, true);
});

// ------------------------------------------------------------------ quotas

kase("NODE-QTA-01", "Quotas", "quotas() GETs /v1/quotas with the key and returns windows", async () => {
  const body = { windows: { day: { input_tokens: { used: 5, limit: 100, pending: 0 }, output_tokens: { used: 1, limit: 100, pending: 0 } } } };
  const f = mockFetch(json(200, body));
  const q = await client(f).quotas();
  assert.equal(f.last().url, OFFLINE_BASE + "/v1/quotas");
  assert.equal(f.last().init.method, undefined);           // GET
  assert.equal(q.windows.day.input_tokens.used, 5);
});
