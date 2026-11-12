# Aivana Node SDK validation

A repeatable test suite for the official `@aivana/sdk` Node package and the `aivana` command from `@aivana/cli` (npm), tested as an external developer would use them. It's the Node part of Charter Rev2, Objective 1 / Deliverable 2 (CLI & SDK Validation). Case IDs mirror the Python suite (`PY-GEN-03` ↔ `NODE-GEN-03`), so the two SDKs can be compared row by row.

## Run it

```bash
cd validation          # in a clone of aivana-sdk-node
bash run_validation.sh                     # offline checks: free, no key needed

printf 'Key: ' && read -rs AIVANA_API_KEY && echo && export AIVANA_API_KEY && bash run_validation.sh
# or put AIVANA_API_KEY=... in .env here (gitignored); run_validation.sh and install_check.sh load it

bash install_check.sh                      # fresh npm installs on Node 18/20/22/current, npm -g, npx
```

You need Node.js 18 or newer (`node --version`). Live checks default to `https://dev-developers.aivana.ai`; set `AIVANA_API_BASE` to change that. Live calls are spaced 6 seconds apart (`AIVANA_LIVE_PACE`) to stay under the dev API's per-minute limit, so a full run takes about 4 minutes. To run only some cases, pass a filter: `bash run_validation.sh STR`.

## Results

| File | Contents |
|---|---|
| `results/matrix.md` / `.csv` | One row per case with PASS / FAIL / DEFECT (known) / FIXED? (re-check) / SKIP and a finding ID |
| `results/evidence.jsonl` | Redacted evidence from each live call |

Finding IDs F1–F14 mean the same thing as in the Python report. N1, N2, … are Node-only.

## Layout

```
run.mjs             runner: loads the cases, writes results/
lib/harness.mjs     case registry, pacing, rate-limit handling, matrix + evidence writer
lib/mock.mjs        fake fetch (the SDK accepts `fetch` as an option) and real captured API bodies
tests/offline.mjs   43 cases: config, request building, parsing, streaming, cancellation, errors, chat, quotas
tests/live.mjs      27 cases: auth, generate options, effort, trace, structured output, streaming, abort, chat, quotas
tests/cli.mjs       the installed `aivana` (@aivana/cli) run as a real process: help/version, options on the wire,
                    stdin/pipes, --json, --trace, --image, exit codes, API base (offline: a fake API on
                    127.0.0.1; live: 8 cheap calls to the dev host)
tests/docs_snippets.mjs  every Node.js example on the AI Studio Docs and in the npm README, run against the
                    installed SDK with a mocked fetch
install_check.sh    clean installs: npm on Node 18/20/22/current, npm install -g @aivana/cli, npx
```

The CLI cases check against the @aivana/cli README and AI Studio > Docs > Command Line (`/docs/cli`). The
Docs examples need an `aivana-ai-studio` checkout next to this suite or the SDK repo (or `AIVANA_STUDIO_REPO`).

To add a case, use `kase("NODE-XXX-NN", "Area", "what it checks", fn, { live, known: "Fn: ..." })`. The SDK and CLI versions are pinned in `package.json` (`0.7.1`).
