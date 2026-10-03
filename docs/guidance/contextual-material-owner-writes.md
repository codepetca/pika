# Shared material owner writes

Status: source preparation. No mutation migration has been applied or mutation PR
merged. Shared admission and the full classroom cutover remain disabled.

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
