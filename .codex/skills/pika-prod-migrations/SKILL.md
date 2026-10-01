---
name: pika-prod-migrations
description: Preview, apply and verify Pika production database migrations through the manual GitHub workflow. Use for production migration requests; local migrations and application release promotion follow their own procedures.
---

# Pika Production Migrations

Use **Manual migration rollout** in `codepetca/pika` as the default production
migration path. It works through GitHub from school and uses environment-scoped
credentials with temporary database logins. Do not rely on chat memory or a
previous rollout's commit, digest, migration set or credentials.

Read the [authorization checklist](../../../docs/guidance/schema-rollout-checklist.md)
and [hosted migration runbook](../../../docs/guidance/hosted-migrations.md).
The runbook owns setup, credential scope, pinned tooling and failure details;
this skill does not change those controls or grant production access.

## Authorization and scope

- Preview and history checks do not authorize application. Apply only on a direct,
  one-time instruction in this task naming **production** and the exact migration
  numbers or filenames. Setup, a merge, "continue" and earlier task approvals do
  not count. Reuse sufficient authorization already given in this task.
- Review the SQL at the exact source SHA. Destructive or irreversible effects
  require the user's explicit acknowledgement; copying the workflow's impact
  acknowledgement field is not a substitute for that permission.
- Do not reset passwords, create or broaden credentials, change billing, repair
  history, seed, reset, roll back, delete data or activate feature flags as part
  of a migration request. Those actions require separate authorization.
- Schema application and application promotion are separate. SQL may come from
  reviewed, merged `main` before an explicitly authorized production release.

## Execute the existing workflow

1. Resolve the Pika checkout and select the full 40-character **merged source SHA**
   containing the candidate SQL. Read the live `migrations-production` environment
   bindings: `ROLLOUT_TARGET=production` and its `SUPABASE_PROJECT_REF`. Do not
   print or retrieve secrets. If setup is missing or invalid, report the blocker;
   do not substitute a database password or another application method without
   the owner's separate instruction.
2. Select successful repository CI evidence that actually ran database replay,
   tests and PR Gate for the candidate's complete `supabase/` tree and matches
   trusted current CI tooling. Reuse compatible evidence; docs-only, skipped,
   fork or unavailable historical evidence is insufficient. Let the rollout
   verifier check historical checkout logs rather than equating PR and squash SHAs.
3. Dispatch **preview** on workflow branch **main**, target **production**, with
   the exact source SHA and CI run ID; leave apply fields empty. Read its target,
   project, SQL links, hashes, ordered pending set and digest. Stop on drift.
   Preview-only requests may report the pending set without apply permission;
   before apply, require that the complete pending set matches the user's exact
   approval. Never hide files to force a subset. Keep other migration writers
   excluded during rollout.
4. Once SQL review and exact authorization are satisfied, dispatch **one new apply
   run** on **main** using the same source, target and CI evidence. Copy the preview's
   `approved_digest`, complete ordered `approved_migrations`, exact
   `APPLY production <full source SHA>` confirmation and `impact_ack` field. The
   workflow rechecks history and dry-run approval immediately before its single push.
   Honor an explicitly requested browser such as Chrome; otherwise use an available
   GitHub connector or CLI. Do not paste SQL into a console or use Supabase MCP to apply.
5. Require **applied-verified**, the expected applied versions and verified complete
   history. Run relevant **read-only** production contract checks: history alone
   does not prove the installed function, grants, constraints or data semantics.
   Keep checks within the approved rollout; do not write production test fixtures.
6. Report target, exact applied versions, workflow URL and verification outcome.
   Record the receipt and production state in repository continuity guidance per
   the normal worktree and PR process. Include no tokens, passwords or raw private
   CLI output in logs, screenshots, committed notes or public artifacts.

## Stop after a failed attempt

Never use **Re-run jobs** for apply or automatically retry after failure, timeout,
cancellation or partial application. Inspect durable history with read-only tools,
report the committed prefix or unknown state, then obtain a fresh preview and new
one-time permission before another apply attempt, even if nothing committed.
Do not weaken the workflow or switch execution paths to get around a failed guard.
