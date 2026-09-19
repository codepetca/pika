# Contextual classroom assignment reads

Status: implemented behind an off-by-default exact-pair gate; not approved for
rollout. This is a read-only phase 2 compatibility slice. It does not make the
classroom page or combined Teaching / Joined home safe to enable.

## Endpoint contract

| Handler | Contextual permission | Preserved resource rules |
|---|---|---|
| `GET /api/teacher/assignments?classroom_id=...` | Owner, regardless of global role | Archived owners may read; drafts, roster-scoped statistics and submission requirements remain owner-visible |
| `GET /api/student/assignments?classroom_id=...` | Active member, regardless of global role | Drafts and future-scheduled assignments stay hidden; only the authenticated member's assignment document is included and grade/draft feedback sanitization is unchanged |

The server authenticates before resolving the classroom query value, then resolves
ownership or active membership from trusted classroom/enrollment records. A
teacher-valued member receives only the member projection. A student-valued owner
receives only the owner projection. Request role, relationship and plan claims are
never accepted.

The contextual owner projection validates every assignment/classroom binding, every
roster row, all assignment-document statistics against both the returned assignments
and active roster, and every submission requirement against its assignment. The
contextual member projection independently proves `is_draft = false` and validates
that every returned document belongs to the authenticated member and one of the
authorized assignments. Null, malformed, substituted or unavailable supporting
evidence returns 503 without disclosing a partial list.

## Independent rollout gate

- `PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_ENABLED=true` activates pair evaluation.
  Every other value executes the original role and classroom guards without new
  relationship reads.
- `PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_PAIRS` is a strict JSON array of exact
  `{ "userId", "classroomId" }` UUID pairs, maximum 100 pairs and 20,000
  characters. UUID casing is canonicalized; PostgreSQL UUID aliases are rejected.
- Missing, malformed or oversized configuration fails closed after authentication.
  `[]` admits nobody. Missing, malformed and unmatched classroom query values keep
  the legacy branch for the expected global role; wrong-role callers preserve the
  legacy Forbidden response without relationship or assignment reads.

This gate is independent from the home, page, classroom-core, announcement,
lesson-plan and material gates. Deploying this code cannot widen a cohort configured
for another slice. Production configuration remains unchanged.

## Deferred mutation boundary

Assignment creation, item reads, editing, release, reorder, grading, return, artifact
and submission operations retain their existing global-role and classroom guards.
They require separate transaction-time owner/member, archive, assignment, student and
artifact binding; replacing only a top-level role check would leave race windows.

The assignment UI is reused unchanged. No navigation, visual pattern, signup,
creation, joining, entitlement, migration or production setting changes in this slice.
The page gate must remain disabled while assignment writes and the other reachable
classroom domains are still role-bound.
