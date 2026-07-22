# Atomic Assignment Submission Rollout

Migration `099_assignment_submission_integrity_guards.sql` is a migration-first compatibility release.
The application in the same pull request requires the new save, submit, unsubmit, and combined teacher
update RPCs, so migration 099 must be applied and verified before the application is deployed.

## Deployment Order

1. Keep the previous application version deployed and apply migration 099.
2. Verify the migration is recorded and that the atomic assignment and concurrency database harnesses
   pass against an ephemeral replay of migrations 001 through 099.
3. Verify the service role can execute the four new RPCs while `anon` and `authenticated` cannot.
4. Deploy the application version that routes assignment saves, submissions, unsubmit, and combined
   assignment-and-requirement updates through those RPCs.
5. Drain every previous-version application instance before treating the new RPC contracts as the only
   supported assignment writers.
6. Run a controlled non-production save, submit, unsubmit, requirement edit, and history restore canary.

Do not deploy the application before migration 099. New application writes deliberately fail closed when
the RPCs are unavailable. Leave migration 099 in place if the application is rolled back.

## Previous-Version Compatibility

During the migration-first overlap:

- the new assignment document columns are nullable, so previous-version reads and direct draft saves remain valid;
- the new server accepts the previous bundle's strict four-field PATCH shape and adapts it to a revision-guarded
  atomic save until old browser tabs have drained; remove this adapter in a later compatibility PR;
- previous-version direct submission does not acquire the assignment advisory lock after locking the document,
  preventing lock-order inversion with the new combined teacher RPC;
- requirement mutations serialize with assignment documents and reject changes after a submission wins;
- previous-version archive restores are accepted because the database normalizer adds the missing nullable
  `save_session_id` and `save_sequence` fields before exact-column validation;
- the application keeps restore target `083` and adapter identity `classroom-archive-v1-082-to-083`, so operation
  retries retain the same request hash across deployment while database normalization adapts current columns;
- a durable save-operation ledger de-duplicates retries even after another browser tab becomes the latest writer;
- save-operation evidence stores a SHA-256 content digest, the saved revision, and compact cumulative input
  counters keyed by a metric session; a later attempt subtracts the greatest committed counter checkpoint, so a
  missing intermediate response cannot duplicate authenticity metrics;
- save-operation evidence has no classroom ownership foreign key and is removed after 35 days, five days after
  browser recovery drafts expire; this keeps migration-first archive manifests at their existing 42-resource
  contract while preserving short-lived retries across compaction;
- a deferred database trigger creates a counted authoritative submit snapshot when a legacy direct submit does
  not already contain one; verified archive restores preserve their archived history rows and counts exactly;
- pre-099 history cleanup remains compatible because authoritative submit rows are silently skipped instead of
  making the old bulk cleanup transaction fail;
- image uploads create delayed cleanup evidence before Storage is written; committed artifact rows adopt that
  evidence, while interrupted uploads and deleted or replaced paths remain in a leased queue until Storage
  deletion and durable completion are both acknowledged.

The previous teacher route commits assignment metadata separately from requirement replacement. If a student
submission wins that narrow race, the requirement mutation is rejected while independently valid metadata may
already be saved. This is the previous route's existing transaction boundary, not a loss of submission data;
the new application removes it by using the combined atomic teacher RPC.

## Production Boundaries

Migration application remains human-controlled under `docs/guidance/schema-rollout-checklist.md`. This rollout
does not authorize production data cleanup, archive compaction, Storage deletion, migration repair, or rollback.
Those operations require separate explicit approval.

## Local Visual Verification

The assignment surfaces were verified with Playwright against local seeded data on desktop and mobile in light
and dark themes. Coverage included the student editor save-status signal, history preview, restore confirmation
dialog, and teacher assignment-list regression views. Because migration 099 was intentionally not applied to the
shared local database, the editor's PATCH response was fulfilled by a browser-only route mock after the real
read completed. No assignment database write was sent during the final captures, and the final browser sessions
reported no console errors.
