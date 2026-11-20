#!/usr/bin/env bash
# Aivana Node SDK validation - one command.
#   bash run_validation.sh                                   # offline checks only (free, no key)
#   export AIVANA_API_KEY=ai_test_... && bash run_validation.sh   # + live checks on the dev host
# Optional: AIVANA_API_BASE=https://... ; AIVANA_LIVE_PACE=6 (seconds between live calls)
#   AIVANA_SDK_SPEC / AIVANA_CLI_SPEC          test another version or an unpublished tarball (see below)
#   AIVANA_EXPECT_SDK_VERSION / _CLI_VERSION   stop (exit 2) unless that exact version is installed
#   AIVANA_RESULTS_DIR                         write the matrix and evidence here, not into results/
#   AIVANA_REQUIRE_LIVE=1                      exit 3 if any live case was skipped
# Exit code: 0 nothing unexpected, 1 a case FAILED, 2 nothing ran or the wrong version, 3 live required but skipped.
set -euo pipefail
cd "$(dirname "$0")"
# A key in .env (gitignored) is loaded, so it never has to be typed into a shell.
if [ -f .env ]; then set -a; source .env; set +a; fi
command -v node >/dev/null || { echo "Node.js 18+ is required: https://nodejs.org (or: brew install node)"; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 18 ] || { echo "Node.js 18+ required (found $(node --version))"; exit 1; }
want_sdk=$(node -p 'require("./package.json").dependencies["@aivana/sdk"]')
have_sdk=$(node -p 'try { require("./node_modules/@aivana/sdk/package.json").version } catch { "" }')
want_cli=$(node -p 'require("./package.json").dependencies["@aivana/cli"] || ""')
have_cli=$(node -p 'try { require("./node_modules/@aivana/cli/package.json").version } catch { "" }')
# AIVANA_SDK_SPEC / AIVANA_CLI_SPEC test something other than the pinned 0.7.1: any npm spec, e.g. "@aivana/sdk@0.8.0"
# or the path of a tarball from `npm pack` (a release candidate that is not published yet). Set both together: the
# CLI depends on the exact SDK version it was released with. Nothing is written to package.json (--no-save).
if [ -n "${AIVANA_SDK_SPEC:-}${AIVANA_CLI_SPEC:-}" ]; then
  npm install --no-save --silent --no-audit --no-fund ${AIVANA_SDK_SPEC:+"$AIVANA_SDK_SPEC"} ${AIVANA_CLI_SPEC:+"$AIVANA_CLI_SPEC"}
elif [ "$want_sdk" != "$have_sdk" ] || [ "$want_cli" != "$have_cli" ]; then npm install --silent --no-audit --no-fund; fi
echo "key: $([ -n "${AIVANA_API_KEY:-}" ] && echo set || echo 'not set (live tests skipped)')"
node run.mjs "$@"
