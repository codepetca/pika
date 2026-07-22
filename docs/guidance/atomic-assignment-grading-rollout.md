# Atomic Assignment Grading Rollout

Migration `087_atomic_assignment_feedback_returns.sql` is the expand phase of a two-release rollout.
It creates the atomic grading and feedback-return RPCs without blocking the direct assignment-document
writes used by the previous application version.

## Expand Release

1. Apply migration 087 while the previous application version is still deployed.
2. Deploy the application version that routes assignment grading, AI grading, repo review, and feedback
   returns through the new RPCs.
3. Drain all previous application instances and verify the atomic assignment database harness and normal
   grading workflows.

Do not install a direct-write guard in this release. Doing so would make migration-first deployment break
the previous application, while application-first deployment would call RPCs that do not exist yet.

## Contract Release

After the expand application is deployed everywhere, create a separately numbered migration that rejects
direct mutations of assignment grading and feedback-return fields. Apply that migration in a later release.
Do not combine the expand and contract migrations into one production migration batch.

Rollback of the expand application leaves migration 087 in place because its RPCs and revision column are
additive. Rollback of the contract release requires restoring the expand application first; do not re-enable
legacy writers while contract-only application instances are active.

## Grading Provenance Extensions

Migrations `101_assignment_ai_grading_provenance.sql` and
`103_repo_review_grading_provenance.sql` are additive extensions of the migration-087 contract.
Apply both migrations before deploying application code that calls their provenance-aware wrappers.

Migration 103 keeps `complete_assignment_repo_review_run_atomic` intact for older application instances and
adds `complete_assignment_repo_review_run_with_provenance_atomic` for the new repository-review adapter. The
new wrapper stores each result's grading model and bounded provenance in the same transaction as the draft
grade and run completion. Deterministic local fallback uses `providerRequestCount: 0`; provider-backed grades
retain the actual request count and token usage.

Rolling back the application leaves migrations 101 and 103 in place. Older writers remain compatible and
clear stale assignment-document provenance when they replace AI grading fields without replacement audit
metadata. Do not deploy the new application before migration 103 because repository-review completion will
call the new wrapper.

## Teacher Review Evaluation Expansion

Migration `104_teacher_grading_reviews.sql` is additive and must be applied before deploying the
teacher-review eval application version. It captures a bounded, identity-free suggestion/outcome snapshot
through triggers on the existing atomic assignment writers and return RPC. Repository-review grades use the
same assignment-document contract. It does not change route payloads, teacher workflows, or remote Gradex
state. Require migration replay, generated type parity, and the assignment feedback-return database harness;
see `docs/guidance/teacher-grading-evals.md`.
