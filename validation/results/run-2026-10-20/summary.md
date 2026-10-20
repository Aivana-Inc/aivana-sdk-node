# Run - 2026-10-20 (macOS, Node 25.1.0, @aivana/sdk + @aivana/cli 0.7.1, dev-developers.aivana.ai)
Matrix totals: PASS 106, DEFECT (known) 18, FIXED? (re-check) 2, FAIL 0 (126 cases)
Install checks (install_check.sh): 9/9 PASS - npm on Node 18/20/22/25, no runtime deps, npm -g on 18 + 25, npx.
New this run: tests/cli.mjs (36 offline + 8 live), tests/docs_snippets.mjs (36 examples, 12 pages), NODE-LIV-23.
- F4 server half fixed: production 401 includes requestId (req_1c2186ac4b8a3c8a3775cb39).
- F11 passed this run (40 tokens for maxTokens 40, req_431843da181b77198577491a); intermittent - Python got 57 same day.
- F2 reframed (by design per Docs > API Keys; misleading message). NODE-LIV-03, NODE-CLI-L08.
- F13 reproduced (output_tokens 0, req_3ad7b2fa070404471bbafa96). F16 reproduced (low -> Premium, req_69883241cb6dde0b324b81bc).
- F15 still: first text at 82% of a 6.8 s request (NODE-LIV-37). N1 reproduced live: abort ignored, 11 more chunks (NODE-LIV-36).
- F12 now seen on Node: extract returned {"response": ...} (req_8fb5f848a95e37c985e55838).
- P1, N2, N3, F10 (topP undocumented) still hold.
Note: a second, overlapping run was started by mistake and stopped before it wrote results; this matrix is the first
run's (22:15:39). Python-only F17 (CLI traceback) does not apply: the Node CLI prints the response as received.
