# Comparing test grading batch sizes

The offline calibrator can compare independent calls with production-shaped batches
of two and four. It calls the existing grading adapters and never writes Pika grades.
Use privately exported, deidentified snapshots and separately adjudicated targets.
Recorded teacher marks remain a second opinion, not ground truth.

```bash
pnpm calibrate:test-grading /private/example.grading-snapshot.json \
  --all --max-points 10 --seed 1 \
  --batch-size 1,2,4 --order-seed 1,2 --profile bulk \
  --verified-targets /private/targets.grading-analysis.json \
  --pricing /private/pricing.grading-analysis.json \
  --out /private/comparison.grading-analysis.json --dry-run
```

Remove `--dry-run` for an authorized paid run. The dry run validates inputs and
reports target coverage and grading-operation counts without calls or file writes.
Snapshots and results must stay outside public Git history. Comparison output must
end in the gitignored `.grading-analysis.json` suffix and cannot overwrite an input
or point through a symlink. Output is checkpointed after each operation, with
`complete: false` until all scenarios finish; a failed answer causes a nonzero exit
while retaining partial results. Re-running starts a new paid comparison, not a resume.

`--seed` selects the stratified sample. `--order-seed` shuffles the same answers
within their exact question groups. Both accept unsigned 32-bit seeds; order seeds
and batch sizes accept comma-separated lists. The size order reverses on alternate
order seeds to counterbalance first/last execution. `--profile manual|bulk` applies
the same profile to every size; all use the production-default reasoning effort.
Do not mix comparison mode with legacy `--profiles` or `--effort` options. Without
comparison options, the existing single-call disagreement/effort tool is unchanged.

Groups include classroom, test title, question, maximum points, answer key, sample
solution and coding metadata. A singleton tail uses the single-answer adapter,
matching production. The ceiling comes from `PIKA_TEST_MAX_BATCH_RESPONSES`; no
20-response tool limit remains. References are prepared once per exact question
and reused across scenarios, with preparation cost recorded separately.

## Private targets

A target file has `schemaVersion: 1`, a nonempty `source` description, and a
`targets` array of `{ answerId, minimum, maximum }`. The interval is inclusive.
Use `answerId` exported by `scripts/lib/test-grading-comparison.ts` on the snapshot
response plus its `classroom` (snapshot basename without `-test.grading-snapshot.json`
or `.grading-snapshot.json`). The ID hashes the exact question/rubric/coding context,
student pseudonym and answer text; changing either work or rubric invalidates it.
Targets must uniquely match the loaded population and fit the question's point
range. Duplicate, stale and unmatched targets fail before paid requests.

Only adjudicated intervals count toward quality: each summary reports verified
coverage, the number inside the interval and mean distance outside it. Raw deltas
from recorded marks are retained only for disagreement triage. No real target,
student text or private snapshot belongs in this repository.

## Measurement and interpretation

Pricing is optional; without it, cost is unknown. Supply a private JSON object with
`model`, `asOf` (YYYY-MM-DD), `source`, and `cachedInput`, `uncachedInput`, `output`
(USD per million tokens). Verify rates against the provider's current documentation,
including time-of-day pricing, before choosing fixed reference rates. Results are
estimates at those rates, not account billing records. A different requested model
or missing/inconsistent cache counters makes cost unknown.

A script-scoped fetch observer records allowlisted metadata and usage for every
DeepSeek HTTP attempt, including truncated attempts, and restores fetch afterward.
It retains no request headers, raw prompts, provider bodies or raw error messages.
Failures still contribute any observed spend; unmeasured attempts remain unknown.
`knownCostUsd` is only the measured subtotal when `costUsd` is null. Output tokens
already include reasoning; reasoning tokens are reported separately, never billed
again. Shared batch usage is recorded once per operation, not once per answer.

Each answer links to its operation and records the entire call latency and an equal
share of measured call cost. Summary throughput uses total operation time divided
by attempted answers; mean/p95 answer latency uses full call duration. These are
different measures. Shared preparation is excluded from grading summaries and is
available in `preparation` for cold-start analysis.

Every sampled answer remains in every scenario even after a failure. Compare only
complete pairs when evaluating score changes, and inspect the reported coverage and
failure counts. The order-sensitivity summary measures score ranges across seeds;
it cannot separate order effects from provider nondeterminism. Cache state, sequential
execution and a small adjudicated set also limit conclusions. This experiment does
not automatically choose a production strategy.
