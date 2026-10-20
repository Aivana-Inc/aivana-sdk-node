// The `aivana` command from @aivana/cli, validated as an external developer runs it.
//
// Every case starts the INSTALLED bin (node_modules/.bin/aivana, what `npm install -g @aivana/cli`
// or `npx @aivana/cli` runs) as a real child process with real pipes, so argument parsing, stdin,
// stdout/stderr separation and exit codes are what a shell script would see.
//
// Offline cases point AIVANA_API_BASE at a fake API on 127.0.0.1 that speaks the real wire format
// (SSE on /v1/generate:stream, JSON on /v1/generate): no key, no cost. Live cases run a few cheap
// questions on the dev host. Case IDs mirror the Python suite (PY-CLI-10 <-> NODE-CLI-10).
//
// Expectations: the @aivana/cli README and AI Studio > Docs > Command Line (/docs/cli).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kase, ROOT } from "../lib/harness.mjs";
import { LIVE_BASE } from "./live.mjs";

const AIVANA = join(ROOT, "node_modules", ".bin", "aivana");
const CLI_VERSION = JSON.parse(readFileSync(join(ROOT, "node_modules/@aivana/cli/package.json"), "utf8")).version;
const FAKE_KEY = "ai_test_cli_validation_not_a_real_key_0001";
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const STAGES = [["stage", { loading: "Selecting the right intelligence", stage: "Selecting the right intelligence" }],
                ["stage", { loading: "Preparing the synthesized answer", stage: "Preparing the synthesized answer" }]];
const DONE = ["done", { finish_reason: "stop", usage: { input_tokens: 5, output_tokens: 3, credits: 0.0001 } }];
const DEFAULT_EVENTS = [...STAGES, ["delta", { text: "Hello" }], ["delta", { text: " world." }], DONE];
const DEFAULT_JSON = { id: "gen_cli_1", request_id: "req_cli_1", answer: "Hello world.",
  intent: { name: "direct_chat", confidence: 0.9, signal: "" }, finish_reason: "stop", latency_ms: 900,
  models_used: ["aivana-mmi"], usage: { input_tokens: 5, output_tokens: 3, cached_tokens: 0, credits: 0.0001 } };
const errEnvelope = (status, code, message = "The server said no.", extra = {}) =>
  [status, { error: { type: code, code, message, request_id: "req_cli_err", ...extra } }];

// ------------------------------------------------------------------ fake API

async function fakeApi() {
  const api = { requests: [], events: DEFAULT_EVENTS, json: DEFAULT_JSON, status: 200 };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { body = { _raw: raw }; }
      api.requests.push({ path: req.url, headers: req.headers, body });
      if (api.status === 200 && req.url.endsWith(":stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const [e, d] of api.events) res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
        res.end();
        return;
      }
      res.writeHead(api.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(api.json));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  api.base = `http://127.0.0.1:${server.address().port}`;
  api.close = () => new Promise((r) => server.close(r));
  api.last = () => { assert.ok(api.requests.length, "the CLI made no request"); return api.requests.at(-1); };
  api.error = ([status, body]) => { api.status = status; api.json = body; };
  return api;
}

function cleanEnv(overrides = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("AIVANA_")));
  for (const [k, v] of Object.entries(overrides)) if (v != null) env[k] = v;
  return env;
}

/** Run the installed `aivana`. stdin: "devnull" (default, like `< /dev/null`), a string/Buffer
 *  piped then closed, or {file} redirected in like `< file`. */
function run(args, { env = cleanEnv(), stdin = "devnull", timeoutMs = 30_000, exe = [AIVANA] } = {}) {
  return new Promise((resolve, reject) => {
    let fd = null;
    let stdio = ["pipe", "pipe", "pipe"];
    if (stdin === "devnull") stdio[0] = "ignore";
    else if (stdin && stdin.file) { fd = openSync(stdin.file, "r"); stdio[0] = fd; }
    const p = spawn(exe[0], [...exe.slice(1), ...args], { env, stdio });
    const out = [], err = [];
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => err.push(c));
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`aivana ${args.join(" ")} timed out`)); }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (fd !== null) closeSync(fd);
      resolve({ code, out: Buffer.concat(out).toString("utf8"), err: Buffer.concat(err).toString("utf8") });
    });
    if ((typeof stdin === "string" && stdin !== "devnull") || Buffer.isBuffer(stdin)) p.stdin.end(stdin);
  });
}

