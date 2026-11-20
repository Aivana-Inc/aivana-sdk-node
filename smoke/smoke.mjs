#!/usr/bin/env node
// Production smoke test for @aivana/sdk: the few things a developer does in their first ten minutes,
// done against the real API with the package exactly as a developer would install it.
//
//   AIVANA_API_KEY=ai_live_... node smoke/smoke.mjs            (the real run: three tiny billed calls)
//   AIVANA_API_KEY=ai_live_... node smoke/smoke.mjs --dry-run  (checks the setup, calls nothing, spends nothing)
//
// What it checks, in order:
//   1. the installed SDK is the version the release says it is (when EXPECTED_SDK_VERSION is set)
//   2. a made-up key is refused with an AuthError                          (free)
//   3. the real key is accepted: quotas() answers                           (free)
//   4. a bad request comes back as a typed InvalidRequestError with an id   (free: refused before any work)
//   5. one tiny generation                                                  (billed, call 1 of 3)
//   6. one tiny streamed generation                                         (billed, call 2 of 3)
//   7. one request cancelled with an AbortSignal                            (may be billed, call 3 of 3)
//
// What it deliberately does NOT do: provoke a rate limit (counters are per server task, so it would be
// flaky, and it would put blocked requests in the production logs), retry-on-429 behaviour (proved
// offline in test/retry.test.mjs), or timeouts (a timed-out call can still be billed).
//
// Safe by construction:
//   - at most MAX_PAID_CALLS billed calls, counted in one place; a fourth is refused by this script
//   - every line it prints passes through redact(), so the key never reaches a log
//   - the key is only ever sent to https hosts (or to localhost, for the offline test)
//   - it asserts the SHAPE of answers (non-empty, counts above zero, ids present), never their wording
//
// Exit code: 0 all checks passed, 1 a check failed, 2 the setup is wrong (nothing was called).

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Aivana, { AivanaError, AuthError, InvalidRequestError } from "@aivana/sdk";

export const MAX_PAID_CALLS = 3;
const PROMPT = "Reply with the single word: ready.";
// Small on purpose. effort "low" and web search off keep the run short and the bill to a few cents.
const TINY = { maxTokens: 300, effort: "low", webSearch: false };
const API_DEFAULT = "https://api.aivana.ai";

const apiKey = process.env.AIVANA_API_KEY || "";
const dryRun = process.argv.includes("--dry-run");
const out = (line) => process.stdout.write(redact(line) + "\n");

// Anything that looks like a key is hidden, and so is the exact key in use, whatever it looks like.
export function redact(text, key = apiKey) {
  let s = String(text);
  if (key) s = s.split(key).join("***");
  return s.replace(/\bai_(?:live|test)_[A-Za-z0-9_-]+/g, "ai_***");
}

function refuseSetup(message) {
  out(`SETUP PROBLEM: ${message}`);
  out("Nothing was called.");
  process.exit(2);
}

function checkSetup() {
  if (!apiKey) refuseSetup("AIVANA_API_KEY is not set.");
  let base = process.env.AIVANA_API_BASE || API_DEFAULT;
  let url;
  try { url = new URL(base); } catch { refuseSetup("AIVANA_API_BASE is not a web address."); }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    refuseSetup("AIVANA_API_BASE must be an https address (the key is sent there).");
  }
  return base.replace(/\/$/, "");
}

function installedVersion() {
  // The package's exports do not list package.json, and import.meta.resolve is missing from older Node, so look for
  // the package folder the plain way: the nearest node_modules/@aivana/sdk above this file (the installed tarball), or,
  // when the script runs inside the repository itself, the repository's own package.json.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [];
  for (let dir = here; ; ) {
    candidates.push(join(dir, "node_modules", "@aivana", "sdk", "package.json"));
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  candidates.push(join(here, "..", "package.json"));
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, "utf8"));
      if (pkg.name === "@aivana/sdk") return pkg.version;
    } catch { /* not here */ }
  }
  throw new Error("could not find the installed @aivana/sdk package.json");
}

let paidCalls = 0;
export function spendOne(what) {
  if (paidCalls >= MAX_PAID_CALLS) {
    throw new Error(`refusing a billed call (${what}): the cap is ${MAX_PAID_CALLS} per run`);
  }
  paidCalls += 1;
}

function describe(err) {
  if (err instanceof AivanaError) {
    const bits = [err.name, `status ${err.status}`, `code ${err.code}`];
    if (err.requestId) bits.push(`request ${err.requestId}`);
    return bits.join(", ") + ` - ${String(err.message).slice(0, 160)}`;
  }
  return `${err && err.name ? err.name : "Error"} - ${String((err && err.message) || err).slice(0, 160)}`;
}

