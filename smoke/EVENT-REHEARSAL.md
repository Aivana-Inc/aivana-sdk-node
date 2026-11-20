# Event rehearsal: the day before, on site

The automated smoke test proves the SDK works against production **from a GitHub data centre**. It cannot prove it
works for 33 people on one campus network behind one shared public address. This checklist does, with 3 to 5 people.
Allow about 30 minutes.

## Before you go

- [ ] The updated SDKs are published and the smoke test passed on the release (the publish gate did that).
- [ ] The per-IP limits are raised for the event, and you have looked at the values the API is actually running:
      600 requests a minute for requests carrying an API key, 300 for the rest (AWS console steps are in the session
      notes; the values are read when a server task starts, so tasks were restarted after the change).
- [ ] 3 to 5 **separate accounts** exist, one per rehearsal person, each created like a student's will be (sign-up with
      an emailed code), each with its own API key. Keys on one account share that account's limits, so several keys
      on one account is not the same test.
- [ ] Each account's balance is promotional tokens only, and you know what that balance is.

## On site, on the guest or student Wi-Fi (not your usual network)

1. [ ] **Install.** Each person, on their own laptop, follows the starter's README from scratch: `npm install @aivana/sdk`
       (or `pip install aivana`). Note anything that does not work first time. Proxy or certificate errors show up here.
2. [ ] **Reach the API.** Each person runs the 5-line example from the README with their own key. Pass: an answer comes
       back. Fail: write down the exact error and the request id.
3. [ ] **All at once.** On a count of three, everyone runs it again at the same moment, then a second time straight
       after. Pass: nobody gets a 429. A 429 here, with only 3 to 5 people, means the shared-address limit is lower than
       you think or something else counts requests: stop and look at what the API is running.
4. [ ] **Streaming.** Everyone runs the streaming example. Pass: text arrives piece by piece, not all at the end (some
       proxies hold the whole response back; if so the students' streaming demos will look broken).
5. [ ] **A rate-limit message a student can read.** Have one person fire requests in a loop until they get a 429.
       Pass: the SDK waits and retries by itself, or the error says how long to wait. (This is deliberately done by hand,
       once, not by automation.)
6. [ ] **Look at it from the server side** within a few minutes: Aivana Command → Request History, one customer per
       rehearsal account. Pass: the requests are there with sensible outcomes.

## What this does NOT prove

It does not test the 300 or 600 a minute ceiling itself (3 to 5 people cannot reach it). If you want that proven, a small
tool that sends free read-only calls at a measured rate from one laptop can be built; ask for it.

## After

- [ ] Write down every failure with its request id and what fixed it.
- [ ] After the event: revoke the test keys, lower the IP limits back, and delete the `production-smoke` secret or rotate it.
