# Browser checks for the Basic Chat starter

Opt-in checks that drive the real page in a real browser (Chromium). They are **not** run by `npm test` or by CI,
nothing here is published with the SDK, and neither Playwright nor axe-core is a dependency of this repository.

## What they cover

| Script | Needs a key | What it checks |
| --- | --- | --- |
| `chat-flow.mjs` | no | Thinking to streaming, Stop available throughout, Copy fidelity (answer and code), Regenerate and Retry request counts and history, Interrupted and Stopped states, smart scroll and Jump to latest, the composer staying anchored, settings, the Blueprint view, no console or CSP errors. A scripted fake stands in for the API. |
| `typing-animation.mjs` | no | A large piece is revealed gradually, completion waits for it, Stop and New chat mid-reveal, reduced motion, no animation frames (background tab), streaming off. |
| `markdown-reveal.mjs` | no | Raw Markdown markers (`**`, backticks, `[`, `](`, `~~`) are never visible while text is typed out. |
| `keyboard.mjs` | no | Tab order in both themes: every control reachable, with a visible focus ring; Enter in the message box makes a new line. |
| `a11y.mjs` | no | axe-core over every page state, in light and dark, desktop and phone width. Fails on any violation and lists what axe could not decide. |
| `live.mjs` | **yes, and it is billable** | The real page, starter and SDK against a real API: streaming with the typing animation, Stop, and Interrupted then Retry. |

None of this replaces a person looking at the page on real devices and browsers, or using a screen reader.

## Run them

```sh
npm ci --prefix examples/basic-chat                       # the starter's own dependencies
npm install --no-save playwright axe-core                 # leaves package.json alone
npx playwright install chromium

node tools/browser-checks/run.mjs                         # everything that needs no key
node tools/browser-checks/chat-flow.mjs /tmp/shots        # or one script; the folder is where screenshots go
```

Screenshots go to the folder you name, or to `basic-chat-browser-checks` under the system temp directory.

## The live check

```sh
AIVANA_API_KEY=... node tools/browser-checks/live.mjs --billable
# or together with the others:
AIVANA_API_KEY=... node tools/browser-checks/run.mjs --live --billable
```

It sends about four short requests (two are cut off early) and uses account credit, so it refuses to run without
`--billable`. The key is read from the environment and is never printed. `AIVANA_API_BASE` is optional; leave it
unset for the SDK's production default, or point it at a development environment together with a matching key.

It also prints what the real stream delivered (how many pieces, and the fields of the final message), which is the
quickest way to notice if the API's streaming shape changes.

## Notes

- The scripted fake in the other checks is shaped like the real stream (an answer arriving in a few large pieces), but
  it is a fake. The live check is the one that proves the real thing.
- If a check fails, read the line that says what was expected before changing the check: several of these were written
  because a real bug or a wrong assumption was found.
