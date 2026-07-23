# Legacy Quiz Schema Retirement Plan

This plan retires Quiz as a distinct active domain without deleting historical
classroom data or making retired assessments appear as active Tests.

No migration is created or applied by this plan. Each future migration requires
the one-time target-and-filename authorization in the schema rollout checklist.

## Production Evidence

The target-pinned read-only inventory ran on July 23, 2026 against Pika project
`zhioqbapgfcrronyuidm`. Two consecutive aggregate snapshots matched:

| Contract | Live rows | Verified archive-v1 rows |
|---|---:|---:|
| `quizzes` | 1 | 1 |
| `quiz_questions` | 3 | 3 |
| `quiz_responses` | 60 | 60 |
| `quiz_student_scores` | 0 | 0 |
| Quiz `assessment_drafts` | 0 | not represented separately in manifest counts |
| Quiz `course_blueprint_assessments` | 0 | not applicable |

There is one retained `pika.classroom-archive@1` archive. Its verified resource
counts contain the same non-empty Quiz graph. The July 15 production canary
restored that archive successfully, so archive-v1 is proven against real Quiz
rows but not a non-empty manual-score row.

Re-run the aggregate evidence without emitting row data:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_SECRET_KEY="<service-role-or-secret-key>" \
pnpm verify:legacy-quiz-inventory -- \
  --expected-project-ref <project-ref> \
  --json
