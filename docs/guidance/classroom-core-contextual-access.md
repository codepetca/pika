# Contextual classroom-core APIs

First backend slice of [phase 2](classroom-access-and-entitlements-roadmap.md), stacked
on observation PR #1172. Implemented, not enabled; independent review and exact-head
CI are release prerequisites. This is **not** a complete classroom domain or approval
to enable neutral onboarding. No schema, session, role, enrollment or billing changes.

## Endpoint contract

| Handler | Contextual permission | Additional rules |
| --- | --- | --- |
| `GET /api/teacher/classrooms/[id]` | Owner, regardless of global role | Archived owners may read |
| `PATCH /api/teacher/classrooms/[id]` | Owner, regardless of global role | Existing validation; explicit archive/restore; owner and archive snapshot bound in UPDATE |
| `GET /api/student/classrooms/[id]` | Active enrolled member | Owner self-participation denied; raw overview/outline drafts blanked |
| `GET /api/classrooms/[classroomId]/class-days` | Owner or active member | Existing scoped calendar reader |
| `GET /api/teacher/class-days?classroom_id=…` | Owner or active member | Compatibility URL, same scoped reader |
| `GET /api/classrooms/[classroomId]/course-guide` | Owner or active member | Members also require syllabus visibility; existing published-source and guide-content filters retained |

Existing URLs are compatibility surfaces, not permanent account types. A teacher-valued
account enrolled in B gets member permissions in B, never owner permissions. A
student-valued owner of A gets owner permissions in A, never self-participation.
Paying or asserting a role/plan in a request cannot create either relationship.

`authorizeClassroomCoreRequest` authenticates first, then resolves trusted classroom
and enrollment evidence. It uses the existing coarse policy, not client-supplied
identity or data. The already-fetched-record resolver validates binding and shape,
**not provenance**: only trusted server reads may be passed to it. No extra enrollment
read is needed for owners. Missing classrooms return 404; failed/malformed evidence
returns 503; unrelated users and disallowed relationships return 403.

The member details projection retains the existing metadata shape but blanks raw
guide markdown. Visible guide content comes through the guarded Course Guide endpoint.
This is not an audit of every existing student response or every future classroom field.

## Disabled by default; exact pair admission

Server-only configuration (never a request flag or `NEXT_PUBLIC_` variable):

- `PIKA_CLASSROOM_CORE_ACCESS_ENABLED=true` activates pair evaluation; every other
  value uses the exact existing authentication and route guards without new DB reads.
- `PIKA_CLASSROOM_CORE_ACCESS_PAIRS` is a JSON array of strict objects with UUID
  `userId` and `classroomId` properties. Maximum 100 pairs / 20,000 characters. UUIDs
  are canonicalized so casing cannot evade pair admission. Two independent allowlists
  are deliberately not used: admitting user A/class A and user B/class B does not
  admit A/class B.
- When enabled, invalid/noncanonical UUID spellings (including PostgreSQL's dashless,
  braced and alternate-hyphen aliases) return 400 before pair matching. Uppercase
  canonical UUIDs are accepted and normalized. Rejecting aliases prevents a pilot
  request from evading contextual checks through the legacy path; the disabled gate
  retains existing identifier behavior.
- `[]` intentionally selects nobody. Unmatched canonical-ID requests retain the existing
  global-role and route-level checks, including the generic `Forbidden` response body.
  A legacy result from the helper is authentication only;
  callers must not omit those original guards.
- With the flag enabled, absent/malformed pair configuration or malformed authenticated
  identity returns 503 after authentication. It never silently falls back to permissive
  legacy behavior. No user IDs, classroom IDs or configuration contents are logged.

The gate is temporary admission for this backend slice, not a subscription entitlement
or final self-service rollout mechanism. Hosted configuration remains untouched.

## Mutation boundary and recovery

Contextual PATCH retains the existing Zod allowlist, publishing validation, prohibition
on combining archive toggles with ordinary edits, archived-edit denial, and owner-only
archive/restore behavior. It predicates UPDATE on classroom ID, current owner and the
exact previously observed archive value (including null for active classes). Zero
matching rows return 409 and request a refresh, rather than writing against stale
authorization. Returned row identity/owner/lifecycle shape are validated before disclosure.
This is not a general lock, version counter or protection against all concurrent content
edits; callers still need a future transaction design for multi-row domain mutations.

API tests exercise the real handlers against a stateful query mock, including concurrent
owner/archive/deletion changes and invalid post-write rows. They prove emitted predicates
and rejection behavior, **not** a live Postgres concurrency rehearsal. A 503 after a
malformed post-write response does not prove the write was rolled back; refresh before
retrying an archive toggle. Existing genuine database errors keep their current response.

## Release prerequisites and rollback floor

1. Verify the #1172 dependency and exact-head review/CI landing records. The owner
   approved main-only landing of #1172/#1174/#1175 after synchronization and fresh checks;
   the prior #1169 release-window hold is cleared. Merging does not authorize enabling it.
2. Finish all routes, SSR pages, navigation, jobs and resources reachable by a chosen
   mixed-role pilot before admitting real classes. This partial slice alone is insufficient.
3. Obtain explicit permission-widening approval for the exact cohort and environment;
   record baseline app/database/config versions, acceptance cases, stop thresholds,
   support owner and a tested compatible recovery build outside teaching time.
4. Once a mixed-role relationship is in use, do **not** remove its pair, clear the array,
   disable the gate, or revert to an old role-only build as an emergency shortcut. Those
   actions can strand owners/members. Recover on the compatible release floor, preserving
   existing relationship access while stopping new cohort admission/creation separately.
   This release does not implement that broader recovery control: it is a pilot prerequisite.

No production enablement, migration application, pricing or creation eligibility is
approved by this document. Production canaries and rollback rehearsal remain unexecuted.

## Deferred work

The next [calendar-write slice](contextual-calendar-writes.md) adds pilot-only atomic
POST/PATCH operations with migration 152; those writes remain legacy outside the pilot.
Home Owned/Joined lists, SSR/classroom navigation, signup,
creation, joining and roster flows are unchanged. Assignments/tests/submissions, grading,
attendance, files, exports, jobs, deletion, blueprints and other teacher-only surfaces need
their own migration and resource/lifecycle audits. The [inventory](classroom-access-compatibility.md)
continues to track syntactic guard signals, including the new gate, not proof of coverage.
