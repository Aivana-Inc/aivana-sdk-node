# Aivana Node - clean install checks

@aivana/sdk + @aivana/cli 0.7.1 | Darwin arm64 | npm 11.8.0 | live: https://dev-developers.aivana.ai | 2026-10-20T18:09:42

Totals: PASS 9, FAIL 0

| ID | Check | Result | Detail |
|---|---|---|---|
| INS-NPM-18 | npm install @aivana/sdk@0.7.1 on Node v18.20.8 (fresh project): imports, default + named export, default host | PASS | 0.7.1 true https://api.aivana.ai live: ok answer="ok"; installed: @aivana/sdk |
| INS-NPM-20 | npm install @aivana/sdk@0.7.1 on Node v20.20.2 (fresh project): imports, default + named export, default host | PASS | 0.7.1 true https://api.aivana.ai live: ok answer="ok"; installed: @aivana/sdk |
| INS-NPM-22 | npm install @aivana/sdk@0.7.1 on Node v22.23.3 (fresh project): imports, default + named export, default host | PASS | 0.7.1 true https://api.aivana.ai live: ok answer="ok"; installed: @aivana/sdk |
| INS-NPM-25 | npm install @aivana/sdk@0.7.1 on Node v25.1.0 (fresh project): imports, default + named export, default host | PASS | 0.7.1 true https://api.aivana.ai live: ok answer="ok"; installed: @aivana/sdk |
| INS-SDK-DEPS | @aivana/sdk@0.7.1 has no runtime dependencies | PASS | npm view dependencies: none |
| INS-CLI-G-18 | npm install -g @aivana/cli puts a working `aivana` on PATH (Node v18.20.8) | PASS | aivana 0.7.1; live: exit 0 answer='ok' |
| INS-CLI-G-25 | npm install -g @aivana/cli puts a working `aivana` on PATH (Node v25.1.0) | PASS | aivana 0.7.1; live: exit 0 answer='ok' |
| INS-NPX | npx @aivana/cli@0.7.1 runs without installing | PASS | aivana 0.7.1; live: exit 0 answer='ok' |
| INS-NPX-LATEST | The Docs' exact form `npx @aivana/cli` resolves to the latest release (0.7.1) | PASS | aivana 0.7.1 |
