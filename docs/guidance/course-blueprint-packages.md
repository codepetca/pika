# Course Blueprint Packages

This is the teacher-facing contract for portable course files.

## Naming Decision

- **Course Blueprint** is the reusable plan teachers edit in Pika.
- **Course Package** is the portable exported file teachers can move between Pika, a repo, Codex, Claude, or another editing workflow.
- The official exported file extension is `.course-package.tar`.

## Package Format

A course package is a tar archive with these root files:

- `manifest.json`
- `course-overview.md`
- `course-outline.md`
- `resources.md`
- `assignments.md`
- `tests.md`
- `lesson-plans.md`

`manifest.json` stores package metadata and planned-site publishing settings. The Markdown files store the editable teacher-authored course content.

The current manifest version is `3`. The version identifies the portable content contract; it is independent of the database migration number.

## Included

- Course title, subject, grade level, course code, and term template
- Planned course site slug, published flag, and section visibility
- Course overview, outline, and resources
- Assignment plans, default due offsets, default due times, points, gradebook weights, final-grade inclusion, and draft state
- Test definitions, point scales, gradebook weights, and final-grade inclusion represented in Markdown
- Test document metadata/content when represented by the test Markdown format
- Lesson plan templates

## Excluded

Course packages are reusable planning files, not classroom backups. They exclude students, submissions, grades, attendance, rosters, join codes, class days, classroom calendar overrides, live announcements, actual course website settings, and runtime storage objects.

## Round Trip

1. Export a course blueprint from Pika as `.course-package.tar`.
2. Extract the archive.
3. Edit the Markdown files in a repo, Codex, or Claude. Keep the filenames and `manifest.json` at the archive root.
4. Repack the root files into a tar archive.
5. Import the course package in Pika.
6. Review the resulting Course Blueprint before using it to create a classroom or publishing its planned course site.

Do not use this package for automatic `actual -> blueprint` sync. Classroom changes should be reviewed and explicitly saved back into a Course Blueprint.

## Atomic Operation Contract

Package import, classroom-to-blueprint capture, and blueprint-to-classroom instantiation each use one database RPC and one transaction for their domain writes. A failed operation must leave no partial blueprint or classroom graph. The transaction writes an operation ledger record outside the domain-write subtransaction so failure evidence survives the rollback.

The invariants are:

- A caller may send a UUID `Idempotency-Key`. Repeating a completed request with the same key returns the original result and creates no duplicate rows.
- Generated class codes and default themes are derived deterministically from the operation ID so retries rebuild the same write plan.
- Reusing a key for a different semantic request returns `idempotency_conflict`.
- Blueprint and classroom source reads use revision checks before and after loading child rows. The RPC locks and rechecks the same revision before writing.
- Assignments and tests created from a blueprint are unpublished drafts.
- Student, submission, grade, attendance, roster, and runtime storage data never enter the write plan or operation ledger.
- RPC responses are validated at the application boundary. A missing RPC returns `atomic_blueprint_migration_required`; an invalid response returns `blueprint_rpc_contract_invalid`.

Successful and failed API responses include `operation_id` when a ledger-backed operation ran. Atomic failures also include a stable `error_code` and `retryable` flag.

## Rollout And Recovery

Apply `081_atomic_blueprint_round_trips.sql` before deploying application code that calls the new RPCs. The application deliberately fails closed with HTTP `503` when the migration is absent; it does not fall back to the former table-by-table writes.

The migration is additive, so the previous application version can run while it is being applied. If the application deployment must be rolled back, leave the migration and ledger in place. Do not drop the functions, triggers, revision columns, or ledger until all deployed application versions no longer reference them.

For an operation failure:

1. Use the API's `operation_id` to locate the service-role-only `course_blueprint_operations` row.
2. Inspect `status`, `attempt_count`, `error_code`, `error_sqlstate`, and `resource_counts`; the ledger intentionally stores identifiers and counts, not package payloads or student data.
3. For a retryable source-revision conflict, reload the source and submit a new operation key. For a transient server failure with an unchanged request, retrying the same key is allowed.
4. Confirm that no result graph exists for failed operations before manual intervention. Never repair a failed operation by deleting guessed child rows.

Operation rows are retained indefinitely in this first slice. Any future purge policy must preserve the idempotency window and incident-audit requirements and must be shipped as a separate reviewed lifecycle change.

## Verification

CI starts an ephemeral Supabase database, replays every migration, and runs:

```bash
bash scripts/check-atomic-blueprint-operations.sh
```

The contract check injects child-write failures, verifies complete domain rollback with retained failure evidence, rejects stale classroom captures, and verifies successful idempotent replay for both blueprint creation and classroom instantiation.

Application logs emit one structured `[blueprint-operation]` event with operation type, status, duration, replay state, resource counts, and stable error code. They do not emit package content or student data.

## Classroom Rollover

When a teacher saves an existing classroom as a blueprint, assignment due dates are converted into offsets from the source classroom start date using `America/Toronto`. Creating a classroom from that blueprint applies those offsets to the new classroom start date.

Blueprint-created assignments and tests are always created unpublished. The teacher must review due dates, lesson-plan calendar mapping, and assessment settings before releasing classwork to students. A blueprint never copies students, submissions, grades, attendance, or announcements into the new classroom.
