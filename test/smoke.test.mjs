// The production smoke test (smoke/smoke.mjs), run against a local stand-in for the API.
//
// A smoke test that has only ever passed proves nothing, so most of these cases make the stand-in misbehave in one
// way (a made-up key accepted, an empty answer, an error inside the stream...) and check the script says FAIL.
// Nothing here touches the network beyond 127.0.0.1 and nothing needs a key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { redact, spendOne, judgeCancel, MAX_PAID_CALLS } from "../smoke/smoke.mjs";

const SCRIPT = fileURLToPath(new URL("../smoke/smoke.mjs", import.meta.url));
const GOOD_KEY = "ai_test_" + "g".repeat(32);
const VERSION = JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function envelope(code, message, status) {
  return { status, body: { error: { type: code, code, message, request_id: "req_stub" } } };
}

// A stand-in for the few routes the script uses. `quirk` makes it misbehave in one named way.
async function withStub(quirk, run) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, path: req.url, key: req.headers["x-api-key"], body });
      const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      const key = req.headers["x-api-key"];
      const keyOk = quirk === "accepts-any-key" ? true : key === GOOD_KEY;
      if (!keyOk) {
        // the message echoes the key on purpose: the script must not print it
        const e = envelope("auth", `Invalid API key ${key}`, 401);
        return send(e.status, e.body);
      }
      if (quirk === "refuses-real-key" && key === GOOD_KEY) {
        const e = envelope("auth", "Invalid API key", 401);
        return send(e.status, e.body);
      }
      if (quirk === "rate-limited" && req.url === "/v1/quotas") {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "0" });
        return res.end(JSON.stringify(envelope("rate_limit_exceeded", "Too many requests", 429).body));
      }
      if (req.url === "/v1/quotas") return send(200, { windows: { hour: {}, day: {}, month: {} } });
      if (quirk === "no-credit" && body && body.effort === "low") {
        const e = envelope("insufficient_credit", "Your balance is empty.", 402);
        return send(e.status, e.body);
      }
      if (quirk === "fails-fast" && req.url === "/v1/generate" && body.effort === "low") {
        const e = envelope("internal_error", "boom", 500);
        return send(e.status, e.body);
      }
      // What the real API does (intelligence_engine/api/envelopes.py): temperature must be 0..2, so 5 is a 422 before any
      // work; an unknown `effort` is NOT an error (it is quietly treated as "auto"), so it is accepted here too.
      if (quirk !== "accepts-bad-requests" && body && typeof body.temperature === "number"
          && (body.temperature > 2 || body.temperature < 0)) {
        const e = envelope("invalid_request", "The request body or query is not valid.", 422);
        return send(e.status, e.body);
      }
      const delay = quirk === "answers-instantly" ? 0 : 600;
      if (req.url === "/v1/generate") {
        return setTimeout(() => {
          if (res.destroyed) return;
          send(200, {
            id: "gen_1", request_id: quirk === "no-request-id" ? undefined : "req_ok",
            answer: quirk === "empty-answer" ? "   " : "ready",
            intent: { name: "chat", confidence: 1 }, models_used: ["aivana-mmi"],
            usage: { input_tokens: 12, output_tokens: quirk === "zero-tokens" ? 0 : 3, credits: 0.001 },
            latency_ms: 800, finish_reason: "stop", notices: [],
          });
        }, delay);
      }
      if (req.url === "/v1/generate:stream") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const ev = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        ev("delta", { text: "rea" });
        if (quirk === "stream-error") ev("error", { message: "upstream failed" });
        else if (quirk === "stream-error-then-clean-done") { ev("error", { message: "upstream hiccup" }); ev("delta", { text: "dy" }); }
        else ev("delta", { text: "dy" });
        if (quirk !== "stream-no-done") {
          ev("done", { finish_reason: quirk === "stream-error" ? "error" : "stop", request_id: "req_stream",
                       usage: { input_tokens: 12, output_tokens: 3, cached_tokens: 0, credits: 0.001 } });
        }
        return res.end();
      }
      send(404, { error: { code: "not_found", message: "no", request_id: "r" } });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await run({ base, seen }); } finally { server.closeAllConnections(); server.close(); }
}

function runScript(env, args = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, timeout: 60_000 },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

const gen = (seen) => seen.filter((r) => r.method === "POST" && r.path === "/v1/generate" && r.body.effort === "low");
const stream = (seen) => seen.filter((r) => r.path === "/v1/generate:stream");

