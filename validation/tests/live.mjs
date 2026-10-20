// Live validation against the Aivana API, used the way an external developer would.
// Needs AIVANA_API_KEY. Defaults to https://dev-developers.aivana.ai (AIVANA_API_BASE to override).
// Calls use effort "low" and small maxTokens; a full run costs a few cents of credit at most.

import assert from "node:assert/strict";
import { Aivana, AivanaError, AuthError, InvalidRequestError } from "@aivana/sdk";
import { kase, skip } from "../lib/harness.mjs";

export const LIVE_BASE = (process.env.AIVANA_API_BASE || "https://dev-developers.aivana.ai").replace(/\/$/, "");
const DEFAULT_BASE = "https://api.aivana.ai";   // 0.7.1 moved the default here from developers.aivana.ai
const CHEAP = { effort: "low", maxTokens: 80 };
const BAD_KEY = "ai_test_definitely_not_a_real_key_000";
const live = (o = {}) => new Aivana({ apiKey: process.env.AIVANA_API_KEY, apiBase: LIVE_BASE, ...o });
const L = { live: true };

const summary = (r) => ({ id: r.id, request_id: r.request_id, finish_reason: r.finish_reason, usage: r.usage,
  latency_ms: r.latency_ms, notices: r.notices, models_used: r.models_used, answer_preview: (r.answer || "").slice(0, 160),
  has_trace: !!r.trace, structured: r.structured, structured_error: r.structured_error });
const errSummary = (e) => ({ class: e?.constructor?.name, code: e?.code, status: e?.status,
  message: String(e?.message).slice(0, 200), requestId: e?.requestId, details: e?.details });
const catchErr = async (p) => { try { await p; } catch (e) { return e; } assert.fail("expected an error"); };
const collect = async (it) => { const out = []; for await (const c of it) out.push(c); return out; };
const LEAK = ["gpt", "claude", "gemini", "llama", "mistral", "openai", "anthropic", "grok", "deepseek"];

// ------------------------------------------------------------------ auth / environment

kase("NODE-LIV-01", "Auth", "Invalid key -> AuthError with code, status and message", async (t) => {
  const e = await catchErr(live({ apiKey: BAD_KEY }).generate("ping", CHEAP));
  t.evidence({ base: LIVE_BASE, error: errSummary(e) });
  assert.ok(e instanceof AuthError); assert.equal(e.status, 401); assert.ok(e.code && e.message);
}, L);

kase("NODE-LIV-02", "Auth", "Errors carry requestId (dev host)", async () => {
  const e = await catchErr(live({ apiKey: BAD_KEY }).generate("ping", CHEAP));
  assert.ok(e.requestId);
}, L);

kase("NODE-LIV-03", "Auth", "A test key on the default (production) host is refused, and the error says it is from another environment (Docs > API Keys)", async (t) => {
  const e = await catchErr(new Aivana({ apiKey: process.env.AIVANA_API_KEY }).generate("Reply with the single word: ok", CHEAP));
  t.evidence({ base: DEFAULT_BASE, error: errSummary(e) });
  assert.ok(e instanceof AuthError);
  assert.match(e.message, /environment|test key/i);
}, { ...L, known: "F2: refusing ai_test_ keys on api.aivana.ai is by design (Docs > API Keys), but the 401 says 'Invalid or expired API key. Generate a new key', not that the key is from another environment" });

kase("NODE-LIV-04", "Auth", "Errors from the default (production) host also carry requestId", async (t) => {
  const e = await catchErr(new Aivana({ apiKey: BAD_KEY }).generate("ping", CHEAP));
  t.evidence({ base: DEFAULT_BASE, error: errSummary(e) });
  assert.ok(e.requestId);
}, { ...L, known: "F4: the production 401 body has no request_id and the SDK has no X-Request-Id fallback" });

// ------------------------------------------------------------------ generate

kase("NODE-LIV-10", "Generate", "Quickstart call returns answer, usage, finish_reason, notices", async (t) => {
  const t0 = Date.now();
  const r = await live().generate("Write a haiku about the ocean.", CHEAP);
  t.evidence({ response: summary(r), wall_ms: Date.now() - t0 });
  assert.ok(r.answer.trim()); assert.ok(r.id && r.request_id);
  assert.ok(r.usage.input_tokens > 0 && r.usage.output_tokens > 0);
  assert.ok(["stop", "length"].includes(r.finish_reason)); assert.ok(Array.isArray(r.notices));
}, L);

