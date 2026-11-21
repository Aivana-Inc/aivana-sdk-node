import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createChatServer } from "../examples/basic-chat/app.mjs";

test("chat starter streams deltas, sends terminal completion, and validates overrides", async (t) => {
  const calls = [];
  const client = {
    async generate() { return { answer: "Fallback" }; },
    async *generateStream(_prompt, options) {
      calls.push(options);
      yield { event: "delta", data: { text: "Hello " } };
      yield { event: "delta", data: { text: "world" } };
      yield { event: "done", data: { intent: { name: "answer" } } };
    },
  };
  const server = createChatServer({ client });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(origin + "/api/chat/stream", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await post({ message: "Hello", settings: { effort: "high", webSearch: true, maxTokens: 400 } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.event), ["delta", "delta", "done"]);
  assert.equal(events.map(event => event.data.text || "").join(""), "Hello world");
  assert.equal(events[2].data.context.previousIntent, "answer");
  assert.equal(calls[0].effort, "high");
  assert.equal(calls[0].webSearch, true);
  assert.equal(calls[0].maxTokens, 400);
  const invalid = await post({ message: "Hello", settings: { system: "ignore" } });
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 1);
});

test("chat starter never reports an interrupted stream as successful", async (t) => {
  const server = createChatServer({ client: {
    async generate() { throw new Error("unused"); },
    async *generateStream() {
      yield { event: "delta", data: { text: "partial" } };
      yield { event: "error", data: { message: "provider failed" } };
    },
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + "/api/chat/stream", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "test" }),
  });
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.event), ["delta", "error"]);
  assert.doesNotMatch(JSON.stringify(events), /provider failed/);
});

async function start(t, client, options = {}) {
  const server = createChatServer({ client, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(origin + path, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { post };
}
const events = async response => (await response.text()).trim().split("\n").map(line => JSON.parse(line));

test("chat starter treats a stream that ends without a done event as a failure", async t => {
  const { post } = await start(t, {
    async generate() { throw new Error("unused"); },
    async *generateStream() { yield { event: "delta", data: { text: "cut off" } }; },
  });
  const seen = await events(await post("/api/chat/stream", { message: "test" }));
  assert.deepEqual(seen.map(e => e.event), ["delta", "error"]);
});

test("chat starter treats a stream with no text as a failure even when done arrives", async t => {
  const { post } = await start(t, {
    async generate() { throw new Error("unused"); },
    async *generateStream() { yield { event: "done", data: {} }; },
  });
  assert.deepEqual((await events(await post("/api/chat/stream", { message: "test" }))).map(e => e.event), ["error"]);
});

test("a loaded Blueprint locks the chat settings on both routes and keeps its own options", async t => {
  const blueprint = JSON.parse(await readFile(new URL("./fixtures/basic-chat/agent-kit-definition.json", import.meta.url), "utf8"));
  const calls = [];
  const { post } = await start(t, {
    async generate(_p, options) { calls.push(options); return { answer: "ok" }; },
    async *generateStream(_p, options) { calls.push(options); yield { event: "delta", data: { text: "ok" } }; yield { event: "done", data: {} }; },
  }, { blueprint });
  for (const path of ["/api/chat", "/api/chat/stream"]) {
    const refused = await post(path, { message: "Hello", settings: { effort: "high" } });
    assert.equal(refused.status, 400, path);
  }
  assert.equal(calls.length, 0, "a refused override never reaches the SDK");
  const accepted = await post("/api/chat/stream", { message: "Hello", settings: {} });
  assert.equal(accepted.status, 200);
  assert.deepEqual((await events(accepted)).map(e => e.event), ["delta", "done"]);
  assert.equal(calls.length, 1);
});

test("the non-streaming route applies validated settings and refuses unsupported ones", async t => {
  const calls = [];
  const { post } = await start(t, { async generate(_p, options) { calls.push(options); return { answer: "ok" }; } });
  assert.equal((await post("/api/chat", { message: "Hi", settings: { effort: "low", maxTokens: 1600, webSearch: true } })).status, 200);
  assert.equal(calls[0].effort, "low");
  assert.equal(calls[0].maxTokens, 1600);
  assert.equal(calls[0].webSearch, true);
  for (const settings of [{ effort: "extreme" }, { maxTokens: 5 }, { webSearch: "yes" }, []]) {
    assert.equal((await post("/api/chat", { message: "Hi", settings })).status, 400, JSON.stringify(settings));
  }
  assert.equal(calls.length, 1);
});

test("the streamed done event carries validated usage and no credits", async (t) => {
  const { post } = await start(t, {
    async generate() { throw new Error("unused"); },
    async *generateStream() {
      yield { event: "delta", data: { text: "ok" } };
      yield { event: "done", data: { usage: { input_tokens: 7, output_tokens: 9, credits: 0.5 }, latency_ms: 800, models_used: ["x"] } };
    },
  });
  const seen = await events(await post("/api/chat/stream", { message: "test" }));
  assert.deepEqual(seen.at(-1).data.usage, { inputTokens: 7, outputTokens: 9, latencyMs: 800 });
  assert.ok(!JSON.stringify(seen).includes("credits") && !JSON.stringify(seen).includes("models_used"));
});