test("every check passes against a well-behaved API, and exactly three billed calls are made", async () => {
  await withStub(null, async ({ base, seen }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base, EXPECTED_SDK_VERSION: VERSION });
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /7 of 7 checks passed; 3 billed call\(s\) made/);
    assert.equal(gen(seen).length + stream(seen).length, MAX_PAID_CALLS);
  });
});

test("the billed calls are tiny and never search the web", async () => {
  await withStub(null, async ({ base, seen }) => {
    await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    const billed = [...gen(seen), ...stream(seen)];
    assert.equal(billed.length, 3);
    for (const b of billed) {
      assert.equal(b.body.max_tokens, 300);
      assert.equal(b.body.web_search, false);
      assert.equal(b.body.effort, "low");
      assert.ok(b.body.prompt.length < 60);
    }
  });
});

test("SDK retries are off, so a 429 is reported on the first try and not hidden behind a retry", async () => {
  await withStub("rate-limited", async ({ base, seen }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    // one request with the real key: with the SDK's default of two retries there would be three
    assert.equal(seen.filter((x) => x.path === "/v1/quotas" && x.key === GOOD_KEY).length, 1);
    assert.match(r.stdout, /RateLimitError/);
  });
});

test("a dry run checks the setup and calls nothing", async () => {
  await withStub(null, async ({ base, seen }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base }, ["--dry-run"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Nothing was called/);
    assert.equal(seen.length, 0);
  });
});

test("no key is a setup problem (exit 2), and nothing is called", async () => {
  await withStub(null, async ({ base, seen }) => {
    const r = await runScript({ AIVANA_API_BASE: base });
    assert.equal(r.code, 2);
    assert.match(r.stdout, /AIVANA_API_KEY is not set/);
    assert.equal(seen.length, 0);
  });
});

test("the key is never sent to a plain-http host that is not this machine", async () => {
  const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: "http://example.org" });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /must be an https address/);
  assert.ok(!r.stdout.includes(GOOD_KEY));
});

test("the key never appears in the output, even when the API echoes it back in an error", async () => {
  await withStub("refuses-real-key", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.ok(!r.stdout.includes(GOOD_KEY), "the key leaked into stdout");
    assert.ok(!r.stderr.includes(GOOD_KEY), "the key leaked into stderr");
    assert.ok(!r.stdout.includes("g".repeat(32)));
  });
});

test("redact hides the exact key and anything shaped like one", () => {
  assert.equal(redact("key is SECRETVALUE here", "SECRETVALUE"), "key is *** here");
  assert.equal(redact("saw ai_live_AbC123xyz and ai_test_Zzz"), "saw ai_*** and ai_***");
  assert.equal(redact("nothing to hide", ""), "nothing to hide");
});

test("a made-up key that is accepted fails the run", async () => {
  await withStub("accepts-any-key", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL  a made-up key is refused with AuthError/);
  });
});

test("a real key that is refused stops the run before any billed call", async () => {
  await withStub("refuses-real-key", async ({ base, seen }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Stopping: without a working key/);
    assert.equal(gen(seen).length + stream(seen).length, 0);
  });
});

test("an empty answer fails the generation check", async () => {
  await withStub("empty-answer", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL  one tiny generation/);
    assert.match(r.stdout, /the answer was empty/);
  });
});

test("zero token counts fail the generation check", async () => {
  await withStub("zero-tokens", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /output_tokens is not a positive whole number/);
  });
});

test("a response with no request id fails the generation check", async () => {
  await withStub("no-request-id", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /no request_id/);
  });
});

test("an error event inside the stream fails the streaming check", async () => {
  await withStub("stream-error", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL  one tiny streamed generation/);
  });
});

test("an error event inside an otherwise normal-looking stream still fails the streaming check", async () => {
  await withStub("stream-error-then-clean-done", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /the stream carried 1 error event/);
  });
});

test("a bad request that the API accepts fails the run", async () => {
  await withStub("accepts-bad-requests", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL  a bad request is a typed InvalidRequestError/);
  });
});

test("a stream that never sends done fails the streaming check", async () => {
  await withStub("stream-no-done", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /never sent its done event/);
  });
});

test("a release whose installed version is not the expected one fails", async () => {
  await withStub(null, async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base, EXPECTED_SDK_VERSION: "0.0.1" });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /installed .*, expected 0\.0\.1/);
  });
});

