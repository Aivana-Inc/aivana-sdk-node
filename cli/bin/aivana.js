#!/usr/bin/env node
// The `aivana` command. It lives in @aivana/sdk (src/cli.js) so the command and the
// SDK it calls are versioned, tested and released together; this package gives it
// an installable name: `npm install -g @aivana/cli`, or `npx @aivana/cli "..."`.
import { run } from "@aivana/sdk/cli";

await run();
