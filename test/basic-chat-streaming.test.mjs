import { test } from "node:test";
import assert from "node:assert/strict";
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
