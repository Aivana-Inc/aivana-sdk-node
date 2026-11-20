// Retries and Retry-After.
//
// Only a per-minute rate limit is retried, because the API refuses it before doing any work,
// so asking again cannot bill twice. Everything else that can go wrong, a quota, a timeout, a
// 5xx, a dropped connection, may have been billed, and must reach the caller untouched. Most
// of this file is that second half: it is what keeps a retry from costing a customer money.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana, {
  AivanaError, AuthError, ForbiddenError, InvalidRequestError, RateLimitError, UpstreamError,
} from "../src/index.js";

const OK = { answer: "hello", intent: { name: "x", confidence: 0 }, models_used: [], usage: {} };

const limited = (headers = {}, code = "rate_limit_exceeded", extra = {}) => ({
  ok: false, status: 429,
  headers: new Headers(headers),
  json: async () => ({ error: { type: code, code, message: "Too many requests from this IP.", request_id: "r1", ...extra } }),
});
const good = () => ({ ok: true, status: 200, headers: new Headers(), json: async () => OK });

/** A client whose fetch answers from a script, one entry per request, recording each request.
 *  Its waits are recorded, not taken, so no test sleeps. */
function scripted(responses, cfg = {}) {
  const calls = [];
  const waits = [];
  const client = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next() : next;
    },
    ...cfg,
  });
  client._sleep = async (ms) => { waits.push(ms); };
  return { client, calls, waits };
}

// --- reading Retry-After ----------------------------------------------------

test("a rate-limit error carries the seconds the API said to wait", async () => {
  const { client } = scripted([limited({ "Retry-After": "7" })], { maxRetries: 0 });
  await assert.rejects(() => client.generate("hi"), (e) => {
    assert.ok(e instanceof RateLimitError);
    assert.equal(e.retryAfter, 7);
    return true;
  });
});

test("Retry-After as an HTTP date becomes seconds from now", async () => {
  const at = new Date(Date.now() + 20_000).toUTCString();
  const { client } = scripted([limited({ "Retry-After": at })], { maxRetries: 0 });
  await assert.rejects(() => client.generate("hi"), (e) => {
    assert.ok(e.retryAfter > 17 && e.retryAfter <= 20, `got ${e.retryAfter}`);
    return true;
  });
});

test("a Retry-After that is not a wait is null, never a wait", async () => {
  for (const bad of ["", "soon", "-5", "NaN"]) {
    const { client } = scripted([limited({ "Retry-After": bad })], { maxRetries: 0 });
    await assert.rejects(() => client.generate("hi"), (e) => { assert.equal(e.retryAfter, null, bad); return true; });
  }
  const { client } = scripted([limited({})], { maxRetries: 0 });
  await assert.rejects(() => client.generate("hi"), (e) => { assert.equal(e.retryAfter, null); return true; });
});

test("the body's retry_after_ms is used when there is no header", async () => {
  const { client } = scripted([limited({}, "rate_limit_exceeded", { retry_after_ms: 2500 })], { maxRetries: 0 });
  await assert.rejects(() => client.generate("hi"), (e) => { assert.equal(e.retryAfter, 2.5); return true; });
});

test("the header wins over the body", async () => {
  const { client } = scripted([limited({ "Retry-After": "4" }, "rate_limit_exceeded", { retry_after_ms: 9000 })], { maxRetries: 0 });
  await assert.rejects(() => client.generate("hi"), (e) => { assert.equal(e.retryAfter, 4); return true; });
});

test("only a rate-limit error has retryAfter; other errors are unchanged", async () => {
  const resp = { ok: false, status: 401, headers: new Headers({ "Retry-After": "5" }),
                 json: async () => ({ error: { code: "auth", message: "no" } }) };
  const { client } = scripted([resp]);
  await assert.rejects(() => client.generate("hi"), (e) => { assert.ok(e instanceof AuthError); assert.equal("retryAfter" in e, false); return true; });
});

// --- retrying a per-minute rate limit ---------------------------------------

test("a rate limit is retried and the call then succeeds", async () => {
  const { client, calls, waits } = scripted([limited({ "Retry-After": "2" }), good()]);
  const res = await client.generate("hi");
  assert.equal(res.answer, "hello");
  assert.equal(calls.length, 2);
  assert.equal(waits.length, 1);
});