kase("NODE-LIV-11", "Generate", "maxTokens is a ceiling: output_tokens <= maxTokens", async (t) => {
  const r = await live().generate("Explain TCP vs UDP in detail.", { effort: "low", maxTokens: 40 });
  t.evidence({ response: summary(r) });
  assert.ok(r.usage.output_tokens <= 45, `output_tokens ${r.usage.output_tokens}`);
}, { ...L, known: "F11: maxTokens=40 returns 60+ billed output tokens with finish_reason stop" });

kase("NODE-LIV-12", "Generate", "intelligenceTrace returns trace with steps and summary", async (t) => {
  const r = await live().generate("Is Postgres or DynamoDB better for a write-heavy API?", { intelligenceTrace: true, ...CHEAP });
  t.evidence({ response: summary(r), trace_keys: Object.keys(r.trace || {}), steps: (r.trace?.steps || []).map((s) => s.title) });
  assert.ok(r.trace?.steps?.length && r.trace?.summary);
}, L);

kase("NODE-LIV-13", "Generate", "Trace stays customer-safe: no provider/model names leak", async (t) => {
  const r = await live().generate("Compare two approaches to caching.", { intelligenceTrace: true, ...CHEAP });
  const blob = (JSON.stringify(r.trace) + " " + r.models_used.join(" ")).toLowerCase();
  const leaked = LEAK.filter((w) => blob.includes(w));
  t.evidence({ models_used: r.models_used, leaked });
  assert.deepEqual(leaked, []);
}, L);

kase("NODE-LIV-14", "Generate", "assistantName is honoured", async (t) => {
  const r = await live().generate("Who are you? One sentence.", { assistantName: "Acme Copilot", ...CHEAP });
  t.evidence({ response: summary(r) });
  assert.match(r.answer.toLowerCase(), /acme/);
}, L);

kase("NODE-LIV-15", "Generate", "messages with a system message work (manual history)", async (t) => {
  const r = await live().generate(null, { messages: [
    { role: "system", content: "Always answer in exactly three words." },
    { role: "user", content: "My favourite colour is teal." }, { role: "assistant", content: "Teal is lovely." },
    { role: "user", content: "What is my favourite colour?" }], ...CHEAP });
  t.evidence({ response: summary(r) });
  assert.match(r.answer.toLowerCase(), /teal/);
}, L);

kase("NODE-LIV-16", "Generate", "webSearch false + a question asking for the web -> web_search_off notice", async (t) => {
  const r = await live().generate("Search the web for today's top tech headline.", { webSearch: false, ...CHEAP });
  t.evidence({ response: summary(r) });
  assert.ok(r.notices.some((n) => n.code === "web_search_off"));
}, L);

kase("NODE-LIV-17", "Generate", "stopSequences: the marker is not returned", async (t) => {
  const r = await live().generate("Print the numbers 1 to 10 separated by commas.", { stopSequences: ["5"], ...CHEAP });
  t.evidence({ response: summary(r) });
  assert.ok(!r.answer.includes("5") && !r.answer.includes("6"));
}, L);

kase("NODE-LIV-18", "Generate", "outputShape 'extract' returns structured or structured_error", async (t) => {
  const r = await live().generate("Invoice INV-204 from Acme Ltd, total due 1,250.00 USD.", { outputShape: "extract", temperature: 0, ...CHEAP });
  t.evidence({ response: summary(r) });
  assert.ok(r.structured != null || r.structured_error != null);
}, L);

const SCHEMA = { type: "object", properties: { vendorName: { type: "string" }, total: { type: "number" } },
  required: ["vendorName", "total"], additionalProperties: false };

kase("NODE-LIV-19", "Structured", "responseFormat json_schema -> validated structured (or response_format_not_available)", async (t) => {
  let r;
  try { r = await live().generate("Extract the invoice: Acme Ltd, total due 1,250.00", { responseFormat: { type: "json_schema", schema: SCHEMA }, maxTokens: 200 }); }
  catch (e) { t.evidence({ error: errSummary(e) }); if (e.code === "response_format_not_available") skip("JSON Schema not served here"); throw e; }
  t.evidence({ response: summary(r) });
  assert.deepEqual(Object.keys(r.structured).sort(), ["total", "vendorName"]);
  assert.equal(typeof r.structured.total, "number");
}, L);

