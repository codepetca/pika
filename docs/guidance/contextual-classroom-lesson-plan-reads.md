# Contextual classroom lesson-plan reads

Status: implemented behind an off-by-default exact-pair gate; not approved for
rollout. This is a read-only phase 2 compatibility slice. It does not make the
classroom page or combined Teaching / Joined home safe to enable.

## Endpoint contract

| Handler | Contextual permission | Preserved resource rules |
|---|---|---|
| `GET /api/teacher/classrooms/[id]/lesson-plans` | Owner, regardless of global role | Archived owners may read; requested date range and owner projection are unchanged |
| `GET /api/student/classrooms/[id]/lesson-plans` | Active member, regardless of global role | Classroom `lesson_plan_visibility` still clamps the requested range to the current week, one week ahead or all dates |

The server authenticates before resolving route parameters, then resolves ownership
or active membership from trusted classroom/enrollment records. A teacher-valued
member receives only the member projection. A student-valued owner receives only the
owner projection. Request role, relationship and plan claims are never accepted.

Contextual lesson-plan arrays must be non-null and every row must contain canonical
UUIDs whose `classroom_id` exactly matches the requested classroom. The member
visibility record must also identify that exact classroom and contain a recognized
visibility value. Malformed or substituted service-role evidence returns 503 without
disclosing a partial list.

Contextual member date bounds must be real canonical `YYYY-MM-DD` calendar dates
before the server compares them with the visibility ceiling. PostgreSQL-compatible
aliases are rejected with 400 so alternate spellings cannot bypass the week clamp.
The unmatched legacy path keeps its existing request behavior.

## Independent rollout gate

- `PIKA_CLASSROOM_LESSON_PLANS_ACCESS_ENABLED=true` activates pair evaluation.
  Every other value executes the original role and classroom guards without new
  relationship reads.
- `PIKA_CLASSROOM_LESSON_PLANS_ACCESS_PAIRS` is a strict JSON array of exact
  `{ "userId", "classroomId" }` UUID pairs, maximum 100 pairs and 20,000
  characters. UUID casing is canonicalized; PostgreSQL UUID aliases are rejected.
- Missing, malformed or oversized configuration fails closed after authentication.
  `[]` admits nobody. An unmatched expected-role request keeps the legacy branch;
  an unmatched wrong-role request preserves the legacy Forbidden response without
  relationship or lesson-plan reads.

This gate is deliberately independent from the home, page, classroom-core and
announcement gates. Deploying this code cannot silently widen a cohort configured
for another slice. Production configuration remains unchanged.

## Deferred mutation boundary

All lesson-plan date, bulk and copy writes retain their existing global-role and
classroom guards. They are not safe to widen by replacing only the top-level role
check: ownership or archive state can change between a resolver read and a write.
A later mutation slice must preserve the existing atomic calendar-write contracts,
bind ownership/archive state at transaction time and prove archive/removal races.

The current lesson calendar UI is reused unchanged. No navigation, visual pattern,
signup, creation, joining, entitlement, migration or production setting changes in
this slice. The classroom page gate must remain disabled while lesson-plan writes
and the other reachable classroom domains are still role-bound.
