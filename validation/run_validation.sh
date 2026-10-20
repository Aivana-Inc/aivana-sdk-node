#!/usr/bin/env bash
# Aivana Node SDK validation - one command.
#   bash run_validation.sh                                   # offline checks only (free, no key)
#   export AIVANA_API_KEY=ai_test_... && bash run_validation.sh   # + live checks on the dev host
# Optional: AIVANA_API_BASE=https://... ; AIVANA_LIVE_PACE=6 (seconds between live calls)
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
if [ "$want_sdk" != "$have_sdk" ] || [ "$want_cli" != "$have_cli" ]; then npm install --silent --no-audit --no-fund; fi
echo "key: $([ -n "${AIVANA_API_KEY:-}" ] && echo set || echo 'not set (live tests skipped)')"
node run.mjs "$@"