test("the wait is at least what the API said, and a little more so everyone behind one address does not return together", async () => {
  const { client, waits } = scripted([limited({ "Retry-After": "2" }), good()]);
  await client.generate("hi");
  assert.ok(waits[0] >= 2000, `waited ${waits[0]}`);
  assert.ok(waits[0] <= 2500, `waited ${waits[0]}`);  // jitter is at most a quarter, and never more than a second
});

test("with no Retry-After the wait backs off: about one second, then about two", async () => {
  const { client, waits } = scripted([limited(), limited(), good()]);
  await client.generate("hi");
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 1000 && waits[0] <= 1250, `first ${waits[0]}`);
  assert.ok(waits[1] >= 2000 && waits[1] <= 2500, `second ${waits[1]}`);
});

test("every attempt sends the same request, once, with the key", async () => {
  const { client, calls } = scripted([limited({ "Retry-After": "0" }), limited({ "Retry-After": "0" }), good()]);
  await client.generate("same question", { webSearch: false });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((c) => c.init.body)).size, 1);
  for (const c of calls) {
    assert.equal(c.init.headers["X-API-Key"], "ai_live_test");
    assert.equal(c.init.method, "POST");
  }
});

test("it gives up after maxRetries and throws the last rate-limit error", async () => {
  const { client, calls } = scripted([limited({ "Retry-After": "0" })]);
  await assert.rejects(() => client.generate("hi"), (e) => { assert.ok(e instanceof RateLimitError); return true; });
  assert.equal(calls.length, 3);  // the first try and the default two retries
});

test("maxRetries: 0 asks once", async () => {
  const { client, calls } = scripted([limited({ "Retry-After": "0" })], { maxRetries: 0 });
  await assert.rejects(() => client.generate("hi"), RateLimitError);
  assert.equal(calls.length, 1);
});

test("a call's own maxRetries overrides the client's, in both directions", async () => {
  let s = scripted([limited({ "Retry-After": "0" })], { maxRetries: 5 });
  await assert.rejects(() => s.client.generate("hi", { maxRetries: 1 }), RateLimitError);
  assert.equal(s.calls.length, 2);
  s = scripted([limited({ "Retry-After": "0" }), good()], { maxRetries: 0 });
  assert.equal((await s.client.generate("hi", { maxRetries: 3 })).answer, "hello");
  assert.equal(s.calls.length, 2);
});

