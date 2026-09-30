// Web search and the conversation-wide options, both added in 0.6.0.
//
// The contract under test: `webSearch` is THREE-state. `false` is a real value
// that must reach the wire — it means "never search this request" — while an
// absent field means "use the API's default". A truthiness check in _body()
// would collapse the two and silently discard every opt-out, so these lock the
// difference. See _body() in src/index.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana from "../src/index.js";

const client = new Aivana({ apiKey: "ai_live_test" });
const body = (opts) => client._body(opts);

test("sends web_search true when forced on", () => {
  assert.equal(body({ prompt: "hi", webSearch: true }).web_search, true);
});

// The one that matters: false is falsy, and dropping it would turn an explicit
// "don't search" into "use the default" — a different request, and one that
// stops meaning "never" if the default ever changes.
test("sends web_search false rather than dropping it", () => {
  assert.equal(body({ prompt: "hi", webSearch: false }).web_search, false);
});

test("omits web_search entirely when the caller says nothing", () => {
  assert.equal("web_search" in body({ prompt: "hi" }), false);
});

test("treats explicit null as unset, like the other options", () => {
  assert.equal("web_search" in body({ prompt: "hi", webSearch: null }), false);
});

test("forwards assistantName as assistant_name", () => {
  assert.equal(body({ prompt: "hi", assistantName: "Acme Copilot" }).assistant_name,
               "Acme Copilot");
});

// chat() options are sticky for the conversation. assistantName was declared in
// ChatOptions from 0.5.0 but the constructor never read it, so it was silently
// dropped on every turn until 0.6.0.
test("chat() keeps system, assistantName and webSearch across turns", () => {
  const chat = client.chat({
    system: "You are a tax specialist.",
    assistantName: "Acme Copilot",
    webSearch: false,
  });
  assert.equal(chat.system, "You are a tax specialist.");
  assert.equal(chat.assistantName, "Acme Copilot");
  assert.equal(chat.webSearch, false);
});

// Storing them on the Chat is not the same as sending them: before 0.6.0 the
// constructor dropped assistantName outright, and send() is where a regression
// would actually show up.
test("chat().send() puts the sticky options on every request", async () => {
  const sent = [];
  const spy = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ answer: "ok", intent: { name: "qa" } }) };
    },
  });
  const chat = spy.chat({ assistantName: "Acme Copilot", webSearch: false });
  await chat.send("first");
  await chat.send("second");

  assert.equal(sent.length, 2);
  for (const b of sent) {
    assert.equal(b.assistant_name, "Acme Copilot");
    assert.equal(b.web_search, false);
  }
});

test("a per-turn option overrides the conversation default", async () => {
  const sent = [];
  const spy = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ answer: "ok", intent: { name: "qa" } }) };
    },
  });
  await spy.chat({ webSearch: false }).send("look this up", { webSearch: true });
  assert.equal(sent[0].web_search, true);
});

// pendingAction: the response has always carried `pending_action`, but until
// 0.6.0 the request could not send it back, so the offer a bare "yes" refers to
// was lost on every follow-up. The Python SDK had it; this one did not.
test("forwards pendingAction as pending_action", () => {
  assert.equal(body({ prompt: "yes", pendingAction: "code_fix" }).pending_action,
               "code_fix");
});

test("omits pending_action when there is no outstanding offer", () => {
  assert.equal("pending_action" in body({ prompt: "hi" }), false);
});

test("chat() carries the offer from one turn into the next", async () => {
  const sent = [];
  let pending = "code_fix";
  const spy = new Aivana({
    apiKey: "ai_live_test",
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({
        answer: "ok", intent: { name: "qa" }, pending_action: pending }) };
    },
  });
  const chat = spy.chat();
  await chat.send("Should we migrate?");
  assert.equal("pending_action" in sent[0], false, "nothing offered yet on turn 1");

  await chat.send("yes");
  assert.equal(sent[1].pending_action, "code_fix", "turn 1's offer must reach turn 2");

  // A turn that offers nothing clears the contract rather than repeating a stale one.
  pending = null;
  await chat.send("and after that?");
  await chat.send("go on");
  assert.equal("pending_action" in sent[3], false, "a cleared offer must not persist");
});
