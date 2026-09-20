# Contextual classroom announcement reads

Status: implemented behind an off-by-default exact-pair gate; not approved for
rollout. This is a read-only phase 2 compatibility slice. It does not make the
classroom page or combined Teaching / Joined home safe to enable.

## Endpoint contract

| Handler | Contextual permission | Preserved resource rules |
|---|---|---|
| `GET /api/teacher/classrooms/[id]/announcements` | Owner, regardless of global role | Archived owners may read; drafts and scheduled items remain owner-visible |
| `GET /api/student/classrooms/[id]/announcements` | Active member, regardless of global role | Drafts stay hidden; scheduled items appear only at their publication boundary |

The server authenticates first and resolves ownership or active membership from
trusted classroom/enrollment records. A teacher-valued member receives member
visibility only. A student-valued owner receives owner visibility only. Request
role, plan or relationship claims are never accepted.

Contextual result arrays must be non-null and every announcement must contain a
canonical UUID whose `classroom_id` exactly matches the requested classroom. A
malformed or substituted row returns 503 without disclosing a partial list.

## Independent rollout gate

- `PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_ENABLED=true` activates pair evaluation.
  Every other value executes the original role and classroom guards without new
  relationship reads.
- `PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS` is a strict JSON array of exact
  `{ "userId", "classroomId" }` UUID pairs, maximum 100 pairs and 20,000
  characters. UUID casing is canonicalized; PostgreSQL UUID aliases are rejected.
- Missing, malformed or oversized configuration fails closed after authentication.
  `[]` admits nobody. An unmatched expected-role request keeps the legacy branch;
  an unmatched wrong-role request preserves the legacy Forbidden response without
  relationship reads.

This gate is deliberately independent from the home, page and classroom-core
gates. Deploying this code cannot silently widen a cohort configured for another
slice. Production configuration remains unchanged.

## Deferred mutation boundary

Teacher create/edit/delete and member read-receipt POST requests retain their
existing global-role and classroom guards. They are not safe to widen by replacing
only the top-level role check: owner/archive or enrollment removal can race the
write. A later mutation slice must use transaction-time relationship and resource
binding (normally a service-only atomic database operation), preserve publication
validation and prove removal/archive concurrency before it can join this gate.

The current announcement UI is reused unchanged. No navigation, visual pattern,
signup, creation, joining, entitlement, migration or production setting changes in
this slice. The classroom page gate must remain disabled while announcement
mutations and the other reachable domains are still role-bound.