kase("NODE-LIV-20", "Structured", "Unsupported schema -> InvalidRequestError invalid_response_schema", async (t) => {
  const e = await catchErr(live().generate("x", { responseFormat: { type: "json_schema", schema: { type: "array" } } }));
  t.evidence({ error: errSummary(e) });
  assert.ok(e instanceof InvalidRequestError);
  assert.ok(["invalid_response_schema", "response_format_not_available"].includes(e.code));
}, L);

kase("NODE-LIV-21", "Errors", "Out-of-range parameter (temperature 5) -> InvalidRequestError with details", async (t) => {
  const e = await catchErr(live().generate("x", { temperature: 5, ...CHEAP }));
  t.evidence({ error: errSummary(e) });
  assert.ok(e instanceof InvalidRequestError, `${e?.constructor?.name} ${e?.code}`);
  assert.ok(e.details.length);
}, L);

kase("NODE-LIV-22", "Structured", "A successful json_schema answer reports its output tokens", async (t) => {
  let r;
  try { r = await live().generate("Extract the invoice: Acme Ltd, total due 1,250.00", { responseFormat: { type: "json_schema", schema: SCHEMA }, maxTokens: 200 }); }
  catch (e) { if (e.code === "response_format_not_available") skip("JSON Schema not served here"); throw e; }
  t.evidence({ response: summary(r) });
  assert.ok(r.usage.output_tokens > 0, "output_tokens is 0");
}, { ...L, known: "F13: json_schema success reports usage.output_tokens = 0" });

// ------------------------------------------------------------------ streaming

kase("NODE-LIV-23", "Generate", "effort is a ceiling: effort 'low' keeps a decision question below the top level (Premium)", async (t) => {
  const r = await live().generate("Should we move billing off Stripe before the Series A? One sentence.",
                                  { effort: "low", intelligenceTrace: true, maxTokens: 60 });
  const s = (r.trace && r.trace.summary) || {};
  t.evidence({ response: summary(r), intelligence_level: s.intelligence_level, route: s.route, perspectives: s.perspectives });
  assert.notEqual(s.intelligence_level, "Premium");
}, { ...L, known: "F16: effort low and high gave the same intelligence_level (Premium), route and 3 perspectives on decision questions (Python run, 2026-10-20)" });

kase("NODE-LIV-30", "Streaming", "Stream completes: deltas join into the answer; done carries usage/notices", async (t) => {
  const t0 = Date.now(); let first = null; const chunks = [];
  for await (const c of live().generateStream("Count from 1 to 15, one number per line.", CHEAP)) {
    if (c.event === "delta" && first == null) first = Date.now() - t0;
    chunks.push(c);
  }
  const ev = chunks.map((c) => c.event); const done = chunks.find((c) => c.event === "done");
  const samples = {}; for (const c of chunks) if (!["delta", "done"].includes(c.event) && !samples[c.event]) samples[c.event] = c.data;
  t.evidence({ events: [...new Set(ev)], n_delta: ev.filter((e) => e === "delta").length, first_delta_ms: first,
               total_ms: Date.now() - t0, other_event_samples: samples, done: done?.data });
  assert.ok(ev.includes("delta"), "no delta events");
  assert.ok(done, "no done event");
  for (const k of ["usage", "finish_reason", "notices"]) assert.ok(k in done.data, k);
}, L);

kase("NODE-LIV-37", "Streaming", "A long answer streams incrementally (first text well before the end)", async (t) => {
  const t0 = Date.now(); let first = null; const times = []; let chars = 0;
  for await (const c of live().generateStream("Write about 300 words on the history of the printing press.", { effort: "low", maxTokens: 500 })) {
    if (c.event === "delta") { const ms = Date.now() - t0; if (first == null) first = ms; times.push(ms); chars += (c.data.text || "").length; }
  }
  const total = Date.now() - t0;
  t.evidence({ n_delta: times.length, first_delta_ms: first, total_ms: total, chars,
               delta_times_ms: times.slice(0, 40), first_as_pct_of_total: Math.round(100 * first / total) });
  assert.ok(times.length >= 5, `only ${times.length} delta event(s) for ${chars} chars`);
  assert.ok(first < total * 0.6, `first text at ${first} ms of ${total} ms`);
}, { ...L, known: "F15: the stream starts only after the answer is mostly done (first text at 86% of total time on Oct 5)", timeoutMs: 180_000 });

