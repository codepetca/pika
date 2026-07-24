# Legacy Quiz Schema Retirement Plan

This plan retires Quiz as a distinct active domain. On July 23, 2026, the
maintainer explicitly classified existing Quiz rows and Quiz-format archive
payloads as disposable production experiments. Lossless backfill, production
parity, and Quiz restore compatibility are therefore not release gates.

This decision does not authorize applying a migration to any database. Every
target still requires one-time authorization naming the target and exact
migration filename under the schema rollout checklist.

## Current State

- The product surface, routes, API aliases, and UI wrappers use Tests.
- Migration `105_classroom_archive_v2_contract.sql` stages the versioned
  archive-v2 contract and generic retired-assessment envelope.
- Migration `106_freeze_and_backfill_legacy_quiz.sql` freezes and copies the
  legacy graph. It remains useful migration-history evidence, but the copied
  Quiz payload is no longer retained by the active contract.
- Migration `107_classroom_archive_v2_direct_source.sql` is the runtime cutover:
  it deletes Quiz drafts and copied Quiz envelopes, narrows drafts to Tests,
  promotes the live archive registry to v2, and snapshots source contract 2
  directly.
- Application export, restore, and compaction coordinators use v2 only. Missing
  migration 107 fails closed; there is no runtime fallback to the v1 RPCs.
- A v1 archive reader remains at the historical artifact boundary. Restoring a
  v1 artifact discards its Quiz resources and Quiz drafts while retaining its
  non-Quiz classroom resources.

Migration 105 is present in the shared local database because the local reset
already applied it. Migrations 106 and 107 have only been replayed in disposable
validation databases. No migration in this sequence has been applied to a
hosted target during this work.

## Production Evidence

The July 23 read-only inventory found one Quiz, three questions, sixty
responses, no manual-score rows, and one archive-v1 artifact containing the
same Quiz graph. This evidence now bounds expected deletion; it is not a parity
or preservation requirement.

Active Tests use separate `tests`, `test_questions`, `test_responses`, and
`test_attempts` tables. The destructive pass must prove those relations are not
drop targets and have no foreign-key dependency on the legacy Quiz graph.

## Runtime Cutover

Migration 107 and the corresponding application pass establish these
invariants:

1. New exports request source contract 2 and archive format 2.
2. Snapshot membership contains the exact v2 registry and no Quiz tables.
3. Source and archive resource counts are identical; there is no conversion.
4. Restore always stages the v2 graph.
5. V1 artifacts discard Quiz rows rather than restoring or adapting them.
6. Compaction validates and stages the v2 restore graph.
7. Missing v2 RPCs return migration-required failures instead of invoking v1.

The disposable database harness replays migrations through 106, applies 107,
proves Quiz drafts/envelopes were removed, captures a 40-resource source-v2
snapshot, rejects Quiz membership, and finalizes an archive-v2 operation.

## Next Pass: Hard Removal

Create migration `108_drop_legacy_quiz_schema.sql` and the coordinated
application cleanup:

- delete any remaining rows in dependency order;
- drop `quiz_responses`, `quiz_student_scores`, `quiz_questions`, and
  `quizzes`;
- remove Quiz policies, triggers, update functions, indexes, and grants;
- remove obsolete freeze/backfill helpers and the private backfill ledger when
  no later audit needs it;
- remove Quiz branches from assessment drafts, gradebook payload tombstones,
  package/site compatibility fields, domain unions, generated database types,
  and server helpers;
- retain Quiz strings only in immutable historical migrations and narrowly
  labeled v1 artifact tests, if those tests remain necessary;
- add a catalog assertion that no active public table, function, policy,
  trigger, generated type, API payload, or application import exposes the
  legacy domain.

Do not edit migrations 105 or 106. Migration 108 must be forward-only and
idempotent only where PostgreSQL object semantics make that explicit.

## Deployment And Rollback

Deploy the migration-107-aware application before applying migration 107.
Archive features fail closed until the migration is present. Apply migration
107 only in a quiet window because it takes archive-operation locks and rejects
an active export, restore, or compaction.

After migration 107, Quiz drafts and copied envelopes cannot be recovered from
the database. That loss is explicitly accepted. Application rollback to a
v1-only archive runtime is not supported after the registry promotion; use a
forward fix or restore the entire database from a pre-migration backup.

Migration 108 is independently authorized after its disposable replay and
catalog audit pass. Its rollback is also backup restoration or a forward schema
repair, not recreation of deleted Quiz data.

## Validation

For each pass:

- replay all migrations in a disposable database;
- run the archive export/restore/compaction coordinator suites;
- run TypeScript, lint, architecture checks, migration policy tests, and the
  full Vitest suite;
- run the Pika pre-commit audit;
- obtain an independent PR review and exact-head green CI;
- verify the migration was not applied to shared local or hosted targets unless
  the maintainer issued exact one-time authorization.