```

The runner validates the exact hosted origin, rejects redirects and off-origin
requests through the shared target-bound fetch, reads counts plus archive UUID
and artifact SHA-256 into a private snapshot, and requires two matching
snapshots. It emits aggregates only. Do not commit or print the secret key.

## Migration Decision

Do not backfill legacy Quiz rows into active `tests`, `test_questions`,
`test_responses`, or `test_attempts`.

That mapping is unsafe:

- migrated rows would need a new hidden state to avoid resurfacing removed
  product data through current Test routes;
- Quiz scoring scaled correct-answer counts to the container's
  `points_possible`, while Tests persist per-question points and scores;
- `quiz_student_scores.manual_override_score` is a whole-assessment override
  with no lossless current Test-row equivalent;
- Quiz scheduled-open and response semantics do not map exactly to the current
  Test lifecycle.

Instead, preserve retired rows in a generic, non-product envelope:

- `classroom_retired_assessment_records` stores the classroom id, source
  contract/version, source resource name and row id, parent source identity,
  the complete JSON payload, checksum algorithm/version, payload SHA-256, and
  original timestamps;
- `classroom_retired_assessment_record_actors` stores normalized actor
  references for archive actor discovery and restore reconciliation;
- deterministic hash-derived record ids make backfill and archive replay
  idempotent without assuming UUIDs are unique across the four source tables;
- no active API, gradebook query, Test component, or package producer reads
  these tables.

Literal Quiz names remain only as historical source-contract values and in the
archive-v1 adapter. They are data provenance, not an active domain.

## Archive Contract

Introduce `pika.classroom-archive` format version 2 before removing any table.

Archive v2:

- includes the two generic retired-assessment envelope resources;
- no longer emits the four Quiz relational resources;
- preserves all other classroom resources and storage objects;
- records the adapter and checksum algorithm versions in restore evidence.

The restore chain must remain version-aware:

1. Verify archive-v1 bytes, manifest, actors, and all four Quiz resources using
   the unchanged v1 reader.
2. Convert every Quiz row and Quiz draft into deterministic retired-assessment
   records plus normalized actor references.
3. Remove converted Quiz rows from the active restore graph.
4. Restore the generic envelope resources under the current schema.
5. Verify source counts, source-row ids, per-resource aggregate checksums,
   actor references, and envelope counts before finalization.

Existing archives stay immutable. Do not rewrite v1 objects in place. The v1
reader remains supported after v2 becomes the only export format.

The format transition must be versioned in code and the database:

- replace the single `CLASSROOM_ARCHIVE_VERSION` decoder path with an explicit
  `CLASSROOM_ARCHIVE_CONTRACTS` registry keyed by version; preserve the current
  manifest schema and exact 42-resource graph as immutable v1 definitions, add
  separate v2 manifest/resource definitions, read the minimal format/version
  header first, reject unknown versions, then dispatch verification and restore;
- export dispatch always writes the explicitly requested current contract and
  never obtains a resource set from a global latest-version constant;
- replace the database's global `classroom_archive_resource_contract` lookup
  with a version-keyed contract whose primary key is
  `(format_version, table_name)`, backfill all current rows as version 1, and
  seed a separate v2 graph containing the retired-assessment envelope resources;
- add source and restore contract versions to archive operations and snapshot
  resources, use composite foreign keys, and make begin/read/finalize/restore
  RPCs select and validate the operation's declared contract rather than every
  row in the registry;
- replace `classroom_archives.format_version = 1` with an allowlist for 1 and 2
  in the same additive migration. Existing metadata remains version 1, new
  exports become version 2 only after the v2 application is deployed, and a v1
  restore records source version 1 while staging the adapted v2 graph.

The deployed-code contract test must round-trip an immutable non-empty v1
artifact containing all four Quiz resources, a manual override, and a Quiz
draft through v1 verification and the v1-to-v2 adapter, then export and restore
the resulting v2 envelope graph. It must also prove v1 bytes and manifest
checksums are unchanged and both decoders reject the other version's graph.

## Implementation Passes

### Pass A: Additive Envelope And Adapter

- Create the two generic retired-assessment tables, constraints, RLS policy,
  indexes, and archive privacy classifications.
- Add the version-keyed TypeScript and database contract registries, operation
  version columns, archive metadata allowlist, explicit v1/v2 dispatch, v2
  export support, and v1-to-current restore adapter described above.
- Keep all four Quiz tables and their archive-v1 contract entries.
- Add a synthetic v1 fixture with non-empty quiz, question, response, manual
  score override, and Quiz draft rows.
- Prove v1 verification, adapter idempotency, v2 export, and v2 restore.

Rollout is additive. The previous application can continue using the unchanged
tables. Application rollback leaves the new envelope tables unused.

### Pass B: Freeze And Backfill

- Reject new writes to the four Quiz tables and Quiz drafts before taking the
  source snapshot. Active Pika has no legitimate producers.
- In the same transaction, take an access-exclusive lock on
  `course_blueprint_assessments`, fail if any Quiz row exists, and replace its
  `assessment_type` check with a Test-only constraint before releasing the
  lock. This production-zero contract is narrowed rather than copied into a
  classroom-scoped envelope.
- Backfill source rows and Quiz drafts into deterministic envelope records in
  one transaction.
- Record a migration ledger with per-resource source/envelope counts and
  ordered aggregate checksums.
- Fail the migration on UUID collisions, missing parents, unresolved actors,
  count/checksum mismatch, a nonzero Quiz blueprint row, or concurrent source
  drift.
- Leave the source tables intact for a compatibility observation window.

This pass does not dual-write because there is no active Quiz writer. If the
preflight finds an unknown writer or changing counts, stop and investigate
rather than adding a new compatibility producer.

### Pass C: Production Proof

- Re-run `verify:legacy-quiz-inventory` and compare it with the backfill ledger.
- Run the database catalog audit and generated-type check.
- Create and restore a non-empty archive-v2 canary only under separate,
  target-specific production authorization.
- Prove that the retained production archive-v1 still adapts and restores.
- Confirm current Tests, gradebook, course packages, and old-link tombstones do
  not read the source tables or envelope tables.
- Prove a Quiz blueprint insert cannot race the zero-row preflight or succeed
  after the Test-only constraint is installed.

### Pass D: Destructive Retirement

Only after Pass C:

- make v2 the only current export contract while retaining both immutable
  versioned registry graphs and the v1 adapter indefinitely; never replace or
  delete v1 registry rows referenced by historical operations or snapshots;
- drop `quiz_responses`, `quiz_student_scores`, `quiz_questions`, then
  `quizzes`, plus their policies, indexes, triggers, and update functions;
- remove the Quiz branch from `assessment_drafts` after archived Quiz drafts
  are handled by the v1 adapter and live rows are zero;
- retain the already-narrowed Test-only blueprint constraint and remove
  database-shaped Quiz blueprint compatibility types after old package readers
  have normalized their input;
- regenerate database types and remove database-shaped application contracts;
- retain historical migration files and the archive-v1 adapter.

After the drop, the deployed-code fixture must restore the retained non-empty v1
archive while v2 is current and assert that both registry graphs remain present.

The drop is not rollback-safe. Recovery is a forward repair migration that
recreates the old schema and rehydrates it from the envelope ledger if required.
Do not use a down migration or mutate retained archive objects.

### Pass E: Independent Compatibility Windows

After schema retirement:

- gradebook: remove `quizzes_weight`, Quiz percentages, arrays, and response
  tombstones in a separately reviewed payload/schema migration;
- course packages: introduce version 4 without the `quizzes` site-config key,
  while version 2/3 readers continue normalizing the old key to `false`;
- TypeScript: narrow persisted assessment types to Test once no live or restore
  path emits `assessment_type='quiz'`;
- URL: keep `tab=quizzes&quizId=...` as an inert old-link tombstone until a
  separate removal decision.

These windows are not prerequisites for dropping the four source tables, but
they are prerequisites for eliminating all non-historical Quiz names.

## Validation And Rollback Gates

Before every migration PR answer:

```text
What widened?
What fallback exists?
What breaks before the migration?
What proves source/envelope parity?
Which archive versions can still restore?
Which Quiz references remain and why?
```

Required evidence:

- migration replay and generated database types;
- non-empty v1 fixture covering all four Quiz resources and a Quiz draft;
- deterministic adapter replay;
- archive-v1 and archive-v2 restore equality at their declared boundaries;
- production target identity and two stable aggregate snapshots;
- zero unexplained active Quiz table readers or writers;
- exact migration filename and target approval before any application.