/** kase() with a fresh fake API and a runner that has the (fake) key exported. */
function cliCase(id, title, fn, opts = {}) {
  kase(id, "CLI", title, async (t) => {
    const api = await fakeApi();
    const cli = (args, { key = FAKE_KEY, base = api.base, ...o } = {}) =>
      run(args, { env: cleanEnv({ AIVANA_API_KEY: key, AIVANA_API_BASE: base }), ...o });
    try { await fn({ api, cli, t }); } finally { await api.close(); }
  }, { timeoutMs: 60_000, ...opts });
}

// ======================================================================= install / entry point

kase("NODE-CLI-01", "CLI", "`aivana --version` runs from the installed bin and names the version", async () => {
  const r = await run(["--version"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), `aivana ${CLI_VERSION}`);
}, { timeoutMs: 30_000 });

kase("NODE-CLI-02", "CLI", "@aivana/cli and @aivana/sdk are released together (same version)", async () => {
  const sdk = JSON.parse(readFileSync(join(ROOT, "node_modules/@aivana/sdk/package.json"), "utf8")).version;
  assert.equal(CLI_VERSION, sdk);
});

const DOCS_OPTIONS = ["--effort", "--shape", "--web", "--no-web", "--system", "--assistant-name",
                      "--max-tokens", "--temperature", "--image", "--trace", "--json", "-q", "--quiet"];

kase("NODE-CLI-03", "CLI", "`aivana --help` lists every option Docs > Command Line documents, and both env vars", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  const missing = DOCS_OPTIONS.filter((o) => !r.out.includes(o));
  assert.deepEqual(missing, [], `documented but not in --help: ${missing}`);
  assert.ok(r.out.includes("AIVANA_API_KEY") && r.out.includes("AIVANA_API_BASE"));
}, { timeoutMs: 30_000 });

kase("NODE-CLI-04", "CLI", "--help's exit-code table matches the Docs/README table (0-6, 130)", async () => {
  const r = await run(["--help"]);
  const table = r.out.split("exit codes:")[1] || "";
  for (const [code, word] of [[0, "success"], [1, "request failed"], [2, "bad usage"], [3, "authentication"],
                              [4, "rate limited"], [5, "out of credits"], [6, "temporary failure"], [130, "interrupted"]]) {
    assert.ok(table.includes(`${code}  ${word}`), `exit code ${code} (${word}) not in --help`);
  }
}, { timeoutMs: 30_000 });

for (const flag of ["--model", "--provider"]) {
  cliCase(`NODE-CLI-05${flag === "--model" ? "a" : "b"}`, `No ${flag} option exists (Docs: 'No model picker, on purpose')`, async ({ api, cli }) => {
    const r = await cli(["hi", flag, "x"]);
    assert.equal(r.code, 2); assert.equal(r.out, ""); assert.equal(api.requests.length, 0);
  });
}

kase("NODE-CLI-06", "CLI", "`aivana help` prints help and exits 0", async () => {
  const r = await run(["help"]);
  assert.equal(r.code, 0); assert.match(r.out, /usage: aivana/);
}, { timeoutMs: 30_000 });

// ======================================================================= basic question / wire

