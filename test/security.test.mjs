// Transport hardening: where the API key may go, and what a misbehaving server can
// and cannot make the SDK do. Real local servers rather than a fake fetch, because
// what is under test is fetch's own redirect and body handling.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import Aivana, { AivanaError } from "../src/index.js";
import { terminalSafe } from "../src/cli.js";

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}`,
                close: () => { server.closeAllConnections(); server.close(); } });
    });
  });
}

test("a cross-host redirect is reported, and the key never reaches the other host", async () => {
  const seen = [];
  const other = await serve((req, res) => {
    seen.push(req.headers["x-api-key"]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"answer":"x"}');
  });
  const api = await serve((req, res) => {
    res.writeHead(307, { location: `${other.base}/steal` });
    res.end();
  });
  try {
    const client = new Aivana({ apiKey: "ai_live_secret", apiBase: api.base });
    for (const call of [() => client.generate("hi"), () => client.quotas(),
                        async () => { for await (const _ of client.generateStream("hi")) { /* */ } }]) {
      await assert.rejects(call, (e) => e instanceof AivanaError && e.code === "redirect"
                                        && e.status === 307);
    }
    assert.deepEqual(seen, [], "the redirect target must never be contacted");
  } finally {
    api.close();
    other.close();
  }
});

test("a 200 that is not JSON is an AivanaError, not a SyntaxError", async () => {
  const api = await serve((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>proxy login</html>");
  });
  try {
    const client = new Aivana({ apiKey: "k", apiBase: api.base });
    await assert.rejects(() => client.generate("hi"),
                         (e) => e instanceof AivanaError && e.code === "invalid_response");
  } finally {
    api.close();
  }
});

test("terminalSafe keeps text, tab and newline and drops every other control", () => {
  assert.equal(terminalSafe("a\tb\nc"), "a\tb\nc");
  assert.equal(terminalSafe("é ü 中文 🙂"), "é ü 中文 🙂");
  assert.equal(terminalSafe("\u001b]0;t\u0007\u001b[31mx\r\u009b2J\u007f\u0000"), "]0;t[31mx2J");
});
