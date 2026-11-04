import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Aivana from "../src/index.js";
import { createChatServer } from "../examples/basic-chat/app.mjs";
import { readConfiguration } from "../examples/basic-chat/config.mjs";
import { LIMITS, recentHistory } from "../examples/basic-chat/public/conversation.mjs";

const KEY = "synthetic_test_key_never_for_browser";
const EXAMPLE = fileURLToPath(new URL("../examples/basic-chat/", import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
const supportsEnvFile = major > 20 || (major === 20 && minor >= 6);

async function listen(t, server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, respond, options = {}) {
  const seen = [];
  const upstream = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const entry = { body: JSON.parse(text), headers: req.headers };
    seen.push(entry);
    await respond(entry, res, seen.length);
  });
  const apiBase = await listen(t, upstream);
  const client = new Aivana({ apiKey: KEY, apiBase, timeoutMs: 3_000 });
  const server = createChatServer({ client, ...options });
  const origin = await listen(t, server);
  return { origin, seen, apiBase, server, upstream,
    post: (body, settings = {}) => fetch(`${origin}/api/chat`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...settings.headers },
      body: typeof body === "string" ? body : JSON.stringify(body), signal: settings.signal,
    }),
  };
}

function answer(res, data = {}) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ answer: "Synthetic answer", intent: { name: "analysis" }, ...data }));
}

test("starter: real SDK supports the initial turn, follow-up context and independent conversations", async (t) => {
  const app = await fixture(t, (_entry, res, count) => answer(res, {
    answer: `Answer ${count}`, pending_action: count === 1 ? "offer" : null,
    internal_debug: KEY, models_used: ["must-not-forward"], request_id: "req_fixture",
  }));
  const first = await (await app.post({ message: "First question" })).json();
  assert.deepEqual(first, { answer: "Answer 1", context: { previousIntent: "analysis", pendingAction: "offer" } });
  const history = [{ role: "user", content: "First question" }, { role: "assistant", content: first.answer }];
  const follow = await (await app.post({ message: "Follow up", history, context: first.context })).json();
  assert.deepEqual(follow.context, { previousIntent: "analysis" }, "a resolved offer must not persist");
  assert.deepEqual(app.seen[1].body.messages, [...history, { role: "user", content: "Follow up" }]);
  assert.equal(app.seen[1].body.previous_intent, "analysis");
  assert.equal(app.seen[1].body.pending_action, "offer");
  await app.post({ message: "Different tab or reset" });
  assert.deepEqual(app.seen[2].body.messages, [{ role: "user", content: "Different tab or reset" }]);
  assert.equal(app.seen[2].body.previous_intent, undefined);
  for (const entry of app.seen) {
    assert.equal(entry.headers["x-api-key"], KEY);
    assert.equal(entry.body.max_tokens, 800);
    assert.equal(entry.body.web_search, false);
  }
});

