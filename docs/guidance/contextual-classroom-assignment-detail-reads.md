# Contextual classroom assignment detail reads

Status: implemented behind an off-by-default exact user/assignment gate; not
approved for rollout. This is a read-only phase 2 compatibility slice. It does
not make the assignment workspace, classroom page or combined home safe to
enable.

## Endpoint contract

`GET /api/teacher/assignments/[id]` may admit a configured classroom owner even
when that person's legacy account role is `student`. The response remains the
existing owner aggregate: assignment metadata, classroom, active roster,
submission summaries and artifacts, document-history activity, submission
requirements, and the active AI-grading-run summary. Archived owners retain
read access. The route does not admit members or unrelated users.

After exact-pair admission, the server binds the assignment ID to its nested
classroom record and resolves ownership from the authenticated identity and
trusted server data. Contextual mode then validates every roster/classroom and
embedded user binding, every optional profile against that roster, every
assignment document against both assignment and roster, every requirement
against the assignment, every artifact against its document, student and
requirement, every history row against a returned document, and any active
grading run against the assignment. Null, malformed, duplicate, substituted or
unavailable supporting evidence returns 503 without a partial response. The
intentional missing-requirements-schema compatibility fallback remains an empty
list.

## Independent rollout gate

- `PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED=true` activates detail-pair
  evaluation. Every other value executes the original teacher role and owner
  guards without new relationship logic.
- `PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS` is a strict JSON array of
  exact `{ "userId", "assignmentId" }` UUID pairs, maximum 100 pairs and 20,000
  characters. UUID casing is canonicalized; PostgreSQL UUID aliases are
  rejected.
- Authentication precedes route-parameter resolution. Missing, malformed,
  oversized or unavailable enabled configuration fails closed. `[]` admits
  nobody. Missing, malformed and unmatched assignment IDs preserve the legacy
  branch for a teacher-valued caller and the legacy role-first Forbidden result
  for a student-valued caller, without assignment or relationship reads.

The gate is independent from the assignment-list, home, page, classroom-core,
announcement, lesson-plan and material gates. Deploying the source cannot widen
another slice's cohort. Production configuration remains unchanged.

## Deferred mutation boundary

`GET /api/assignment-docs/[id]` is not a pure read today: for learners it can
create the assignment document, refresh `viewed_at`, clear notification state,
and emit or deliver a Pal event. It therefore remains on the legacy role path
until those effects have transaction-time active-membership, assignment and
student binding. Returning only an existing document to a mixed-role member
would produce a misleading partial workflow because save, submit, artifact and
history operations are still role-bound.

The individual owner work route
`GET /api/teacher/assignments/[id]/students/[studentId]`, assignment editing,
release, reorder, grading, return, repository review, learner save/submit,
artifact operations and every other assignment mutation remain legacy. No UI,
navigation, signup, migration, schema, entitlement or production setting changes
in this slice.
