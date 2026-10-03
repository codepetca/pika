# Contextual classroom material reads

Status: implemented behind an off-by-default exact-pair gate; not approved for
rollout. This is a read-only phase 2 compatibility slice. It does not make the
classroom page or combined Teaching / Joined home safe to enable.

The shared-admission extension described below is being prepared separately.
Neither preparation nor merging its dormant consumer authorizes activation.

## Endpoint contract

| Handler | Contextual permission | Preserved resource rules |
|---|---|---|
| `GET /api/teacher/classrooms/[id]/materials` | Owner, regardless of global role | Archived owners may read; drafts and published materials remain owner-visible |
| `GET /api/student/classrooms/[id]/materials` | Active member, regardless of global role | Drafts stay hidden through the existing `is_draft = false` query |

The server authenticates before resolving route parameters, then resolves ownership
or active membership from trusted classroom/enrollment records. A teacher-valued
member receives only the published member projection. A student-valued owner receives
only the owner projection. Request role, relationship and plan claims are never accepted.

Contextual material arrays must be non-null and every row must contain canonical UUIDs
whose `classroom_id` exactly matches the requested classroom. This validation also runs
after the existing missing-`position` fallback query. Malformed or substituted
service-role evidence returns 503 without disclosing a partial list. Member rows must
also independently prove `is_draft = false`; the query predicate alone is not trusted.
The established missing-table compatibility response remains an empty list.

## Independent rollout gate

- `PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED=true` activates pair evaluation.
  Every other value executes the original role and classroom guards without new
  relationship reads.
- `PIKA_CLASSROOM_MATERIALS_ACCESS_PAIRS` is a strict JSON array of exact
  `{ "userId", "classroomId" }` UUID pairs, maximum 100 pairs and 20,000
  characters. UUID casing is canonicalized; PostgreSQL UUID aliases are rejected.
- Missing, malformed or oversized configuration fails closed after authentication.
  `[]` admits nobody. An unmatched expected-role request keeps the legacy branch;
  an unmatched wrong-role request preserves the legacy Forbidden response without
  relationship or material reads.

This gate is deliberately independent from the home, page, classroom-core,
announcement and lesson-plan gates. Deploying this code cannot silently widen a
cohort configured for another slice. Production configuration remains unchanged.

## Shared-admission extension

The complete-experience actor cohort is admission, not permission. An admitted
request uses a separate early GET branch; absent or unmatched admission preserves
the exact-pair and legacy paths above. Authentication precedes parameter and
configuration validation. Malformed configured admission fails closed. An admitted
request never falls back to the old projection, missing-table empty response or
missing-position query after an error.

Each payload query is rooted in `classrooms`. Owner requests bind the current
`teacher_id` to the authenticated actor; archived owners may read. Member requests
bind a current enrollment in the same statement, exclude the current owner even
if historically self-enrolled, require an unarchived classroom and filter only
`is_draft = false`. A null or future `released_at` does not hide a non-draft material.
The material embedding is a left join so authorized empty or all-draft classrooms
remain distinguishable from absent relationship evidence. Preflight reads establish
404/403 distinctions only, not authorization for later payload statements.

The validated projection preserves all 14 database fields: `id`, `classroom_id`,
`title`, `content`, `is_draft`, `released_at`, `created_by`, `created_at`, `updated_at`,
`position`, `artifact_id`, `source_artifact_id`, `blueprint_archived_at` and
`source_blueprint_version_id`. Historical authorship is not required to match the
current owner. The canonical `artifact_id` is a required, non-null UUID, matching
the database row type. Negative integer positions and nullable lineage/release fields are
valid; null or missing positions are not. Read titles are not subjected to creation
limits. Content uses the existing bounded Tiptap validator without repairing invalid
JSON into an empty document. Malformed fields, wrong bindings or SDK errors return
503 without returning a partial list.

Owner ordering is position, creation timestamp and UUID ascending. Member ordering
is position, release timestamp (nulls last) and UUID ascending. Keyset pagination
retains timestamp microseconds and continues after every nonempty page, including
short pages, until a separately authorized empty page. It checks unique IDs and
strictly increasing order across pages and reads lists beyond the 1,000-row cap.
Ownership transfer, archive or enrollment removal observed by any subsequent query
denies the whole list. This is per-statement current authorization, not an immutable
cross-page snapshot: concurrent material position/publication changes can mix or
omit rows; duplicate or backwards evidence fails closed. A change committed after
the terminal statement is outside this read guarantee.

No migration, new domain toggle, UI change or account/plan change is required.
The linked Blueprint-material snapshot endpoint is a separate owner-only boundary;
it is not widened by this material-list consumer.

## Deferred mutation boundary

Teacher material create/edit/delete requests retain their existing global-role and
classroom guards. They are not safe to widen by replacing only the top-level role
check: ownership, archive state or material binding can change between a resolver
read and a write. A later mutation slice must enforce relationship and resource
binding at transaction time and prove archive/resource-substitution races.

The current material UI is reused unchanged. No navigation, visual pattern, signup,
creation, joining, entitlement, migration or production setting changes in this slice.
The classroom page gate must remain disabled while material writes and the other
reachable classroom domains are still role-bound.