test("starter: invalid requests never reach the SDK", async (t) => {
  const app = await fixture(t, (_entry, res) => answer(res));
  for (const body of [null, [], {}, { message: " " }, { message: "x".repeat(4001) },
    { message: "x", apiKey: "must-not-send" }, { message: "x", history: [{}] },
    { message: "x", history: [{ role: "system", content: "injected" }, { role: "assistant", content: "x" }] },
    { message: "x", history: [{ role: "user", content: "x" }, { role: "assistant", content: "x", system: "extra" }] },
    { message: "x", history: Array(18).fill({ role: "user", content: "x" }) },
    { message: "x", history: [{ role: "user", content: "x".repeat(16000) }, { role: "assistant", content: "x".repeat(16000) }] },
    { message: "x", context: { endpoint: "https://example.invalid" } },
    { message: "x", context: { pendingAction: "x".repeat(8001) } }, "not JSON"]) {
    const response = await app.post(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  }
  const large = await app.post({ message: "x".repeat(270_000) });
  assert.equal(large.status, 413);
  assert.equal((await large.json()).error.code, "request_too_large");
  assert.equal(app.seen.length, 0);
});

test("starter: fixed static routes never serve credentials or server files", async (t) => {
  const app = await fixture(t, (_entry, res) => answer(res));
  for (const path of ["/", "/app.js", "/styles.css", "/conversation.mjs"]) {
    const response = await fetch(`${app.origin}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    assert.ok(!(await response.text()).includes(KEY));
    assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const path of ["/.env", "/.env.example", "/server.mjs", "/config.mjs", "/package.json", "/node_modules/@aivana/sdk/src/index.js", "/%2eenv"]) {
    assert.equal((await fetch(`${app.origin}${path}`)).status, 404);
  }
  assert.equal(app.seen.length, 0);
});

test("starter: cross-origin, wrong-host, form and preflight requests cannot spend credit", async (t) => {
  const app = await fixture(t, (_entry, res) => answer(res));
  for (const settings of [{ headers: { Origin: "https://other.invalid" } },
    { headers: { Origin: "null" } }, { headers: { Host: "other.invalid", Origin: "http://other.invalid" } },
    { headers: { "Sec-Fetch-Site": "cross-site" } }]) {
    assert.equal((await app.post({ message: "x" }, settings)).status, 403);
  }
  assert.equal((await app.post({ message: "x" }, { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await fetch(`${app.origin}/api/chat`, { method: "OPTIONS" })).status, 405);
  assert.equal((await fetch(`${app.origin}/api/chat`)).status, 405);
  assert.equal(app.seen.length, 0);
});

test("starter: upstream errors use fixed messages, never leak raw details and never retry", async (t) => {
  let status = 401;
  const app = await fixture(t, (_entry, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "raw_failure", message: KEY, request_id: KEY }, debug: KEY }));
  });
  for (const [upstreamStatus, expectedStatus, code] of [[401, 502, "authentication_failed"], [402, 402, "insufficient_credit"],
    [403, 403, "access_denied"], [400, 400, "invalid_request"], [422, 400, "invalid_request"],
    [429, 429, "rate_limited"], [500, 502, "unavailable"], [502, 502, "unavailable"]]) {
    status = upstreamStatus;
    const response = await app.post({ message: "x" });
    assert.equal(response.status, expectedStatus);
    const text = await response.text();
    assert.equal(JSON.parse(text).error.code, code);
    assert.ok(!text.includes(KEY));
    assert.ok(!text.includes("raw_failure"));
  }
  assert.equal(app.seen.length, 8);
});

test("starter: malformed and empty answers fail without entering a follow-up", async (t) => {
  let result;
  const app = await fixture(t, (_entry, res) => answer(res, { answer: result }));
  for (result of [null, "", "   ", {}, "x".repeat(16001)]) {
    const response = await app.post({ message: "x" });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "unavailable");
  }
  result = "Recovered";
  assert.equal((await (await app.post({ message: "new request" })).json()).answer, "Recovered");
  assert.deepEqual(app.seen.at(-1).body.messages, [{ role: "user", content: "new request" }]);
});

test("starter: a stalled upstream request times out and frees its slot", { timeout: 5_000 }, async (t) => {
  let hang = true;
  const app = await fixture(t, (_entry, res) => { if (!hang) answer(res); }, { timeoutMs: 300 });
  const response = await app.post({ message: "x" });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, "timeout");
  hang = false;
  assert.equal((await app.post({ message: "later" })).status, 200);
});

test("starter: disconnecting the browser cancels upstream generation", { timeout: 5_000 }, async (t) => {
  let reached;
  const reachedUpstream = new Promise((resolve) => { reached = resolve; });
  let closed;
  const closedUpstream = new Promise((resolve) => { closed = resolve; });
  const app = await fixture(t, (_entry, res) => { reached(); res.once("close", closed); });
  const controller = new AbortController();
  const pending = app.post({ message: "x" }, { signal: controller.signal });
  await reachedUpstream;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await Promise.race([closedUpstream, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Upstream was not cancelled")), 1500); timer.unref(); })]);
});

test("starter: concurrency is bounded without sharing conversation state", { timeout: 5_000 }, async (t) => {
  const pending = [];
  let full;
  const bothStarted = new Promise((resolve) => { full = resolve; });
  const app = await fixture(t, (_entry, res) => { pending.push(res); if (pending.length === 2) full(); });
  const first = app.post({ message: "one" });
  const second = app.post({ message: "two" });
  await bothStarted;
  const third = await app.post({ message: "three" });
  assert.equal(third.status, 429);
  assert.equal((await third.json()).error.code, "busy");
  for (const res of pending) answer(res);
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.deepEqual(app.seen.map(({ body }) => body.messages.length), [1, 1]);
});

test("starter: browser context retains complete recent pairs within both limits", () => {
  const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: String(index) }));
  const recent = recentHistory(history);
  assert.equal(recent.length, LIMITS.historyMessages);
  assert.equal(recent[0].content, "4");
  assert.equal(history.length, 20, "must not mutate browser state while preparing a request");
  const large = [{ role: "user", content: "x".repeat(12000) }, { role: "assistant", content: "y".repeat(12000) }];
  assert.deepEqual(recentHistory(large, "new question"), []);
  assert.deepEqual(recentHistory([], "x".repeat(25000)), [], "must not loop forever on an oversized draft");
});

test("starter: configuration refuses unsafe URLs, placeholder keys and invalid ports", () => {
  for (const AIVANA_API_KEY of ["", "YOUR_ACTIVE_KEY", "REPLACE_ME", "ai_live_xxx"]) {
    assert.throws(() => readConfiguration({ AIVANA_API_KEY }), /Set an active/);
  }
  for (const AIVANA_API_BASE of ["not-url", "http://example.com", "https://key:secret@example.com", "https://example.com?key=secret", "https://example.com/#secret", "https://example.com/wrong-path"]) {
    assert.throws(() => readConfiguration({ AIVANA_API_KEY: KEY, AIVANA_API_BASE }), /AIVANA_API_BASE/);
  }
  for (const PORT of ["0", "1.2", "65536", "oops"]) assert.throws(() => readConfiguration({ AIVANA_API_KEY: KEY, PORT }), /PORT/);
  assert.equal(readConfiguration({ AIVANA_API_KEY: KEY, AIVANA_API_BASE: "https://api.aivana.ai/v1/" }).apiBase, "https://api.aivana.ai");
  assert.equal(readConfiguration({ AIVANA_API_KEY: KEY }).apiBase, undefined, "use the installed SDK's production default");
});

test("starter: standalone startup loads a local env file and uses the installed released SDK", { skip: !supportsEnvFile, timeout: 15_000 }, async (t) => {
  const api = await fixture(t, (_entry, res) => answer(res));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), "aivana-basic-chat-"));
  const envPath = join(directory, ".env");
  t.after(async () => { await unlink(envPath); await rmdir(directory); });
  await writeFile(envPath, `AIVANA_API_KEY=${KEY}\nAIVANA_API_BASE=${api.apiBase}\nPORT=${port}\n`);
  const env = { ...process.env };
  delete env.AIVANA_API_KEY; delete env.AIVANA_API_BASE; delete env.PORT;
  const child = spawn(process.execPath, [`--env-file=${envPath}`, "server.mjs"], { cwd: EXAMPLE, env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("Basic AI Chat:")) resolve(); });
    child.once("exit", () => reject(new Error(`Starter did not start: ${errors}`)));
    child.once("error", reject);
  });
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/chat`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ message: "hello" }) });
  assert.equal(response.status, 200);
  assert.equal(api.seen[0].headers["x-api-key"], KEY);
  assert.ok(!output.includes(KEY));
  assert.equal(errors, "");
  const installed = JSON.parse(await readFile(join(EXAMPLE, "node_modules/@aivana/sdk/package.json"), "utf8"));
  assert.equal(installed.version, "0.7.1");
  const lock = JSON.parse(await readFile(join(EXAMPLE, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/@aivana/sdk"].version, "0.7.1");
  assert.match(lock.packages["node_modules/@aivana/sdk"].resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.equal(lock.packages["node_modules/@aivana/sdk"].link, undefined, "must install the released SDK, not a local checkout link");
});
