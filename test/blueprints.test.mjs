import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Aivana, { AivanaError, InvalidRequestError, UnsupportedAPIError } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../conformance/blueprints.json", import.meta.url)));
const input = { id: fixture.id, version: fixture.version, prompt: "hello" };
const response = () => structuredClone(fixture.response);
const sse = frames => frames.map(([event, data]) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`).join("");
const done = () => ["done", { finish_reason: "stop", blueprint: response().blueprint, usage: response().usage }];

function stub(makeResponse, config = {}) {
  const calls = [];
  const client = new Aivana({ apiKey: "synthetic-not-a-real-key", apiBase: "https://fixture.invalid", ...config,
    fetch: async (url, init) => { calls.push({ url, init }); return makeResponse(init); },
  });
  return { client, calls };
}

test("normal invocation carries runtime fields only, including false and file aliases", async () => {
  const { client, calls } = stub(() => Response.json(response()));
  const names = { previous_intent: "previousIntent", pending_action: "pendingAction", assistant_name: "assistantName", intelligence_trace: "intelligenceTrace" };
  const runtime = Object.fromEntries(Object.entries(fixture.input).map(([k,v]) => [names[k] ?? k, v]));
  runtime.attachments = [{ mimeType: "text/csv", data: "YQox" }];
  const result = await client.blueprints.generate({ id: fixture.id, version: 3, ...runtime });
  assert.deepEqual(result.blueprint, response().blueprint);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://fixture.invalid/v1/blueprints/${fixture.id}/versions/3/generate`);
  assert.deepEqual(JSON.parse(calls[0].init.body), fixture.input);
  assert.equal(calls[0].init.headers["X-API-Key"], "synthetic-not-a-real-key");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.credentials, "omit");
});

test("latest must be explicit and returns the resolved numeric version", async () => {
  const result = response(); result.blueprint.version = 7;
  const { client, calls } = stub(() => Response.json(result));
  assert.equal((await client.blueprints.generate({ ...input, version: "latest" })).blueprint.version, 7);
  assert.match(calls[0].url, /\/versions\/latest\/generate$/);
});

