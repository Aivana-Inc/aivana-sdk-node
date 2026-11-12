#!/usr/bin/env bash
# Clean-install checks for @aivana/sdk and @aivana/cli, as an external developer installs them.
#   bash install_check.sh              # every documented install path, no key needed
#   (with AIVANA_API_KEY set, or in .env, each install also answers one cheap live question)
# Everything happens in a throwaway directory with its own npm cache and global prefix, so nothing
# is installed into your own environment and every install really is fresh. Other Node versions
# come from npm's `node` package (a Node binary), kept in the same throwaway directory.
# Output: results/install.md
set -uo pipefail
cd "$(dirname "$0")"
if [ -f .env ]; then set -a; source .env; set +a; fi

VERSION="${AIVANA_VERSION:-$(node -p 'require("./package.json").dependencies["@aivana/sdk"]')}"
LIVE_BASE="${AIVANA_API_BASE:-https://dev-developers.aivana.ai}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export npm_config_cache="$WORK/npm-cache" npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
OUT=results/install.md
mkdir -p results
rows=()
pass=0; fail=0

record() {   # id, check, result, detail
  rows+=("| $1 | $2 | $3 | ${4//|/\\|} |")
  if [ "$3" = PASS ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
  printf '%-16s %-5s %s\n' "$1" "$3" "$2"
}

live_cli() {   # node-binary aivana-js -> "exit N answer='..'"
  [ -n "${AIVANA_API_KEY:-}" ] || { echo "skipped (no key)"; return; }
  AIVANA_API_BASE="$LIVE_BASE" "$1" "$2" "Reply with the single word: ok" --effort low --max-tokens 20 -q \
    </dev/null >"$WORK/ans" 2>"$WORK/err"
  echo "exit $? answer='$(tr -d '\n' <"$WORK/ans" | cut -c1-40)'"
}

SDK_PROBE='
import Aivana, { Aivana as Named, AivanaError, AuthError, RateLimitError } from "@aivana/sdk";
const v = JSON.parse((await import("node:fs")).readFileSync("node_modules/@aivana/sdk/package.json", "utf8")).version;
let live = "skipped (no key)";
if (process.env.AIVANA_API_KEY) {
  const c = new Aivana({ apiKey: process.env.AIVANA_API_KEY, apiBase: process.env.LIVE_BASE });
  const r = await c.generate("Reply with the single word: ok", { effort: "low", maxTokens: 20 });
  live = `ok answer=${JSON.stringify(r.answer.slice(0, 20))}`;
}
console.log(`${v} ${Named === Aivana} ${new Aivana({ apiKey: "k" }).apiBase} live: ${live}`);
'

# --- npm install @aivana/sdk in a fresh project, on each supported Node ------------------
node_bin() {   # major -> path to a node binary of that major version
  local major="$1"
  if [ "$major" = "system" ]; then command -v node; return; fi
  mkdir -p "$WORK/node-$major"
  (cd "$WORK/node-$major" && npm install -s "node@$major" >/dev/null 2>&1) || return 1
  echo "$WORK/node-$major/node_modules/node/bin/node"
}

for major in 18 20 22 system; do
  NODE="$(node_bin "$major")" || { record "INS-NPM-$major" "npm install @aivana/sdk@$VERSION on Node $major" FAIL "could not get Node $major"; continue; }
  nv="$("$NODE" --version)"
  id="INS-NPM-${major/system/$(echo "$nv" | cut -d. -f1 | tr -d v)}"
  proj="$WORK/proj-$major"
  mkdir -p "$proj" && cd "$proj"
  npm init -y >/dev/null 2>&1
  npm pkg set type=module >/dev/null 2>&1
  if PATH="$(dirname "$NODE"):$PATH" npm install -s "@aivana/sdk@$VERSION" >"$WORK/out" 2>&1; then
    deps="$(node -p 'Object.keys(require("./package-lock.json").packages).filter(Boolean).map(p=>p.replace("node_modules/","")).join(" ")')"
    printf '%s' "$SDK_PROBE" > probe.mjs
    res="$(LIVE_BASE="$LIVE_BASE" "$NODE" probe.mjs 2>&1 | tail -1)"
    if [[ "$res" == "$VERSION true https://api.aivana.ai live: "* ]] && [[ "$res" != *"Error"* ]]; then
      record "$id" "npm install @aivana/sdk@$VERSION on Node $nv (fresh project): imports, default + named export, default host" PASS "$res; installed: $deps"
    else
      record "$id" "npm install @aivana/sdk@$VERSION on Node $nv (fresh project): imports, default + named export, default host" FAIL "$(echo "$res" | cut -c1-240)"
    fi
  else
    record "$id" "npm install @aivana/sdk@$VERSION on Node $nv (fresh project)" FAIL "$(tail -c 300 "$WORK/out")"
  fi
  cd - >/dev/null
done

# --- the SDK has no runtime dependencies (README: 'no dependencies') ---------------------
ndeps="$(npm view "@aivana/sdk@$VERSION" dependencies --json 2>/dev/null | tr -d ' \n')"
if [ -z "$ndeps" ] || [ "$ndeps" = "{}" ]; then
  record INS-SDK-DEPS "@aivana/sdk@$VERSION has no runtime dependencies" PASS "npm view dependencies: none"
else
  record INS-SDK-DEPS "@aivana/sdk@$VERSION has no runtime dependencies" FAIL "$ndeps"
fi

# --- npm install -g @aivana/cli (README / Docs > Command Line, step 1), on Node 18 and current -
for major in 18 system; do
  NODE="$(node_bin "$major")"
  nv="$("$NODE" --version)"
  prefix="$WORK/global-$major"
  if PATH="$(dirname "$NODE"):$PATH" npm install -g -s --prefix "$prefix" "@aivana/cli@$VERSION" >"$WORK/out" 2>&1; then
    js="$prefix/lib/node_modules/@aivana/cli/bin/aivana.js"
    ver="$("$NODE" "$js" --version 2>&1)"
    onpath="$([ -x "$prefix/bin/aivana" ] && echo yes || echo no)"
    live="$(live_cli "$NODE" "$js")"
    if [ "$ver" = "aivana $VERSION" ] && [ "$onpath" = yes ] && [[ "$live" != exit\ [1-9]* ]]; then
      record "INS-CLI-G-$(echo "$nv" | cut -d. -f1 | tr -d v)" "npm install -g @aivana/cli puts a working \`aivana\` on PATH (Node $nv)" PASS "$ver; live: $live"
    else
      record "INS-CLI-G-$(echo "$nv" | cut -d. -f1 | tr -d v)" "npm install -g @aivana/cli puts a working \`aivana\` on PATH (Node $nv)" FAIL "version='$ver' on PATH=$onpath live: $live"
    fi
  else
    record "INS-CLI-G-$major" "npm install -g @aivana/cli (Node $nv)" FAIL "$(tail -c 300 "$WORK/out")"
  fi
done

# --- npx @aivana/cli "..." (README / Docs: try it without installing) ---------------------
ver="$(cd "$WORK" && npx -y "@aivana/cli@$VERSION" --version 2>&1 | tail -1)"
if [ -n "${AIVANA_API_KEY:-}" ]; then
  (cd "$WORK" && AIVANA_API_BASE="$LIVE_BASE" npx -y "@aivana/cli@$VERSION" "Reply with the single word: ok" --effort low --max-tokens 20 -q </dev/null >"$WORK/ans" 2>"$WORK/err")
  live="exit $? answer='$(tr -d '\n' <"$WORK/ans" | cut -c1-40)'"
else live="skipped (no key)"; fi
if [ "$ver" = "aivana $VERSION" ] && [[ "$live" != exit\ [1-9]* ]]; then
  record INS-NPX "npx @aivana/cli@$VERSION runs without installing" PASS "$ver; live: $live"
else
  record INS-NPX "npx @aivana/cli@$VERSION runs without installing" FAIL "version='$ver' live: $live"
fi
latest="$(cd "$WORK" && npx -y @aivana/cli --version 2>&1 | tail -1)"
if [ "$latest" = "aivana $VERSION" ]; then
  record INS-NPX-LATEST "The Docs' exact form \`npx @aivana/cli\` resolves to the latest release ($VERSION)" PASS "$latest"
else
  record INS-NPX-LATEST "The Docs' exact form \`npx @aivana/cli\` resolves to the latest release ($VERSION)" FAIL "got '$latest' (is $VERSION the latest on npm?)"
fi

{
  echo "# Aivana Node - clean install checks"
  echo
  echo "@aivana/sdk + @aivana/cli $VERSION | $(uname -s) $(uname -m) | npm $(npm --version) | live: $([ -n "${AIVANA_API_KEY:-}" ] && echo "$LIVE_BASE" || echo 'skipped (no key)') | $(date '+%Y-%m-%dT%H:%M:%S')"
  echo
  echo "Totals: PASS $pass, FAIL $fail"
  echo
  echo "| ID | Check | Result | Detail |"
  echo "|---|---|---|---|"
  printf '%s\n' "${rows[@]}"
} >"$OUT"
echo
echo "Install results: $(pwd)/$OUT"