kase("NODE-LIV-31", "Streaming", "Stream + intelligenceTrace emits trace events", async (t) => {
  const ev = (await collect(live().generateStream("Pros and cons of microservices?", { intelligenceTrace: true, ...CHEAP }))).map((c) => c.event);
  t.evidence({ events: [...new Set(ev)], n_trace: ev.filter((e) => e === "trace").length });
  assert.ok(ev.includes("trace"));
}, L);

kase("NODE-LIV-32", "Streaming", "Invalid key on the stream throws AuthError", async () => {
  const e = await catchErr(collect(live({ apiKey: BAD_KEY }).generateStream("x", CHEAP)));
  assert.ok(e instanceof AuthError);
}, L);

kase("NODE-LIV-34", "Streaming", "Without intelligenceTrace, a stream sends only documented events", async (t) => {
  const extra = {};
  for (const c of await collect(live().generateStream("Name three prime numbers.", CHEAP))) {
    if (!["delta", "done", "error"].includes(c.event)) (extra[c.event] ||= []).push(c.data);
  }
  t.evidence({ undocumented_events: Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v.slice(0, 3)])) });
  assert.deepEqual(Object.keys(extra), []);
}, { ...L, known: "F14: streams also carry undocumented route and stage events" });

kase("NODE-LIV-35", "Streaming", "Stream route/stage/trace payloads stay customer-safe", async (t) => {
  const chunks = await collect(live().generateStream("Compare REST and GraphQL briefly.", { intelligenceTrace: true, ...CHEAP }));
  const blob = chunks.filter((c) => c.event !== "delta").map((c) => JSON.stringify(c.data)).join(" ").toLowerCase();
  const leaked = LEAK.filter((w) => blob.includes(w));
  t.evidence({ non_delta_events: [...new Set(chunks.map((c) => c.event).filter((e) => e !== "delta"))], leaked });
  assert.deepEqual(leaked, []);
}, L);

kase("NODE-LIV-36", "Streaming", "An AbortSignal stops a live stream mid-answer", async (t) => {
  const ac = new AbortController(); let deltas = 0; let abortedAt = null; const t0 = Date.now();
  const run = (async () => {
    for await (const c of live().generateStream("Write about 400 words on the history of the printing press.", { effort: "low", signal: ac.signal })) {
      if (c.event === "delta") { deltas++; if (!abortedAt) { abortedAt = Date.now(); ac.abort(); } }
    }
  })().then(() => "ended normally", (e) => `rejected (${e?.name})`);
  // Wait up to 90 s for the first text, then give the abort 3 s to take effect.
  let outcome;
  while (true) {
    outcome = await Promise.race([run, new Promise((r) => setTimeout(() => r(null), 250))]);
    if (outcome) break;
    if (!abortedAt && Date.now() - t0 > 90_000) skip("no text arrived within 90 s; cannot test abort");
    if (abortedAt && Date.now() - abortedAt > 3000) { outcome = "still running 3 s after abort"; break; }
  }
  t.evidence({ outcome, deltas_seen: deltas, first_delta_ms: abortedAt && abortedAt - t0,
               ms_from_abort_to_outcome: abortedAt && Date.now() - abortedAt });
  assert.match(outcome, /^rejected/, `after abort: ${outcome}`);
}, { ...L, known: "N1: once streaming starts, the AbortSignal is detached and cannot stop it", timeoutMs: 180_000 });

// ------------------------------------------------------------------ chat / quotas

kase("NODE-LIV-40", "Conversations", "chat() remembers earlier turns", async (t) => {
  const chat = live().chat({ system: "Answer in one short sentence.", ...CHEAP });
  await chat.send("My project codename is BLUE HERON.");
  const r = await chat.send("What is my project codename?");
  t.evidence({ turns: chat.messages.length, answer: r.answer.slice(0, 120) });
  assert.match(r.answer.toLowerCase(), /heron/);
}, L);

kase("NODE-LIV-50", "Quotas", "quotas() returns hour/day/month windows (README > Quotas)", async (t) => {
  let q;
  try { q = await live().quotas(); } catch (e) { t.evidence({ error: errSummary(e) }); throw e; }
  t.evidence({ windows: Object.keys(q.windows || {}), day: q.windows?.day });
  assert.ok(q.windows && q.windows.day && q.windows.day.input_tokens);
}, L);