for (const version of [undefined, null, 0, -1, 1.5, "3", "Latest", "", true, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid version ${String(version)} is refused before fetching`, async () => {
    const { client, calls } = stub(() => { throw Error("must not fetch"); });
    await assert.rejects(client.blueprints.generate({ ...input, version }), InvalidRequestError);
    assert.equal(calls.length, 0);
  });
}
for (const id of [undefined, "", "bp_", "../v1/generate", "bp_a/versions/latest", "bp_a?x=1"]) {
  test(`invalid id ${String(id)} is refused before fetching`, async () => {
    const { client, calls } = stub(() => { throw Error("must not fetch"); });
    await assert.rejects(client.blueprints.generate({ ...input, id }), InvalidRequestError);
    assert.equal(calls.length, 0);
  });
}
for (const key of ["system", "effort", "webSearch", "temperature", "topP", "maxTokens", "stopSequences", "responseFormat", "outputShape", "model", "provider", "knowledge", "blueprint", "mode", "promtp"]) {
  test(`saved or unknown setting ${key} is not silently dropped`, async () => {
    const { client, calls } = stub(() => { throw Error("must not fetch"); });
    await assert.rejects(client.blueprints.generate({ ...input, [key]: null }), InvalidRequestError);
    assert.equal(calls.length, 0);
  });
}

for (const error of fixture.errors) {
  for (const method of ["generate", "stream"]) {
    test(`${method}: HTTP ${error.status} ${error.code}, one call and no fallback`, async () => {
      const { client, calls } = stub(() => Response.json(error.body, { status: error.status }));
      const run = async () => {
        if (method === "generate") return client.blueprints.generate(input);
        for await (const _ of client.blueprints.stream(input)) { /* drain */ }
      };
      await assert.rejects(run(), e => {
        assert.ok(e instanceof AivanaError); assert.equal(e.code, error.code);
        if (error.code === "blueprint_invocation_unsupported") assert.ok(e instanceof UnsupportedAPIError);
        if (error.status === 422) assert.deepEqual(e.details, error.body.error.details);
        return true;
      });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/v1\/blueprints\//);
    });
  }
}

test("a non-JSON router 404 is unsupported, not a missing Blueprint", async () => {
  const { client } = stub(() => new Response("not found", { status: 404 }));
  await assert.rejects(client.blueprints.generate(input), UnsupportedAPIError);
});
test("redirects are refused without following them", async () => {
  const { client, calls } = stub(() => new Response(null, { status: 307, headers: { location: "https://other.invalid" } }));
  await assert.rejects(client.blueprints.generate(input), e => e.code === "redirect");
  assert.equal(calls.length, 1);
});

for (const ref of [undefined, { id: "bp_other", version: 3 }, { id: fixture.id, version: 4 }, { id: fixture.id, version: "3" }, { id: fixture.id, version: true }]) {
  test(`normal response must confirm the exact version: ${JSON.stringify(ref)}`, async () => {
    const result = response(); result.blueprint = ref;
    const { client, calls } = stub(() => Response.json(result));
    await assert.rejects(client.blueprints.generate(input), e => e.code === "invalid_response");
    assert.equal(calls.length, 1);
  });
}

test("chunked UTF-8/CRLF SSE preserves events, Trace, usage and done reference", async () => {
  const text = sse([["delta", { text: "héllo" }], ["trace", { status: "completed" }], done()]);
  const bytes = new TextEncoder().encode(text);
  const { client, calls } = stub(() => new Response(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close(); } })));
  const chunks = []; for await (const chunk of client.blueprints.stream(input)) chunks.push(chunk);
  assert.deepEqual(chunks.map(c => c.event), ["delta", "trace", "done"]);
  assert.equal(chunks[0].data.text, "héllo");
  assert.deepEqual(chunks[2].data.blueprint, response().blueprint);
  assert.deepEqual(chunks[2].data.usage, response().usage);
  assert.match(calls[0].url, /\/generate:stream$/);
});

for (const [frames, code] of [
  [[["delta", { text: "partial" }]], "incomplete_stream"],
  [[["delta", { text: "partial" }], ["error", { code: "upstream", message: "failed" }]], "upstream"],
  [[["done", { blueprint: { id: fixture.id, version: 7 } }]], "invalid_response"],
  [[["delta", null]], "invalid_response"],
  [[["done", { finish_reason: "error" }]], "upstream"],
]) {
  test(`stream refuses ${code} without retry`, async () => {
    const { client, calls } = stub(() => new Response(sse(frames)));
    await assert.rejects(async () => { for await (const _ of client.blueprints.stream(input)) { /* drain */ } }, e => e.code === code);
    assert.equal(calls.length, 1);
  });
}

test("breaking iteration cancels the response body", async () => {
  let cancelled = false;
  const { client } = stub(() => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(sse([["delta", { text: "first" }]]))); },
    cancel() { cancelled = true; },
  })));
  for await (const _ of client.blueprints.stream(input)) break;
  assert.equal(cancelled, true);
});
for (const reason of ["caller", "timeout"]) {
  test(`stream remains cancellable after headers: ${reason}`, async () => {
    const ac = new AbortController();
    const { client, calls } = stub(init => new Response(new ReadableStream({
      start(c) { init.signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")), { once: true }); },
    })), { timeoutMs: reason === "timeout" ? 15 : 2000 });
    const iterator = client.blueprints.stream({ ...input, signal: ac.signal });
    const next = iterator.next();
    if (reason === "caller") setTimeout(() => ac.abort(), 10);
    await assert.rejects(next, e => reason === "caller" ? e.name === "AbortError" : e.code === "timeout");
    assert.equal(calls.length, 1);
  });
}
test("an already-aborted signal makes no HTTP request", async () => {
  const ac = new AbortController(); ac.abort();
  const { client, calls } = stub(() => { throw Error("must not fetch"); });
  await assert.rejects(client.blueprints.generate({ ...input, signal: ac.signal }), e => e.name === "AbortError");
  assert.equal(calls.length, 0);
});

for (const version of ["3", "latest"]) for (const streaming of [false, true]) {
  test(`candidate example over real loopback HTTP: ${version}, stream=${streaming}`, async t => {
    let calls = 0;
    const server = createServer(async (req, res) => {
      let body = ""; for await (const part of req) body += part;
      const expected = `/v1/blueprints/${fixture.id}/versions/${version}/generate${streaming ? ":stream" : ""}`;
      if (req.url !== expected || req.headers["x-api-key"] !== "synthetic-not-a-real-key") {
        res.writeHead(400); res.end(); return;
      }
      const payload = JSON.parse(body);
      if (Object.keys(payload).sort().join(",") !== "intelligence_trace,prompt") {
        res.writeHead(422); res.end(); return;
      }
      calls++;
      const result = response(); result.blueprint.version = version === "latest" ? 7 : 3;
      res.setHeader("Content-Type", streaming ? "text/event-stream" : "application/json");
      res.end(streaming ? sse([["delta", { text: result.answer }], ["done", result]]) : JSON.stringify(result));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const example = fileURLToPath(new URL("../examples/blueprints/invoke.mjs", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [example, ...(streaming ? ["--stream"] : [])], {
      timeout: 10000,
      env: { ...process.env, AIVANA_API_KEY: "synthetic-not-a-real-key",
        AIVANA_API_BASE: `http://127.0.0.1:${server.address().port}`, AIVANA_BLUEPRINT_ID: fixture.id,
        AIVANA_BLUEPRINT_VERSION: version },
    });
    assert.match(stdout, /Resolved Blueprint:/);
    assert.ok(stdout.includes(fixture.id));
    assert.equal(calls, 1);
  });
}
