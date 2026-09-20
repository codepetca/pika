# Contextual classroom material reads

Status: implemented behind an off-by-default exact-pair gate; not approved for
rollout. This is a read-only phase 2 compatibility slice. It does not make the
classroom page or combined Teaching / Joined home safe to enable.

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