test("a wait longer than maxRetryWaitMs is not taken: the error is thrown at once", async () => {
  const { client, calls, waits } = scripted([limited({ "Retry-After": "120" })]);  // default ceiling is 30 s
  await assert.rejects(() => client.generate("hi"), (e) => { assert.equal(e.retryAfter, 120); return true; });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test("maxRetryWaitMs is the caller's to set", async () => {
  const { client, calls } = scripted([limited({ "Retry-After": "40" }), good()], { maxRetryWaitMs: 60_000 });
  assert.equal((await client.generate("hi")).answer, "hello");
  assert.equal(calls.length, 2);
});

test("retries work for chat() turns", async () => {
  const { client, calls } = scripted([limited({ "Retry-After": "0" }), good()]);
  const chat = client.chat();
  assert.equal((await chat.send("hi")).answer, "hello");
  assert.equal(calls.length, 2);
});

test("a refused request is retried before streaming starts", async () => {
  const sse = {
    ok: true, status: 200, headers: new Headers(),
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: done\ndata: {"ok":true}\n\n')); c.close(); } }),
  };
  const { client, calls } = scripted([limited({ "Retry-After": "0" }), sse]);
  const chunks = [];
  for await (const c of client.generateStream("hi")) chunks.push(c);
  assert.equal(calls.length, 2);
  assert.ok(chunks.length >= 1);
});

test("quotas() retries a rate limit the same way", async () => {
  const quotas = { ok: true, status: 200, headers: new Headers(), json: async () => ({ windows: {} }) };
  const { client, calls } = scripted([limited({ "Retry-After": "0" }), quotas]);
  assert.deepEqual(await client.quotas(), { windows: {} });
  assert.equal(calls.length, 2);
});

// --- what is NEVER retried: a repeat of any of these could bill twice -------

for (const code of ["token_quota", "monthly_quota", "spend_limit_reached", "slow_down", "credit_hold_busy"]) {
  test(`a 429 that is not a per-minute rate limit (${code}) is thrown, not retried`, async () => {
    const { client, calls } = scripted([limited({ "Retry-After": "0" }, code)]);
    await assert.rejects(() => client.generate("hi"), (e) => { assert.ok(e instanceof RateLimitError); assert.equal(e.code, code); return true; });
    assert.equal(calls.length, 1);
  });
}

for (const status of [500, 502, 503, 504]) {
  test(`a ${status} is never retried: the work may have been done and billed`, async () => {
    const resp = { ok: false, status, headers: new Headers({ "Retry-After": "0" }),
                   json: async () => ({ error: { code: status === 502 ? "upstream" : "internal_error", message: "x" } }) };
    const { client, calls } = scripted([resp, good()]);
    await assert.rejects(() => client.generate("hi"), AivanaError);
    assert.equal(calls.length, 1);
  });
}

for (const [status, code, Cls] of [[401, "auth", AuthError], [403, "forbidden", ForbiddenError],
                                  [400, "invalid_request", InvalidRequestError], [402, "insufficient_credit", AivanaError]]) {
  test(`a ${status} is never retried`, async () => {
    const resp = { ok: false, status, headers: new Headers({ "Retry-After": "0" }),
                   json: async () => ({ error: { code, message: "x" } }) };
    const { client, calls } = scripted([resp, good()]);
    await assert.rejects(() => client.generate("hi"), Cls);
    assert.equal(calls.length, 1);
  });
}

test("a dropped connection is never retried", async () => {
  const { client, calls } = scripted([new TypeError("fetch failed"), good()]);
  await assert.rejects(() => client.generate("hi"), TypeError);
  assert.equal(calls.length, 1);
});

test("a request that times out is never retried", async () => {
  const { client, calls } = scripted([
    (init) => init, // replaced below: a fetch that never answers until aborted
  ], { timeoutMs: 20 });
  client._fetch = async (_url, init) => {
    calls.push(1);
    await new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  };
  await assert.rejects(() => client.generate("hi"));
  assert.equal(calls.length, 1);
});

test("an upstream error is still the UpstreamError it was", async () => {
  const resp = { ok: false, status: 502, headers: new Headers(), json: async () => ({ error: { code: "upstream", message: "x" } }) };
  const { client } = scripted([resp]);
  await assert.rejects(() => client.generate("hi"), UpstreamError);
});

// --- the caller can still stop --------------------------------------------

test("aborting during the wait ends the call with no further request", async () => {
  const ac = new AbortController();
  const calls = [];
  const client = new Aivana({
    apiKey: "ai_live_test",
    fetch: async () => { calls.push(1); return limited({ "Retry-After": "10" }); },
    maxRetryWaitMs: 60_000,
  });
  const pending = client.generate("hi", { signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(() => pending, (e) => { assert.equal(e.name, "AbortError"); return true; });
  assert.equal(calls.length, 1);
});

test("an already-aborted signal is not waited on", async () => {
  const client = new Aivana({ apiKey: "ai_live_test", fetch: async () => good() });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => client._sleep(1000, ac.signal), (e) => e.name === "AbortError");
});

// --- the settings -----------------------------------------------------------

test("the defaults are two retries and a thirty second ceiling", () => {
  const c = new Aivana({ apiKey: "k" });
  assert.equal(c.maxRetries, 2);
  assert.equal(c.maxRetryWaitMs, 30_000);
});

test("a setting that is not a count or a wait is refused at construction", () => {
  for (const bad of [-1, 1.5, "2", NaN, null]) {
    assert.throws(() => new Aivana({ apiKey: "k", maxRetries: bad }), InvalidRequestError, String(bad));
  }
  for (const bad of [-1, "x", NaN, Infinity]) {
    assert.throws(() => new Aivana({ apiKey: "k", maxRetryWaitMs: bad }), InvalidRequestError, String(bad));
  }
});

test("a call's own bad maxRetries is refused before any request", async () => {
  const { client, calls } = scripted([good()]);
  await assert.rejects(() => client.generate("hi", { maxRetries: -2 }), InvalidRequestError);
  assert.equal(calls.length, 0);
});

test("maxRetries is not sent to the API", async () => {
  const { client, calls } = scripted([good()]);
  await client.generate("hi", { maxRetries: 3 });
  assert.equal("maxRetries" in JSON.parse(calls[0].init.body), false);
  assert.equal("max_retries" in JSON.parse(calls[0].init.body), false);
});
