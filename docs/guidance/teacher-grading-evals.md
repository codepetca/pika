# Teacher Grading Evaluations

Pika records how a teacher resolves an AI grade so grading quality can be measured before any
standalone Gradex integration is enabled. Migration `104_teacher_grading_reviews.sql` adds one
bounded `ai_grading_review` snapshot to each `assignment_docs` and `test_responses` row.
Repository-review grades use the assignment-document path and therefore follow the same contract.

## Review Lifecycle

1. A provenance-aware AI grade initializes a `pending` snapshot with the suggested scores,
   current teacher-facing scores, feedback disposition, and versioned model provenance.
2. Existing manual grade writes update only the final scores and feedback disposition. The original
   suggestion remains unchanged even when the live AI suggestion fields are cleared.
3. Returning assignment or test work marks the snapshot `reviewed`. Clearing an AI-derived test
   grade marks it `dismissed`.
4. A later AI grade replaces the snapshot with a new pending review. Changed student work clears a
   stale snapshot so it cannot be paired with a different submission.

These transitions run inside the existing grading and return transactions. Review-only test updates
do not advance `test_responses.revision`.

## Privacy Contract

The strict `grading-review-v1` schema stores only:

- assessment kind and review state;
- criterion IDs, suggested scores, final scores, and maximum scores;
- `pending`, `unchanged`, `edited`, or `removed` feedback disposition, never feedback text;
- provider, model, policy, prompt, profile, rubric, request-count, and token-usage provenance; and
- the review timestamp.

It cannot represent names, emails, student or roster identifiers, assignment/test IDs, submission
content, raw feedback, document history, or patches. The database rejects unknown keys and payloads
larger than 8 KiB. The snapshot remains in Pika; migration 104 does not send it to Gradex or add it to
the current classroom Gradex extract.

## Offline Metrics

`src/lib/grading/evals.ts` summarizes finalized reviews with no model or API calls:

- criterion mean absolute error, within-one rate, and exact rate;
- total-score mean absolute error and within-three rate;
- accepted versus edited review rates;
- unchanged, edited, and removed feedback rates; and
- provider, model, and grading-profile counts.

Pending reviews are counted but excluded from quality metrics. Dismissed suggestions are counted but
have no score-error metric because they have no teacher-approved final score.

Run the synthetic accepted, edited, dismissed, and pending scenarios with:

```bash
pnpm eval:grading-reviews scripts/fixtures/grading-review-scenarios.json
```

The command accepts any identity-free JSON array that passes `gradingReviewSnapshotSchema`. It does
not connect to Pika, OpenAI, DeepSeek, or Gradex.

## Pilot Boundary

This phase measures whether current AI suggestions agree with teacher outcomes. It does not yet
rerun a candidate prompt or model because the review snapshot intentionally contains no assignment,
question, answer, submission, or feedback text.

The next eval phase should add an explicit, local-admin export that joins reviewed snapshots to the
minimum sanitized grading input, strips Pika identifiers, and writes a versioned private eval set.
Only that opt-in dataset should be used for paid provider comparisons. Synthetic fixtures validate
the machinery, not grading quality.

## Rollout Gate

Apply migration 104 before deploying this application version. Require a fresh migration replay,
generated database type check, `scripts/check-atomic-assignment-feedback-returns.sh`, and
`scripts/check-atomic-test-grading.sh`. Do not infer permission to apply the migration to local,
staging, or production databases.
