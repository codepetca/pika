# Course Blueprint Packages

This is the teacher-facing contract for portable course files.

## Naming Decision

- **Course Blueprint** is the reusable plan teachers edit in Pika.
- **Blueprint Draft** is its one editable state.
- **Blueprint Version** is an immutable snapshot used to create and compare classrooms.
- **Artifact ID** is the stable UUID of a reusable assignment, Test, question,
  document, submission requirement, or lesson across packages, versions, and
  classrooms.
- **Course Package** is the portable exported file teachers can move between Pika, a repo, Codex, Claude, or another editing workflow.
- The official exported file extension is `.course-package.tar`.

Identity, versioning, classroom provenance, and proposal behavior are defined
in [`course-blueprint-identity-versioning.md`](./course-blueprint-identity-versioning.md).

## Package Format

A course package is a tar archive with these root files:

- `manifest.json`
- `course-overview.md`
- `course-outline.md`
- `resources.md`
- `assignments.md`
- `tests.md`
- `lesson-plans.md`
- `classwork-materials.md`
- `surveys.md`

`manifest.json` stores package metadata, gradebook category defaults, and
planned-site publishing settings. The Markdown files store the editable
teacher-authored course content.

The canonical export manifest version is `5`. Pika imports versions `2`, `3`,
`4`, and `5`, and rejects other versions. Version `2` is an import-only compatibility
boundary: Pika imports its reusable course, assignment, Test, and lesson-plan
content while discarding `quizzes.md`. Version `3` package manifests are
normalized to the current planned-site configuration; unknown retired
configuration keys are ignored. Versions `4` and `5` reject unknown manifest
fields and undeclared files. Version `5` adds the Blueprint ID, source Draft
revision, optional immutable Version provenance, and UUIDv4 Artifact IDs.
Missing, malformed, or duplicate Artifact IDs fail version `5` validation;
legacy versions receive IDs once during import. The package format version is
independent of both the database migration number and the Blueprint's own
Version number.

### Supported-Version Contract

Historical formats are import-only. Every raw package is first checked against
its exact version contract; only verified packages enter a version adapter.
Adapters discard retired content and add current-domain defaults before Markdown
is parsed into one canonical portable course model.

| Version | Required Markdown files | Additional allowed files | Manifest behavior |
| --- | --- | --- | --- |
| `2` | `course-overview.md`, `course-outline.md`, `resources.md`, `assignments.md`, `tests.md`, `lesson-plans.md` | Optional `quizzes.md`, which is discarded | Strict v2 manifest and planned-site values |
| `3` | The same six reusable files | None | Strict manifest; validated retired boolean planned-site keys are preserved as raw evidence and discarded by the adapter |
| `4` | The same six reusable files | None | Strict manifest and current planned-site keys |
| `5` | The six reusable files plus `classwork-materials.md` and `surveys.md` | None | Strict identity-aware manifest, grading, and provenance |

Raw schemas never create missing files or supply defaults. Direct JSON and TAR
packages feed the same verifier. Raw JSON is decoded as fatal UTF-8 and parsed
without duplicate-key normalization. The verifier retains immutable copies of
the original JSON text or TAR manifest text, manifest, file map, entry names,
source kind, and received byte length as raw evidence. The branded verified
value and its nested evidence cannot be changed before adaptation. TAR transport
checks also require block alignment, two complete zero terminator blocks, zero
entry padding, valid headers and UTF-8, unique entries, and size limits before
adaptation. The 2 MiB per-entry limit applies to `manifest.json` in both forms.

Immutable JSON and binary TAR fixtures for every supported version live in
`tests/fixtures/course-blueprint-package-v*.{json,tar}`. Their SHA-256 digests
and an independent, production-encoder-free mutation matrix are locked by:

```bash
pnpm test tests/lib/course-blueprint-package-contract.test.ts
```

## Included

- Course title, subject, grade level, course code, and term template
- Planned course site slug, published flag, and section visibility
- Course overview, outline, and resources
- Assignment plans, default due offsets, default due times, authenticity
  tracking, points, gradebook weights, final-grade inclusion, and draft state
- Test definitions, point scales, gradebook weights, and final-grade inclusion represented in Markdown
- Test document metadata/content when represented by the test Markdown format; classroom-specific link snapshot paths and sync timestamps are removed
- Lesson plan templates
- Ungraded classwork materials
- Survey definitions and questions
- Gradebook mode and assignment/test category weights

## Excluded

Course packages are reusable planning files, not classroom backups. They exclude students, submissions, grades, attendance, rosters, join codes, class days, classroom calendar overrides, live announcements, actual course website settings, and runtime storage objects.

Imported, captured, and instantiated link documents retain their reusable source URL and metadata but do not retain a classroom snapshot reference. A teacher must sync the link document in the new classroom to create a snapshot owned by that classroom.

## Round Trip

1. Export a course blueprint from Pika as `.course-package.tar`.
2. Extract the archive.
3. Edit the Markdown files in a repo, Codex, or Claude. Keep the filenames and `manifest.json` at the archive root.
4. Repack the root files into a tar archive.
5. Push the package to Pika as a Change Proposal against the exported Draft
   revision.