test("the billed-call cap is three, and a fourth billed call is refused by the script itself", () => {
  assert.equal(MAX_PAID_CALLS, 3);
  spendOne("one"); spendOne("two"); spendOne("three");
  assert.throws(() => spendOne("four"), /the cap is 3 per run/);
});

test("an answer that arrives before the cancel is NOT TESTED, not a failure: a healthy release is never held up by a fast API", async () => {
  await withStub("answers-instantly", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /NOT TESTED  a request cancelled with an AbortSignal/);
    assert.match(r.stdout, /6 of 7 checks passed, 1 not tested this run; 3 billed call\(s\) made/);
    assert.ok(!/FAIL/.test(r.stdout));
  });
});

test("a not-tested cancel is shown as a warning annotation in GitHub, so it is visible without blocking", async () => {
  await withStub("answers-instantly", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base, GITHUB_ACTIONS: "true" });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /::warning title=Smoke test: a request cancelled with an AbortSignal stops promptly::not tested this run/);
    const quiet = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.ok(!quiet.stdout.includes("::warning"));
  });
});

test("an API fault that ends the request before the cancel is not blamed on cancelling", async () => {
  await withStub("fails-fast", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1); // the generation check fails on the 500, which is the real problem
    assert.match(r.stdout, /FAIL  one tiny generation/);
    assert.match(r.stdout, /NOT TESTED  a request cancelled/);
    assert.ok(!/FAIL  a request cancelled/.test(r.stdout));
  });
});

test("an empty test account reads as 'fund it', not as an SDK fault, and still stops the release", async () => {
  await withStub("no-credit", async ({ base }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /THE TEST ACCOUNT IS OUT OF CREDIT: fund it/);
    assert.match(r.stdout, /not an SDK fault/);
  });
});

// judgeCancel: the rule for the cancel check, with no network and no timing
const ABORT = Object.assign(new Error("aborted"), { name: "AbortError" });
test("judgeCancel: a request that was in flight and ended with AbortError promptly passes", () => {
  assert.equal(judgeCancel({ settledBeforeAbort: false, outcome: "rejected", err: ABORT, tookMs: 3 }).status, "pass");
});
test("judgeCancel: a request that had already finished (answer or error) is inconclusive, never a failure", () => {
  assert.equal(judgeCancel({ settledBeforeAbort: true, outcome: "resolved", tookMs: 0 }).status, "inconclusive");
  assert.equal(judgeCancel({ settledBeforeAbort: true, outcome: "rejected", err: new Error("boom"), tookMs: 0 }).status, "inconclusive");
});
test("judgeCancel: an answer that arrives as the cancel is sent is inconclusive", () => {
  assert.equal(judgeCancel({ settledBeforeAbort: false, outcome: "resolved", tookMs: 1 }).status, "inconclusive");
});
test("judgeCancel: in flight, cancelled, and the SDK surfaces some other error: that is a failure", () => {
  const v = judgeCancel({ settledBeforeAbort: false, outcome: "rejected", err: new TypeError("fetch failed"), tookMs: 2 });
  assert.equal(v.status, "fail");
  assert.match(v.note, /instead of AbortError/);
});
test("judgeCancel: in flight but slow to take effect is a failure, and the limit is the one given", () => {
  assert.equal(judgeCancel({ settledBeforeAbort: false, outcome: "rejected", err: ABORT, tookMs: 5_000 }).status, "fail");
  assert.equal(judgeCancel({ settledBeforeAbort: false, outcome: "rejected", err: ABORT, tookMs: 4_999 }).status, "pass");
});

test("the bad-request check uses an out-of-range temperature, which the real API refuses, never an unknown effort, which it accepts", async () => {
  await withStub(null, async ({ base, seen }) => {
    const r = await runScript({ AIVANA_API_KEY: GOOD_KEY, AIVANA_API_BASE: base });
    assert.equal(r.code, 0, r.stdout);
    const bad = seen.filter((x) => x.body && x.body.temperature === 5);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].body.effort, undefined, "the invalid request must not rely on effort");
    // and the stand-in agrees with the real API that an unknown effort is accepted, not refused
    const res = await fetch(base + "/v1/generate", { method: "POST", headers: { "X-API-Key": GOOD_KEY, "Content-Type": "application/json" },
                                                     body: JSON.stringify({ prompt: "x", effort: "not-a-real-effort" }) });
    assert.equal(res.status, 200);
  });
});
