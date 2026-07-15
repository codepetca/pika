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
