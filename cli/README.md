# @aivana/cli

The `aivana` command: ask the Aivana Intelligence API from your terminal.

```bash
npm install -g @aivana/cli     # or run it without installing: npx @aivana/cli "..."
export AIVANA_API_KEY=ai_live_xxx
aivana "Should we enter the EU market in 2027?"
```

Requires Node.js 18 or newer. Create an API key in AI Studio under **API Keys**.

The answer streams to stdout as it is written; progress, the trace and errors go to
stderr. So `aivana "..." > answer.md` saves just the answer, and the command works
in pipes. Text piped in is sent ahead of the question:

```bash
git diff | aivana "Review this change" --effort high
aivana "Summarise the three biggest risks" < contract.txt
aivana "What's driving the dip in this chart?" --image chart.png
aivana "Postgres or DynamoDB for a write-heavy API?" --shape tradeoffs --trace
aivana "Extract the invoice number and total" --shape extract --json < invoice.txt
```

| option | meaning |
|---|---|
| `--effort auto\|low\|medium\|high` | how much intelligence to spend; `auto` lets Aivana judge |
| `--shape SHAPE` | answer format: `auto`, `text`, `recommendation`, `summary`, `tradeoffs`, `decision`, `extract` |
| `--web` / `--no-web` | always / never search the web first; neither means no search, the default for API keys |
| `--system TEXT` | your own instructions: persona, tone, format |
| `--assistant-name NAME` | the name the assistant presents as |
| `--max-tokens N` | a ceiling on answer length |
| `--temperature T` | 0.0–2.0; omit to let Aivana choose |
| `--image PATH` | attach a PNG, JPEG, WebP or GIF image (repeatable) |
| `--trace` | show the Intelligence Trace (on stderr) |
| `--json` | the whole response as JSON, without streaming |

There is deliberately no option to choose a model or provider: which models answer
is Aivana's decision. `AIVANA_API_BASE` points the command at another deployment.
`aivana --help` lists everything.

Scripts can branch on the exit code:

| code | meaning |
|---|---|
| 0 | success |
| 1 | the request failed |
| 2 | bad usage |
| 3 | authentication problem: no key, or an invalid or expired one |
| 4 | rate limited: wait, then retry |
| 5 | out of credits: top up in AI Studio |
| 6 | temporary failure (network, timeout, upstream): safe to retry |
| 130 | interrupted |

Two things worth knowing:

- **The key comes from `AIVANA_API_KEY` only.** There is no `--api-key` flag, on
  purpose: a key typed as an argument is saved in your shell history and is visible
  to other users in the process list.
- **Quote the question.** Unquoted words work, but the shell acts on characters
  such as `?`, `*` and `'` before `aivana` sees them. `aivana ask "..."` is the same
  as `aivana "..."`, for a question that starts with a word the CLI keeps for future
  commands (`chat`, `usage`, ...).

## Same command, two packages

`pipx install aivana` installs the same `aivana` command from the Python SDK. Both
pass one shared conformance suite (`conformance/cli.json` in this repository), so
they behave identically: the same messages, the same exit codes, the same requests.

This package is a thin wrapper: the command itself ships in
[`@aivana/sdk`](https://www.npmjs.com/package/@aivana/sdk) as `@aivana/sdk/cli`, and
each release of this package depends on the matching SDK version exactly.

## License

Apache-2.0
