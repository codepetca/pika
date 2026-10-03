# Shared Assignment write admission

## Scope and release state

This is the first bounded implementation of batch 2 in the
[classroom-access roadmap](classroom-access-and-entitlements-roadmap.md), based
on actual main `e86283f8` after the batch-1 backend exit. Source preparation and
offline tests are not merge, runtime-proof or rollout evidence. Shared admission
and the live page/home pilots remain off until the complete release gates pass.

Reuse the [one retained shared actor cohort](classroom-experience-admission.md).
Do not introduce another flag, role, plan, dependency or database migration.
Existing transaction-time authorization and result validation remain unchanged.

Integrated adapter families:

- Owner Assignment edit/release/delete/pristine discard, manual grading, feedback
  return, bulk operations and repository-target selection.
- Classroom classwork creation and reorder, retaining the existing cross-kind
  allocator and current-owner transactions.
- Learner save, submit/unsubmit, history/restore and linked artifact mutations.
- Inline-image reserve/finalize/delivery admission and early configuration
  validation, including upload cancellation's existing actor-bound cleanup path.

These reuse installed182–200,213 and owner-precedence214 contracts. Admission
does not replace their current owner/enrollment, archive, resource, visibility,
submission, revision or retry semantics. Free participation does not consult a
creation entitlement. A historically self-enrolled owner cannot act as a learner
in their own classroom.

## Admission precedence

| Shared configuration | Behavior |
| --- | --- |
| Absent | Preserve the literal existing pair-pilot/legacy path, including role-first authorization and error ordering. |
| Present malformed | Authenticate first, then fail503 before resolving route callbacks, parsing request bodies, looking up objects or serving compatibility redirects. No legacy fallback. |
| Valid, actor admitted | Validate/canonicalize the requested resource UUID and enter the existing contextual transaction, regardless of the global account role. Older pair flags do not limit this path. |
| Valid, actor not admitted, including an empty cohort | Validate the shared configuration, then retain the exact old pair-pilot evaluation, matching and legacy denial. |

Resolve a resource callback once. Shared admission grants no ownership, enrollment
or resource permission, and a contextual denial or uncertain result never retries
through a legacy handler. History GET retains its authenticated legacy mode rather
than silently becoming student-role-only. Image delivery validates shared
configuration immediately after authentication, before its existing public-path
compatibility branch. Managed image/document/assignment/classroom/subject binding
and transaction-time reserve/finalize checks remain authoritative. Previously
issued60-second signed delivery URLs retain their documented expiry limitation.

## Verification boundary

Offline matrices cover both global-role values; absent/empty/malformed/admitted/
unmatched/shared-plus-pair configurations; authentication and callback/body order;
single contextual RPC dispatch, permission denial and no fallback. The separate
local-only route-to-RPC rehearsal uses synthetic identities, all older pair gates
off and the shared cohort alone. Its fixed source must receive independent review
before execution, with exact guarded fixture cleanup and whole-row baseline
equality on normal and deterministic forced-failure runs. It is a real handler/
database proof, not a browser/session or provider/Storage-byte rehearsal.

No SQL, generated/curated type, dependency, production configuration, account plan
or provider activation changes are part of this bridge. Existing database and
concurrency contracts remain required in CI. Required focused checks, independent
security/compatibility review, stable-SHA CI and verified normal merge precede
delivery. Record actual outcomes in the roadmap and session log; do not label
unexecuted proof source as passing.

## Following work

Learner GET/open admission remains unchanged in this slice. Assignment list,
owner inspection and open supplemental feedback/requirements/artifact/repository
queries require current-access and visibility binding in each payload statement
and page; an earlier preflight or returned ID is insufficient. Those reads, Tests,
Surveys, Gradebook/returned Grades and existing grading entrypoint/job compatibility
remain batch2 prerequisites. Lifecycle/attached services remain batch3, the real
Teaching/Joined product consumer batch4 and whole-experience release batch5.
