# Atomic Test Grading Rollout

Migrations `089` through `095` are the expand phase of a two-release rollout. They are split so
column DDL, trigger installation, backfill, constraint validation, and RPC replacement commit
separately instead of holding strong table locks for the entire rollout. The application
version in the same pull request requires the response revision column and atomic grading RPCs, so the
database migration must be applied first.

## Expand Release

1. Pause new background test auto-grading runs for the deployment window.
2. Drain every in-flight previous-version AI grading request before applying migration 091. Confirm no old worker can
   resume a model request after the migration marks active runs failed.
3. Apply migrations 089 through 095 while the previous application version is still deployed. The migrations fail all
   already-active test AI runs closed because their pre-migration response ordering cannot be reconstructed.
4. Deploy the application version that routes manual test grading, grade clearing, AI item state, and AI
   finalization through the new RPCs.
5. Drain all previous application instances before allowing new background test auto-grading runs.
6. Verify the atomic test-grading database harness and classroom archive restore harness in the release
   commit before resuming normal grading.

Do not deploy the application before migrations 089 through 095. Results reads require `test_responses.revision`, and
grading writes deliberately fail closed when the new RPCs are unavailable. Leave migrations 089 through 095 in place if
the application is rolled back.

## Contract Release

After the expand application is deployed everywhere, create a separately numbered migration that rejects
legacy direct mutations of test grade fields and AI run-item state. Apply that migration in a later release;
combining the expand and contract migrations would break old application instances during a migration-first
deployment.

Before applying the contract release, verify that every live instance uses the atomic AI run-creation RPC from
this expand release so no old instance can create a partially initialized run after direct writes are disabled.

## Versioned Provenance Expansion

Migration `102` is a later rolling-safe expansion. Apply it before deploying the
application version that calls the provenance-aware wrappers. It:

- adds a bounded `test_responses.ai_grading_provenance` contract;
- leaves every migration `094` RPC signature available to older instances;
- adds service-role-only manual and durable wrappers that commit the grade and
  provenance in one transaction without advancing the response revision twice;
- clears provenance when an older writer replaces or clears AI metadata; and
- preserves provenance when a teacher edits the final score or feedback while
  the original AI suggestion metadata remains intact.

Migration `102` does not enable remote Gradex processing and does not change the
teacher grading workflow.

Before deployment, require the CI architecture/database-contract job to replay
migrations `001` through `102`, confirm generated database types have no drift,
and pass `scripts/check-atomic-test-grading.sh`. A TypeScript-only or mocked RPC
test is not sufficient evidence for this migration.
