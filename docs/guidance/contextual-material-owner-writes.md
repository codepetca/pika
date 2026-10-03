# Shared material owner writes

Status: draft PR1441, locally verified; final review and CI pending. Exact migration234
is applied locally only. Shared admission and the full classroom cutover remain disabled.

This bounded batch-1 slice adds early shared-admission branches to teacher material
creation, editing and deletion. It does not change the material UI, linked Blueprint
snapshot reads, reorder/reuse/import, image storage or student access to materials.

## Permission and compatibility

Authenticate before admission, parameters and body parsing. Shared admission is
only a routing cohort: the database transaction must independently establish the
current classroom owner and an active classroom. A student-valued owner is allowed;
a teacher-valued member is not. Archived classrooms cannot be mutated.

Absent or unmatched admission preserves existing exact-pair and legacy handlers,
including creator migration193. Malformed configured admission, missing RPCs,
untrusted results and SDK failures fail closed; an admitted request never retries
through a legacy write. Request role, plan, owner or resource claims are not trusted.

## Request and publication rules

Creation uses the established contextual material schema: a trimmed nonblank title
of at most500 JavaScript string units, valid bounded Tiptap content and an optional
boolean draft flag defaulting to true. PATCH accepts a nonempty subset of title,
content and draft status. It trims and requires a nonblank title without introducing
a new500-unit edit limit, validates bounded Tiptap content and requires real booleans.
Neither handler accepts caller-controlled identity, author, position, publication
timestamp, artifact, lineage or archive fields.

Publication is computed from the locked current row, not a prior application read:

- Omitted draft status preserves both existing draft status and release timestamp.
- Draft true clears the release timestamp.
- Draft false retains an existing release timestamp, including historical/future
  values, or assigns a trusted transaction-time timestamp when it is null.

Every accepted PATCH executes an update even if requested values are unchanged.
This preserves existing updated-at and classroom archive-revision behavior.
Publication-only updates do not increment the Blueprint source revision.

## Atomic database boundary

New service-only functions use SECURITY DEFINER with an empty search path and
qualified object references. PUBLIC, anon and authenticated roles cannot execute
them. Creation wraps the existing creator under stronger transaction-time checks;
it retains the mixed assignment/material/survey position allocator.

Each operation takes the classroom-operation advisory lock, lifecycle guard and
nonblocking classroom row lock before establishing current owner/active state.
Editing and deletion additionally lock the material identified by both material
and classroom IDs. DML repeats those bindings. Existing archive and Blueprint
revision/lineage/purge triggers remain intact; no blocking Blueprint lock is added
after the classroom fence.

Creation verifies author, classroom, canonical artifact identity and initial
lineage. Editing preserves historical authorship, creation timestamp, position,
artifact and lineage. Immutable columns are omitted from UPDATE SET altogether.
Suppressed, substituted or malformed DML evidence is rejected inside the transaction,
rolling back the material and associated revision changes. Deletion verifies the
exact bound material disappeared; it does not delete Storage objects.

Creation and editing validate the complete persisted material against the strict
14-field response contract before returning from the transaction. This includes
preserved historical content, UUIDs and timestamps as actually serialized by
PostgreSQL. Invalid historical data returns503 and rolls back the row and both
revision counters; it cannot commit successfully and then fail SDK validation.
An authorized explicit content replacement can repair malformed historical
content. Deletion does not require the deleted row to satisfy a read payload.

Expected outcomes are403 for owner/archive denial,404 for missing classroom or bound
material,400 for invalid requests and409 for retryable contention. Retryable SQL
states are converted inside the RPC to prevent transparent PostgREST retries.
Unknown transport/database errors and malformed actor/resource/result evidence
return503 without fallback or partial success.

## Acceptance and rollout hold

Before any local application, independently review the exact additive SQL, reconcile
with current main and verify migration numbering, exact local target/history and
a one-file preview. The task's local approval waiver does not waive these checks.
Generate database types from the real installed schema; do not fabricate RPC types.

Required evidence includes both global-role owners, all denied relationships,
publication key-presence transitions, historical author/lineage retention,
revision behavior, suppression/substitution rollback, lifecycle/resource races,
legacy row-first contention, mixed creation/reordering, Blueprint purge fences,
actual SDK errors and exact normal/forced-failure fixture cleanup. A stable reviewed
SHA and all required exact-head CI gates precede a normal main merge.

Merging this dormant slice does not authorize production migration application,
cohort activation, billing/provider changes or account/plan changes. Other everyday,
assessment, lifecycle and shell consumers still need the five-batch exit evidence.

## Observed local verification

The independently reviewed SQL234 SHA256 is
`aca48e5b00c1642f487799771a8278bd411c46f40fdec1f6edf9849936078f20`.
One normal application followed exact pika54322 binding, matched001–233 history,
current-main numbering and a234-only dry run. Local001–234 now matches; installed
SQL is immutable. Genuine generated types add only the three public RPC contracts.

322 focused tests across18 files, TypeScript, lint, architecture/UI/design policy,
generated-type drift check and audit pass. The standalone SQL transaction harness
proves permissions/publication/tenancy and exact row/archive/Blueprint rollback,
including malformed historical content/UUID/timestamps and explicit valid repair.
The actual SDK harness passes owner roles, denied relationships, resource/lifecycle
and legacy-row-first races, mixed creation/reordering, purge fences and late failure.
Normal and intentionally forced-failure cleanup both prove zero residual fixtures.
Synthetic fence setup uses postgres only for fixture creation; tested RPCs use the
service role. The harness evaluates deletion before its separate row-absence check.
Neither harness applies schema, changes admission or contacts production.
