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

## Testing another version, or a release candidate

The pin is only the default. To test a different release, or a tarball that is not published yet, set both specs (the CLI
depends on the exact SDK version it shipped with):

```bash
npm pack                                   # in the repo root, and again in cli/
AIVANA_SDK_SPEC=/path/aivana-sdk-0.8.0.tgz AIVANA_CLI_SPEC=/path/aivana-cli-0.8.0.tgz \
AIVANA_EXPECT_SDK_VERSION=0.8.0 AIVANA_EXPECT_CLI_VERSION=0.8.0 \
AIVANA_RESULTS_DIR=/tmp/validation-results \
  bash run_validation.sh
```

Nothing is written to `package.json`. `AIVANA_EXPECT_*` makes the run stop (exit 2) unless exactly that version is installed, so
a gate cannot pass by testing the wrong package. `AIVANA_RESULTS_DIR` keeps the run from overwriting the committed evidence.
A version later than 0.7.1 can turn a known defect into `FIXED? (re-check)`: that is reported, and does not fail the run.

## Exit code

`run_validation.sh` (and `node run.mjs`) exit with a status a script or a release gate can trust:

| Exit | Meaning |
|---|---|
| 0 | nothing unexpected: every case is PASS, DEFECT (known), FIXED? (re-check) or SKIP |
| 1 | at least one case **FAILED** (behaviour other than the docs or a documented defect describe) |
| 2 | nothing ran (a filter that matches no case), or the installed version is not the one expected |
| 3 | `AIVANA_REQUIRE_LIVE=1` and a live case was skipped (no key, or a 429), so live behaviour was not checked |

Without a key the live cases skip and the run still exits 0; a gate that needs live evidence sets `AIVANA_REQUIRE_LIVE=1`. The docs-example
cases need an `aivana-ai-studio` checkout (see Layout) and skip without one, which `AIVANA_REQUIRE_LIVE` does not cover.

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

To add a case, use `kase("NODE-XXX-NN", "Area", "what it checks", fn, { live, known: "Fn: ..." })`. The SDK and CLI versions are pinned in `package.json` (`0.7.1`), which is what a plain run tests; see below for testing another version.
