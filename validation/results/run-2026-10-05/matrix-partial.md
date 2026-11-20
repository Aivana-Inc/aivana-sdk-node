# Aivana Node SDK - validation matrix

@aivana/sdk 0.7.0 | Node 25.1.0 | darwin | live base https://dev-developers.aivana.ai | key set: yes | 2026-10-05T21:08:09

Totals: DEFECT (known) 1, FAIL 1, PASS 1

| ID | Area | Check | Mode | Result | Finding | Detail |
|---|---|---|---|---|---|---|
| NODE-LIV-30 | Streaming | Stream completes: deltas join into the answer; done carries usage/notices | live | PASS |  |  |
| NODE-LIV-37 | Streaming | A long answer streams incrementally (first text well before the end) | live | FAIL |  | AssertionError: first text at 6887 ms of 8013 ms |
| NODE-LIV-36 | Streaming | An AbortSignal stops a live stream mid-answer | live | DEFECT (known) | N1 | AssertionError: after abort: ended normally |