cliCase("NODE-CLI-10", "Basic question: answer on stdout only, exit 0, POST /v1/generate:stream with X-API-Key", async ({ api, cli }) => {
  const r = await cli(["What is 6 x 7?"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "Hello world.\n");
  assert.equal(r.err, "");                 // stderr not a terminal -> no progress line
  const req = api.last();
  assert.equal(req.path, "/v1/generate:stream");
  assert.equal(req.headers["x-api-key"], FAKE_KEY);
  assert.equal(req.body.prompt, "What is 6 x 7?");
});

cliCase("NODE-CLI-11", "`aivana \"...\" > answer.md` saves just the answer", async ({ cli }) => {
  const dir = mkdtempSync(join(tmpdir(), "aivana-cli-"));
  const r = await cli(["hi"]);
  writeFileSync(join(dir, "answer.md"), r.out);
  assert.equal(readFileSync(join(dir, "answer.md"), "utf8"), "Hello world.\n");
});

cliCase("NODE-CLI-12", "Every documented option reaches the wire under its API name (README option table)", async ({ api, cli }) => {
  const dir = mkdtempSync(join(tmpdir(), "aivana-cli-"));
  const img = join(dir, "chart.png");
  writeFileSync(img, PNG_1PX);
  const r = await cli(["hi", "--effort", "high", "--shape", "tradeoffs", "--web", "--system", "Be brief",
                       "--assistant-name", "Acme", "--max-tokens", "50", "--temperature", "0.3", "--image", img, "--trace"]);
  assert.equal(r.code, 0, r.err);
  const b = api.last().body;
  assert.equal(b.effort, "high"); assert.equal(b.output_shape, "tradeoffs"); assert.equal(b.web_search, true);
  assert.equal(b.system, "Be brief"); assert.equal(b.assistant_name, "Acme");
  assert.equal(b.max_tokens, 50); assert.equal(b.temperature, 0.3); assert.equal(b.intelligence_trace, true);
  assert.deepEqual(b.attachments, [{ mime_type: "image/png", data: PNG_1PX.toString("base64") }]);
});

cliCase("NODE-CLI-13", "Options left off are not sent (left to Aivana); --no-web sends web_search=false", async ({ api, cli }) => {
  await cli(["hi"]);
  // `mode` is the SDK's fixed product constant, not a caller option; conformance/cli.json expects it.
  assert.deepEqual(Object.keys(api.last().body).sort(), ["metadata", "mode", "prompt"]);
  assert.equal(api.last().body.metadata.request_source, "cli-node");
  await cli(["hi", "--no-web"]);
  assert.equal(api.last().body.web_search, false);
});

cliCase("NODE-CLI-14", "Reserved word is refused with a hint; `aivana ask ...` is the way around it", async ({ api, cli }) => {
  let r = await cli(["chat", "about", "pricing"]);
  assert.equal(r.code, 2); assert.equal(api.requests.length, 0); assert.match(r.err, /aivana ask chat about pricing/);
  r = await cli(["ask", "chat", "about", "pricing"]);
  assert.equal(r.code, 0); assert.equal(api.last().body.prompt, "chat about pricing");
});

cliCase("NODE-CLI-15", "Abbreviated options are refused (`--temp` is not --temperature)", async ({ api, cli }) => {
  const r = await cli(["hi", "--temp", "0.5"]);
  assert.equal(r.code, 2); assert.equal(api.requests.length, 0);
});

// ======================================================================= stdin / pipes

cliCase("NODE-CLI-20", "Piped text is sent ahead of the question (`git diff | aivana \"Review this change\"`)", async ({ api, cli }) => {
  const r = await cli(["Review this change"], { stdin: "diff --git a/x b/x\n+new line\n" });
  assert.equal(r.code, 0, r.err);
  assert.equal(api.last().body.prompt, "diff --git a/x b/x\n+new line\n\nReview this change");
});

cliCase("NODE-CLI-21", "Piped text alone is the question; `aivana \"...\" < contract.txt` works", async ({ api, cli }) => {
  let r = await cli([], { stdin: "Summarize: the sky is blue." });
  assert.equal(r.code, 0, r.err); assert.equal(api.last().body.prompt, "Summarize: the sky is blue.");
  const dir = mkdtempSync(join(tmpdir(), "aivana-cli-"));
  const f = join(dir, "contract.txt");
  writeFileSync(f, "Clause 1. Payment in 30 days.\n");
  r = await cli(["Summarize the three biggest risks"], { stdin: { file: f } });
  assert.equal(r.code, 0, r.err);
  assert.equal(api.last().body.prompt, "Clause 1. Payment in 30 days.\n\nSummarize the three biggest risks");
});

cliCase("NODE-CLI-22", "Docs: with nothing piped, `< /dev/null` answers at once (no 3 s wait, no note)", async ({ cli }) => {
  const t0 = Date.now();
  const r = await cli(["hi"], { stdin: "devnull" });
  assert.equal(r.code, 0); assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0} ms`); assert.ok(!/note/.test(r.err));
});

cliCase("NODE-CLI-23", "Docs: an open-but-silent stdin waits about 3 s, says so on stderr, then sends just the question", async ({ api }) => {
  const env = cleanEnv({ AIVANA_API_KEY: FAKE_KEY, AIVANA_API_BASE: api.base });
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    const p = spawn(AIVANA, ["hi"], { env, stdio: ["pipe", "pipe", "pipe"] });   // stdin pipe never written
    const out = [], err = [];
    p.stdout.on("data", (c) => out.push(c)); p.stderr.on("data", (c) => err.push(c));
    p.on("close", (code) => resolve({ code, err: Buffer.concat(err).toString() }));
    setTimeout(() => p.stdin.end(), 15_000).unref();
  });
  const elapsed = (Date.now() - t0) / 1000;
  assert.equal(r.code, 0, r.err);
  assert.ok(elapsed >= 2.5 && elapsed < 10, `waited ${elapsed.toFixed(1)} s; Docs say up to 3 seconds`);
  assert.match(r.err, /no piped input arrived within 3s/); assert.match(r.err, /\/dev\/null/);
  assert.equal(api.last().body.prompt, "hi");
});

cliCase("NODE-CLI-24", "Binary piped input is refused locally with a pointer to --image (exit 2)", async ({ api, cli }) => {
  const r = await cli(["Describe"], { stdin: Buffer.concat([PNG_1PX, Buffer.from([0xff, 0xfe, 0x00])]) });
  assert.equal(r.code, 2, `exit ${r.code}; stderr: ${r.err.slice(0, 200)}`);
  assert.equal(api.requests.length, 0); assert.match(r.err, /--image/);
});

// ======================================================================= --json / --trace / --image

cliCase("NODE-CLI-30", "--json waits for the whole response (POST /v1/generate) and prints parseable JSON", async ({ api, cli }) => {
  const r = await cli(["What is 6 x 7?", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(api.last().path, "/v1/generate");
  const d = JSON.parse(r.out);
  assert.equal(d.answer, "Hello world."); assert.equal(d.usage.output_tokens, 3);
  assert.equal(r.err, "");
});

cliCase("NODE-CLI-31", "--trace prints the Intelligence Trace on stderr after the answer; stdout stays the answer", async ({ api, cli }) => {
  api.events = [
    ["trace", { step: { id: "u", title: "Understanding Request", status: "ok", at_ms: 1200 } }],
    ...STAGES, ["delta", { text: "The answer." }],
    ["trace", { status: "completed",
                steps: [{ id: "u", title: "Understanding Request", status: "ok", at_ms: 1200 },
                        { id: "s", title: "Final Synthesis", status: "ok", at_ms: 8450 }],
                summary: { route: "2-model verification", perspectives: 2, fresh_data: "not_required" } }],
    DONE];
  const r = await cli(["hi", "--trace"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "The answer.\n");
  assert.match(r.err, /Intelligence Trace/); assert.match(r.err, /Understanding Request/); assert.match(r.err, /Final Synthesis {2}8\.5s/);
  assert.ok(!r.out.includes("Intelligence Trace"));
  assert.equal(api.last().body.intelligence_trace, true);
});

for (const name of ["report.pdf", "notes.docx"]) {
  cliCase(`NODE-CLI-32${name.endsWith("pdf") ? "a" : "b"}`, `--image refuses ${name.split(".")[1].toUpperCase()} locally (exit 2) with how to send a document instead`, async ({ api, cli }) => {
    const dir = mkdtempSync(join(tmpdir(), "aivana-cli-"));
    writeFileSync(join(dir, name), "%PDF-1.4");
    const r = await cli(["Summarize", "--image", join(dir, name)]);
    assert.equal(r.code, 2); assert.equal(api.requests.length, 0); assert.match(r.err, /only PNG, JPEG, WebP and GIF/);
  });
}

cliCase("NODE-CLI-33", "--image with a missing file names the file (exit 2, nothing sent)", async ({ api, cli }) => {
  const r = await cli(["hi", "--image", join(tmpdir(), "nope-aivana-validation.png")]);
  assert.equal(r.code, 2); assert.equal(api.requests.length, 0); assert.match(r.err, /nope-aivana-validation\.png/);
});

cliCase("NODE-CLI-34", "A 200 --json response missing a required field ends in a clean `aivana: error:` or prints it, never a stack trace", async ({ api, cli }) => {
  const { intent, ...noIntent } = DEFAULT_JSON;
  api.json = noIntent;
  const r = await cli(["hi", "--json"]);
  assert.ok(!/\n\s+at .+:\d+:\d+/.test(r.err), `stack trace on stderr:\n${r.err.slice(0, 300)}`);
  assert.ok(r.code === 0 || r.err.startsWith("aivana: error:"), `exit ${r.code}: ${r.err.slice(0, 200)}`);
});

// ======================================================================= errors / exit codes

cliCase("NODE-CLI-40", "No AIVANA_API_KEY: exit 3 before any request, with how to set it", async ({ api, cli }) => {
  const r = await cli(["hi"], { key: null });
  assert.equal(r.code, 3); assert.equal(r.out, ""); assert.equal(api.requests.length, 0);
  assert.match(r.err, /no API key found/); assert.match(r.err, /export AIVANA_API_KEY/);
});

const HTTP_CASES = [[401, "invalid_api_key", 3], [403, "forbidden", 3], [429, "rate_limit_exceeded", 4],
                    [402, "insufficient_credit", 5], [502, "upstream_error", 6], [504, "timeout", 6],
                    [503, "config_unavailable", 6], [500, "internal_error", 1]];
cliCase("NODE-CLI-41", "Each documented HTTP error maps to the documented exit code, message + request id on stderr (stream and --json)", async ({ api, cli }) => {
  const wrong = [];
  for (const [status, code, exit] of HTTP_CASES) {
    for (const mode of ["stream", "json"]) {
      api.error(errEnvelope(status, code));
      const r = await cli(mode === "json" ? ["hi", "--json"] : ["hi"]);
      if (r.code !== exit || r.out !== "" || !r.err.includes("The server said no. (request id: req_cli_err)"))
        wrong.push(`HTTP ${status} ${code} (${mode}): exit ${r.code}, docs say ${exit}; ${r.err.split("\n")[0]}`);
    }
  }
  assert.deepEqual(wrong, []);
});

cliCase("NODE-CLI-42", "A 422 validation error names the flag to fix (exit 1)", async ({ api, cli }) => {
  api.error(errEnvelope(422, "invalid_request", "Request validation failed.", {
    details: [{ loc: ["body", "temperature"], msg: "Input should be less than or equal to 2", type: "less_than_equal" }] }));
  const r = await cli(["hi", "--temperature", "3"]);
  assert.equal(r.code, 1); assert.match(r.err, /--temperature: Input should be less than or equal to 2/);
});

cliCase("NODE-CLI-43", "Bad usage exits 2 with no request (unknown --effort, non-number --max-tokens, no question)", async ({ api, cli }) => {
  for (const args of [["hi", "--effort", "extreme"], ["hi", "--max-tokens", "lots"], []]) {
    const r = await cli(args);
    assert.equal(r.code, 2, `aivana ${args.join(" ")} -> exit ${r.code}`); assert.equal(r.out, "");
  }
  assert.equal(api.requests.length, 0);
});

cliCase("NODE-CLI-44", "Unreachable API: exit 6 ('safe to retry')", async ({ cli }) => {
  const r = await cli(["hi"], { base: "http://127.0.0.1:9" });
  assert.equal(r.code, 6, r.err); assert.match(r.err, /couldn't reach/); assert.match(r.err, /safe to retry/);
});

cliCase("NODE-CLI-45", "An error frame inside a 200 stream exits 6, and partial text is flagged as incomplete", async ({ api, cli }) => {
  api.events = [...STAGES, ["delta", { text: "Partial" }], ["error", { type: "upstream_error", message: "x" }],
                ["done", { finish_reason: "error", usage: {} }]];
  const r = await cli(["hi"]);
  assert.equal(r.code, 6); assert.equal(r.out, "Partial\n"); assert.match(r.err, /The text above is incomplete\./);
});

cliCase("NODE-CLI-46", "A cut-off answer (finish_reason=length) says so on stderr", async ({ api, cli }) => {
  api.events = [["delta", { text: "Cut" }], ["done", { finish_reason: "length", usage: {} }]];
  const r = await cli(["hi", "--max-tokens", "5"]);
  assert.equal(r.code, 0); assert.equal(r.out, "Cut\n"); assert.match(r.err, /cut off at the length limit/);
});

cliCase("NODE-CLI-47", "The API key never appears in stdout or stderr, on success or failure", async ({ api, cli }) => {
  const outs = [await cli(["hi"]), await cli(["hi", "--json"])];
  api.error(errEnvelope(401, "invalid_api_key"));
  outs.push(await cli(["hi"]), await cli(["hi", "--json"]));
  for (const r of outs) { assert.ok(!r.out.includes(FAKE_KEY)); assert.ok(!r.err.includes(FAKE_KEY)); }
});

// ======================================================================= environment / API base

cliCase("NODE-CLI-50", "AIVANA_API_BASE that is not a URL is refused locally (exit 2)", async ({ cli }) => {
  const r = await cli(["hi"], { base: "api.aivana.ai" });
  assert.equal(r.code, 2); assert.match(r.err, /must be a full URL/);
});

cliCase("NODE-CLI-51", "Plain http:// to a non-local host warns the key travels unencrypted", async ({ cli }) => {
  const r = await cli(["hi"], { base: "http://aivana-validation.invalid:9" });
  assert.match(r.err, /travels unencrypted/);
});

cliCase("NODE-CLI-52", "Plain http:// to localhost is ordinary local development (no warning)", async ({ cli }) => {
  const r = await cli(["hi"]);
  assert.equal(r.code, 0); assert.ok(!/unencrypted/.test(r.err));
});

kase("NODE-CLI-53", "CLI", "With AIVANA_API_BASE unset the CLI calls the documented default (https://api.aivana.ai)", async () => {
  const r = await run(["--help"]);
  assert.match(r.out, /https:\/\/api\.aivana\.ai/);
  const { Aivana } = await import("@aivana/sdk");
  assert.equal(new Aivana({ apiKey: "k" }).apiBase, "https://api.aivana.ai");
}, { timeoutMs: 30_000 });

// ======================================================================= live (dev host)

const LIVE_ARGS = ["--effort", "low", "--max-tokens", "60", "-q"];
const liveCli = (args, { base = LIVE_BASE, key = process.env.AIVANA_API_KEY, ...o } = {}) =>
  run(args, { env: cleanEnv({ AIVANA_API_KEY: key, AIVANA_API_BASE: base }), timeoutMs: 120_000, ...o });
const cliEvidence = (t, r, extra = {}) =>
  t.evidence({ exit: r.code, stdout_preview: r.out.slice(0, 200), stderr_preview: r.err.slice(0, 400), ...extra });
const LIVE = { live: true, timeoutMs: 150_000 };
const LEAK = ["gpt", "claude", "gemini", "openai", "anthropic", "llama", "mistral", "bedrock"];

kase("NODE-CLI-L01", "CLI", "Live: basic question streams an answer to stdout, nothing on stderr, exit 0", async (t) => {
  const r = await liveCli(["Reply with the single word: ok", ...LIVE_ARGS]);
  cliEvidence(t, r);
  assert.equal(r.code, 0, r.err); assert.ok(r.out.trim()); assert.equal(r.err, "");
}, LIVE);

kase("NODE-CLI-L02", "CLI", "Live: --json prints a GenerateResponse with answer, usage and request_id", async (t) => {
  const r = await liveCli(["Reply with the single word: ok", ...LIVE_ARGS, "--json"]);
  const d = r.code === 0 ? JSON.parse(r.out) : {};
  cliEvidence(t, { ...r, out: "" }, { request_id: d.request_id, usage: d.usage, finish_reason: d.finish_reason });
  assert.equal(r.code, 0, r.err); assert.ok(d.answer); assert.ok(d.usage.output_tokens >= 1); assert.ok(d.request_id);
}, LIVE);

kase("NODE-CLI-L03", "CLI", "Live: --trace shows the Intelligence Trace on stderr only, with no model/provider names", async (t) => {
  const r = await liveCli(["Is Postgres or DynamoDB better for a write-heavy API? One sentence.", ...LIVE_ARGS, "--trace"]);
  cliEvidence(t, r);
  assert.equal(r.code, 0, r.err); assert.match(r.err, /Intelligence Trace/); assert.ok(!r.out.includes("Intelligence Trace"));
  for (const w of LEAK) assert.ok(!r.err.toLowerCase().includes(w), `trace names ${w}`);
}, LIVE);

kase("NODE-CLI-L04", "CLI", "Live: piped text is answered (`echo ... | aivana \"...\"`)", async (t) => {
  const r = await liveCli(["What is the secret word in the text above? Reply with just the word.", ...LIVE_ARGS],
                          { stdin: "The secret word is: pineapple." });
  cliEvidence(t, r);
  assert.equal(r.code, 0, r.err); assert.match(r.out.toLowerCase(), /pineapple/);
}, LIVE);

kase("NODE-CLI-L05", "CLI", "Live: an invalid key exits 3 with a request id, and the key is not echoed", async (t) => {
  const bad = "ai_test_definitely_not_a_real_key_000";
  const r = await liveCli(["ping", "-q"], { key: bad });
  cliEvidence(t, r);
  assert.equal(r.code, 3); assert.equal(r.out, ""); assert.match(r.err, /request id: req_/); assert.ok(!r.err.includes(bad));
}, LIVE);

kase("NODE-CLI-L06", "CLI", "Live: `--shape extract --json` (Docs/README example) returns a structured result", async (t) => {
  const r = await liveCli(["Extract the invoice number and total", "--shape", "extract", "--json", "--effort", "low", "-q"],
                          { stdin: "Invoice INV-2041. Total due: $1,250.00." });
  const d = r.code === 0 ? JSON.parse(r.out) : {};
  cliEvidence(t, { ...r, out: "" }, { structured: d.structured, structured_error: d.structured_error });
  assert.equal(r.code, 0, r.err); assert.ok(d.structured != null || d.structured_error != null);
}, LIVE);

kase("NODE-CLI-L07", "CLI", "Live: --image attaches a PNG and the request is accepted", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aivana-cli-"));
  writeFileSync(join(dir, "pixel.png"), PNG_1PX);
  const r = await liveCli(["Describe this image in five words or fewer.", ...LIVE_ARGS, "--image", join(dir, "pixel.png")]);
  cliEvidence(t, r);
  assert.equal(r.code, 0, r.err); assert.ok(r.out.trim());
}, LIVE);

kase("NODE-CLI-L08", "CLI", "Live: a test key with AIVANA_API_BASE unset (production) exits 3 and says the key is from another environment", async (t) => {
  const r = await liveCli(["Reply with the single word: ok", ...LIVE_ARGS], { base: null });
  cliEvidence(t, r, { base: "(unset -> default)" });
  assert.equal(r.code, 3); assert.match(r.err, /environment|test key/i);
}, { ...LIVE, known: "F2: refusing ai_test_ keys on api.aivana.ai is by design (Docs > API Keys), but the CLI says 'Invalid or expired API key. Generate a new key' and suggests `export AIVANA_API_KEY=ai_live_...`" });