const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note || "", ms: Date.now() - started });
    out(`PASS  ${name}${note ? `  (${note})` : ""}`);
    return true;
  } catch (err) {
    results.push({ name, ok: false, note: describe(err), ms: Date.now() - started });
    out(`FAIL  ${name}`);
    out(`      ${describe(err)}`);
    return false;
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const positiveInt = (n) => Number.isInteger(n) && n > 0;

async function main() {
  const base = checkSetup();
  const sdkVersion = installedVersion();
  out(`@aivana/sdk ${sdkVersion}  ->  ${base}${dryRun ? "  (dry run: nothing will be called)" : ""}`);

  if (dryRun) {
    out(`Plan: 3 free checks, then up to ${MAX_PAID_CALLS} tiny billed calls (maxTokens ${TINY.maxTokens}, effort ${TINY.effort}, web search off).`);
    out("Nothing was called.");
    return 0;
  }

  // retries off: a smoke test must report what the API did on the first try, not hide a 429 behind a retry.
  const client = new Aivana({ apiKey, apiBase: base, maxRetries: 0, timeoutMs: 90_000 });

  await check("the installed SDK is the release being tested", async () => {
    const want = process.env.EXPECTED_SDK_VERSION;
    if (!want) return `version ${sdkVersion}; EXPECTED_SDK_VERSION not set, so not compared`;
    expect(sdkVersion === want, `installed ${sdkVersion}, expected ${want}`);
    return `version ${sdkVersion}`;
  });

  await check("a made-up key is refused with AuthError", async () => {
    const wrong = new Aivana({ apiKey: "ai_live_" + "x".repeat(32), apiBase: base, maxRetries: 0 });
    try {
      await wrong.quotas();
    } catch (err) {
      expect(err instanceof AuthError, `expected AuthError, got ${describe(err)}`);
      expect(err.status === 401, `expected status 401, got ${err.status}`);
      return "401";
    }
    throw new Error("a made-up key was accepted");
  });

  const accepted = await check("the real key is accepted (quotas answers)", async () => {
    const q = await client.quotas();
    expect(q && typeof q.windows === "object" && q.windows !== null, "quotas() had no windows");
    return "windows: " + Object.keys(q.windows).join(", ");
  });
  if (!accepted) {
    out("Stopping: without a working key the remaining checks cannot say anything useful.");
    return finish(1);
  }

  await check("a bad request is a typed InvalidRequestError with a request id", async () => {
    try {
      // refused by validation before any work: free
      await client.generate(PROMPT, { effort: "not-a-real-effort" });
    } catch (err) {
      expect(err instanceof InvalidRequestError, `expected InvalidRequestError, got ${describe(err)}`);
      expect(err.code === "invalid_request", `expected code invalid_request, got ${err.code}`);
      expect(typeof err.requestId === "string" && err.requestId.length > 0, "the error carried no requestId");
      return `status ${err.status}`;
    }
    throw new Error("a bad request was accepted");
  });

  await check("one tiny generation", async () => {
    spendOne("generate");
    const r = await client.generate(PROMPT, TINY);
    expect(typeof r.answer === "string" && r.answer.trim().length > 0,
      `the answer was empty (finish_reason ${r.finish_reason})`);
    expect(typeof r.request_id === "string" && r.request_id.length > 0, "no request_id");
    expect(r.usage && positiveInt(r.usage.input_tokens), "usage.input_tokens is not a positive whole number");
    expect(positiveInt(r.usage.output_tokens), "usage.output_tokens is not a positive whole number");
    expect(typeof r.usage.credits === "number" && r.usage.credits >= 0, "usage.credits is not a number");
    expect(Array.isArray(r.models_used) && r.models_used.length > 0, "models_used is empty");
    expect(["stop", "length"].includes(r.finish_reason), `unexpected finish_reason ${r.finish_reason}`);
    expect(Array.isArray(r.notices), "notices is not a list");
    return `${r.usage.input_tokens} in / ${r.usage.output_tokens} out, ${r.latency_ms} ms, request ${r.request_id}`;
  });

  await check("one tiny streamed generation", async () => {
    spendOne("generateStream");
    let deltas = 0, text = "", done = null, errors = 0;
    for await (const chunk of client.generateStream(PROMPT, TINY)) {
      if (chunk.event === "delta") { deltas += 1; text += chunk.data.text || ""; }
      else if (chunk.event === "done") done = chunk.data;
      else if (chunk.event === "error") errors += 1;
    }
    expect(errors === 0, `the stream carried ${errors} error event(s)`);
    expect(deltas > 0 && text.trim().length > 0, "the stream carried no answer text");
    expect(done, "the stream never sent its done event");
    expect(done.finish_reason !== "error", "the stream ended with finish_reason error");
    expect(done.usage && positiveInt(done.usage.input_tokens) && positiveInt(done.usage.output_tokens),
      "the done event's token counts are not positive whole numbers");
    expect(typeof done.request_id === "string" && done.request_id.length > 0, "the done event had no request_id");
    return `${deltas} pieces, ${done.usage.input_tokens} in / ${done.usage.output_tokens} out, request ${done.request_id}`;
  });

  await check("a request cancelled with an AbortSignal stops promptly", async () => {
    spendOne("abort");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25);
    const started = Date.now();
    try {
      await client.generate(PROMPT, { ...TINY, signal: ac.signal });
    } catch (err) {
      const took = Date.now() - started;
      expect(err && err.name === "AbortError", `expected AbortError, got ${describe(err)}`);
      expect(took < 5_000, `the abort took ${took} ms to take effect`);
      return `stopped after ${took} ms`;
    } finally {
      clearTimeout(timer);
    }
    throw new Error("the request finished before it could be cancelled, so cancelling was not tested");
  });

  return finish(results.every((r) => r.ok) ? 0 : 1);
}

function finish(code) {
  const passed = results.filter((r) => r.ok).length;
  out(`\n${passed} of ${results.length} checks passed; ${paidCalls} billed call(s) made.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.ok ? "pass" : "FAIL"} | ${r.name} | ${redact(r.note).replace(/\|/g, "/")} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### @aivana/sdk production smoke test\n\n| | check | detail |\n|---|---|---|\n${rows.join("\n")}\n\n` +
      `${passed} of ${results.length} passed; ${paidCalls} billed call(s).\n`);
  }
  return code;
}

// Runs only when started as a program, so the test can import redact() without starting a run.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    out(`FAIL  the smoke test itself broke: ${describe(err)}`);
    process.exitCode = 1;
  });
}
