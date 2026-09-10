// The error envelope: which class a caller catches, and what survives on it.
//
// The API answers a schema violation with 422 — not 400 — and its `details` list
// is the only part of the response that says WHICH field is wrong. Both are easy
// to lose: a status-only mapping files a 422 under the generic error, and a
// message-only error throws the field list away.

import { test } from "node:test";
import assert from "node:assert/strict";

import Aivana, {
  AivanaError, AuthError, ForbiddenError, InvalidRequestError,
  RateLimitError, UpstreamError,
} from "../src/index.js";

/** A client whose next request fails with this status and body. */
function failing(status, payload) {
  return new Aivana({
    apiKey: "ai_live_test",
    fetch: async () => ({ ok: false, status, json: async () => payload }),
  });
}

const envelope = (code, extra = {}) => ({
  error: { type: code, code, message: "nope", request_id: "req_123", ...extra },
});

const cases = [
  [401, "auth", AuthError],
  [403, "forbidden", ForbiddenError],
  [400, "invalid_request", InvalidRequestError],
  [429, "rate_limit_exceeded", RateLimitError],
  [502, "upstream", UpstreamError],
];

for (const [status, code, Cls] of cases) {
  test(`${status} ${code} throws ${Cls.name}`, async () => {
    await assert.rejects(
      () => failing(status, envelope(code)).generate("hi"),
      (err) => {
        assert.ok(err instanceof Cls, `got ${err.name}`);
        assert.equal(err.code, code);
        assert.equal(err.requestId, "req_123");
        assert.equal(err.status, status);
        return true;
      },
    );
  });
}

// A 422 is the shape a developer hits most often — a bad field, not a bad key —
// and its status is in none of the lists above, so only the code identifies it.
test("a 422 schema violation is an InvalidRequestError, by code not status", async () => {
  const details = [{ loc: ["body", "temperature"], msg: "less than or equal to 2", type: "less_than_equal" }];
  await assert.rejects(
    () => failing(422, envelope("invalid_request", { details })).generate("hi"),
    (err) => {
      assert.ok(err instanceof InvalidRequestError, `got ${err.name}`);
      assert.deepEqual(err.details, details, "the per-field list must survive");
      return true;
    },
  );
});

test("details is an empty list when the API sends none", async () => {
  await assert.rejects(
    () => failing(502, envelope("upstream")).generate("hi"),
    (err) => { assert.deepEqual(err.details, []); return true; },
  );
});

// An unparseable body (a proxy's HTML 503, say) must still throw a typed error
// rather than a TypeError from reading `.error` of null.
test("survives an error body that is not the envelope", async () => {
  const client = new Aivana({
    apiKey: "ai_live_test",
    fetch: async () => ({ ok: false, status: 503, json: async () => { throw new Error("not json"); } }),
  });
  await assert.rejects(() => client.generate("hi"), (err) => {
    assert.ok(err instanceof AivanaError);
    assert.equal(err.code, "internal_error");
    assert.equal(err.status, 503);
    return true;
  });
});