6. Review the diff in Pika and explicitly apply it. A stale proposal never
   writes to the Draft.

Importing a package without an existing Blueprint lineage may create a new
Blueprint. Pushing a package for an existing Blueprint never deletes and
recreates it.

## Atomic Operation Contract

Package import, classroom-to-blueprint capture, and blueprint-to-classroom instantiation each use one database RPC and one transaction for their domain writes. A failed operation must leave no partial blueprint or classroom graph. The transaction writes an operation ledger record outside the domain-write subtransaction so failure evidence survives the rollback.

The invariants are:

- A caller may send a UUID `Idempotency-Key`. Repeating a completed request with the same key returns the original result and creates no duplicate rows.
- Browser import surfaces retain one caller key while normalized JSON or exact archive bytes are retried, replace it when the package changes, and suppress concurrent import submissions.
- Generated class codes and default themes are derived deterministically from the operation ID so retries rebuild the same write plan.
- Reusing a key for a different semantic request returns `idempotency_conflict`.
- Blueprint and classroom source reads use revision checks before and after loading child rows. The RPC locks and rechecks the same revision before writing.
- Assignments and tests created from a blueprint are unpublished drafts.
- Student, submission, grade, attendance, roster, and runtime storage data never enter the write plan or operation ledger.
- RPC responses are validated at the application boundary. A missing RPC returns `atomic_blueprint_migration_required`; an invalid response returns `blueprint_rpc_contract_invalid`.

Successful and failed API responses include `operation_id` when a ledger-backed operation ran. Atomic failures also include a stable `error_code` and `retryable` flag.

## Rollout And Recovery

Apply `081_atomic_blueprint_round_trips.sql` and
`112_versioned_course_blueprint_identity.sql` before deploying the
identity-aware application code. The application deliberately fails closed
with HTTP `503` when a required migration is absent.

The migration is additive, so the previous application version can run while it is being applied. If the application deployment must be rolled back, leave the migration and ledger in place. Do not drop the functions, triggers, revision columns, or ledger until all deployed application versions no longer reference them.

For an operation failure:

1. Use the API's `operation_id` to locate the service-role-only `course_blueprint_operations` row.
2. Inspect `status`, `attempt_count`, `error_code`, `error_sqlstate`, and `resource_counts`; the ledger intentionally stores identifiers and counts, not package payloads or student data.
3. For a retryable source-revision conflict, reload the source and submit a new operation key. For a transient server failure with an unchanged request, retrying the same key is allowed.
4. Confirm that no result graph exists for failed operations before manual intervention. Never repair a failed operation by deleting guessed child rows.

Operation rows are retained indefinitely in this first slice. Any future purge policy must preserve the idempotency window and incident-audit requirements and must be shipped as a separate reviewed lifecycle change.

## Verification

Run the local classroom rollover drill after seeding and generating teacher auth:

```bash
pnpm seed
pnpm e2e:auth
pnpm e2e:verify blueprint-rollover
```

The drill uses the seeded `TEST01` classroom through the browser and adds
temporary local-only assignment, material, survey, assignment-requirement,
announcement, and announcement-read fixtures so every asserted boundary is
non-empty. It
captures a Blueprint, creates a new classroom, and verifies reusable parent and
nested content, test documents/settings, both stable artifact identity columns,
and immutable Blueprint Version lineage. It verifies that enrollments, roster
rows, daily logs, submitted assignment documents (not drafts), test
attempts/responses, live announcements, and announcement reads do not
cross into the new classroom, and that assignments and tests require teacher
review before release. It refuses managed-upload fixtures and non-loopback app,
Supabase, or database targets. Cleanup restores the source classroom's identity,
provenance, revision, and temporary test-document state. Operation cleanup is
bound to exact idempotency keys recorded before each browser mutation is allowed
onto the network. A browser failure-path probe proves missing keys are blocked
without creating operation results. The operation-ledger and managed-storage
inventories must match their pre-drill state.

CI starts an ephemeral Supabase database, replays every migration, and runs:

```bash
bash scripts/check-atomic-blueprint-operations.sh
```

The contract check injects child-write failures, verifies complete domain rollback with retained failure evidence, rejects stale classroom captures, and verifies successful idempotent replay for both blueprint creation and classroom instantiation.

Application logs emit one structured `[blueprint-operation]` event with operation type, status, duration, replay state, resource counts, and stable error code. They do not emit package content or student data.

## Classroom Rollover

When a teacher saves an existing classroom as a blueprint, assignment due dates are converted into offsets from the source classroom start date using `America/Toronto`. Creating a classroom from that blueprint applies those offsets to the new classroom start date.

Blueprint-created assignments and tests are always created unpublished. The teacher must review due dates, lesson-plan calendar mapping, and assessment settings before releasing classwork to students. A blueprint never copies students, submissions, grades, attendance, or announcements into the new classroom.
