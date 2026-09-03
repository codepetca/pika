# Classroom access compatibility: phase 1

This implements the observation slice of the [roadmap](classroom-access-and-entitlements-roadmap.md),
not neutral onboarding or entitlement enforcement. Phase 0 merged in PR #1170.
No production rollout or migration is authorized by this document. Risk profile:
`none` of the specialized dev-flow profiles; independent review risk is **high**
because these imports touch authorization helpers.

## Reproducible inventory and migration order

Run `pnpm exec tsx scripts/inventory-classroom-access.ts` from the checkout root.
It prints sorted file/line/signal records, never source snippets or runtime data.
Baseline: main `a9dcf20f` plus this compatibility implementation, 2026-09-02:
205 files; 192 imported `requireRole` calls, 13 `requireAuth` calls, 23 owner-helper
calls, 34 mutate-helper calls, 23 student-helper calls, 2 `isTeacherEmail` calls,
79 syntactic role accesses, 7 role bindings and 40 role writes.

These are **signals, not unique guards or proof of complete coverage**. The scan
includes fixtures and non-account roles (ARIA, AI messages). It follows directly
named import aliases, not namespace imports, wrappers, re-exports, runtime aliases
or shadowed bindings. Inspect the enclosing function and import before classifying
a hit. Supplement with `rg -n 'teacher_id|student_id|users\.role|requireRole' src supabase`
and review direct queries, SQL/RPCs, service-role jobs and resource bindings even
when the scanner reports no hit. Regenerate after rebasing each migration PR.

| Batch | Entry surfaces / existing assumptions | Required migration evidence |
| --- | --- | --- |
| A: Classroom read/manage | `src/lib/server/classrooms.ts`; `api/teacher/classrooms/[id]`, `api/student/classrooms/[id]`; class-days and course-guide routes | Owner active/archive read; active owner mutation; active member participation; unrelated user denial; resource/classroom binding; no role change |
| B: Home/navigation | `src/app/classrooms/page.tsx`, `[classroomId]/page.tsx`, `ClassroomPageClient.tsx`, classroom/student/teacher layouts; AppShell, NavItems, UserMenu, client-auth/user-profile | Combined Owned/Joined home; contextual navigation; same identity owns A/joins B; teacher-valued member and student-valued owner; approved UI references and full visual matrix |
| C: Enrollment | `api/student/classrooms/join`, teacher roster routes, classroom lists; Pal source writes | Code/link requirements, closed/roster/open-join policy, self-join rejection, duplicate/race idempotency, guessing limits; profile/roster/Pal side effects scoped to membership |
| D: Work and assessments | teacher/student assignments, entries, lesson plans, materials/resources, announcements, surveys, tests; `api/assignment-docs` | Student identity and membership together; published/released visibility, deadlines, document binding, attempt/exam state, own submissions only; student work stays free |
| E: Grading and exports | teacher gradebook, logs/history, export-csv, assignment/test grading and run/tick routes | Owner binding throughout async work; sponsor entitlement separate from classroom permission; restore/lifecycle rules; no paid-member escalation; quota reservation before paid consumption |
| F: Attendance and Pal | teacher/student attendance APIs, public attendance token pages; Bara teacher/student/scope helpers; student Pal read-token | Keep attendance-specific rollout entitlement separate; class/user binding through transport and callbacks; mixed-role support requires compatible downstream contracts |
| G: Files and storage | upload-image, storage/submission-images, assignment artifacts, teacher/student test-document routes, cleanup workers | Stored-object subject + classroom + resource checks, signed-URL scope, private student bytes, archive/cleanup bindings; no global-role shortcut |
| H: Archive and non-classroom capabilities | classroom archives/restore/purge/use-again; course-blueprints (including instantiate), curriculum import, public course sites, cron/server workers | Archived ownership, explicit lifecycle permissions, tenant-scoped background jobs; alternate classroom creation paths also need creation entitlement; personal blueprint ownership independent of classroom role |
| I: Identity cleanup (last) | auth.ts, signup/auth me/login/session responses, account profile and identity mapping, user types and SQL consumers | Keep existing sessions and teacher/student role values during compatibility; remove global-role authority only after every reachable pilot surface and rollback floor supports mixed relationships |

Do not release batch B as neutral onboarding while later domains remain role-bound.
UI readiness can be built behind an off-by-default gate; enabling mixed relationships
requires complete reachable-domain coverage. Co-teachers and school administration
remain deferred. No calendar estimate is implied: the broad route/resource migration
is the dominant complexity, while the current observation slice is comparatively small.

### Concrete blockers to a role-neutral pilot found in the inventory

- `src/app/classrooms/[classroomId]/page.tsx` branches on `user.role`, so a teacher
  enrolled in someone else's class cannot use the student branch; the inverse owner
  also cannot use the teacher branch. Helper parity alone cannot repair that routing.
- `src/app/api/student/classrooms/join/route.ts` accepts a classroom UUID as an
  alternative to a code, is student-gated, and has roster/profile/Pal side effects.
  Resolve the intended invitation boundary and race/error behavior before opening it.
- `src/app/api/storage/submission-images/route.ts` branches on global role as well
  as object ownership. A contextual page without contextual file authorization is
  not a complete vertical slice.
- Attendance gates and `attendance_teacher_entitlements` are not subscription
  grants. Blueprint instantiation/use-again can also create classrooms, so changing
  only the ordinary POST creation endpoint would not enforce future creation limits.

## Trusted effective-entitlement loading

`getLegacyClassroomCreationEntitlement` adapts **only a server-authenticated user**
into an in-memory `classrooms.create` snapshot. Valid teacher identity is enabled;
valid student identity is disabled; malformed/unknown role returns null. The grant
has explicit null expiry/quota and legacy provenance. It does not create stored
grants, override a paid plan, read client plan claims or change existing eligibility.
`evaluateLegacyClassroomCreation` keeps its original decision/reason contract.

Future enforcement must load one effective capability for the correct sponsor on
the server, from an approved authoritative source. Unknown plans, malformed data,
source outages and expired grants must not fall back to this legacy adapter. A
loader outage should produce an unavailable/retryable result, not allow new paid
consumption. Permission is still required separately. Define grant precedence,
cache/revocation guarantees, atomic quota reservations, grace and existing-work
protection before connecting billing. None is implemented or approved here.

## Observation contract

`src/lib/server/classroom-access-shadow.ts` reuses already-fetched legacy evidence:
no additional database reads/writes, background jobs, network requests or timers.
The exported observers return void. Existing guards, returned records, errors and
HTTP statuses remain authoritative. Tests compare exact queries and results with
the flag off/on and with a throwing logger. This is not an independent replay of
the database resolver, nor a transaction-time authorization check.

| Check label | Hook / comparison | Coverage limitation |
| --- | --- | --- |
| `owner` | `assertTeacherOwnsClassroom`: owner-only read, including archived owner read | Does not measure generic member read or outer global-role denials |
| `manage` | `assertTeacherCanMutateClassroom`: active-owner management | Only after legacy ownership succeeds; owner denials emit `owner` instead |
| `participate` | `assertStudentCanAccessClassroom`: active membership, with ownership taking precedence | No enrollment query for archived classes; historical self-enrolled owners can produce explained `would_deny` |
| `create` | Teacher classroom POST immediately after `requireRole('teacher')`: legacy snapshot through the entitlement evaluator | Counts guard decisions, not successful inserts; student/unauthenticated guard denials are not observed; alternate creation paths are not hooked |

Malformed or mismatched rows and query failures are `unavailable`, never matching
denials. In particular `single()` errors such as PGRST116 are not assumed to prove
absence. A positive enrollment ID is trusted only because the legacy query filters
both classroom and authenticated user. No observers may accept unscoped query data.
Observation failures are contained and produce no raw exception output; thus missing
events are not proof of parity. This slice makes no claim that every legacy guard,
underlying SQL policy or relationship resolver has been shadowed.

Events use `console.info('PikaAccessShadow', event)` with only `version`, `check`,
`legacy`, `candidate`, `comparison`, and `reason`. No user/class IDs, titles, emails,
codes, row data, URLs, request bodies or exception details are emitted. Comparisons:
`match`, `would_allow`, `would_deny`, `unavailable`. The comparison does not change
the legacy response, even when the proposed policy would allow more access.

## Controlled observation runbook (not yet executed on a hosted cohort)

1. Obtain approval naming environment, exact app SHA, class/user cohort, observation
   window and operator. Coordinate the currently pinned release; this PR is isolated
   from it. Record baseline login/open-class/submission/grading/attendance results and
   current app/database versions. No migration is required by this slice.
2. Set server-only `PIKA_ACCESS_SHADOW_ENABLED=true` and exact comma-separated UUIDs
   in `PIKA_ACCESS_SHADOW_CLASSROOM_IDS` for helper checks and
   `PIKA_ACCESS_SHADOW_USER_IDS` for creation. Each list is required for its own check,
   max 100 entries. Invalid/empty lists disable that check. Never commit real cohort IDs.
3. `PIKA_ACCESS_SHADOW_SAMPLE_RATE` defaults to `0.01` if unset; explicit decimal
   values 0..1 only, invalid values disable observations. Use 1 only for a small,
   approved test cohort/window. A process-local cap permits 100 sampled attempts per
   minute across all check labels, including failed reporting attempts. Multiple
   workers multiply the cap; do not interpret it as a deployment-wide rate limit.
4. Aggregate events by check/comparison/reason in the existing deployment log sink.
   Store only aggregated counts in rollout evidence. There is no new analytics vendor
   or durable per-user tracking. Manage requests may emit both owner and manage events;
   these are sampled decisions, not unique requests/users or whole-site percentages.
5. Before beginning, require positive test observations for each hooked check and
   planned success/denial scenario; `create` denials require tests, not live hook counts.
   Unexpected widening/narrowing must be zero. Any unexpected mismatch, private data
   in an event, or new login/submission failure stops the observation rollout immediately.
   Classify each unavailable result separately; unexplained missing/unavailable evidence
   blocks a parity claim. Explain self-enrollment differences without rewriting data.
6. The named operator disables `PIKA_ACCESS_SHADOW_ENABLED` using the environment's
   normal configuration/redeploy procedure; unset cohorts as defense in depth. Verify
   observations cease and rerun baseline canaries. No authorization rollback or schema
   rollback is needed because nothing was enforced. Test this procedure before expansion.
7. Attach app SHA, window, sample rate, aggregate counts, explained differences,
   unavailable reasons, canary results and disable rehearsal to the release record.
   Only then claim measured phase-1 parity **for these hooks and cohort**. This evidence
   cannot authorize neutral signup, permission widening or monetization enforcement.

## Exit status

Implementation and automated compatibility evidence can ship independently; hosted
measurement, canaries and a disable rehearsal remain required for phase 1's operational
exit. Next implementation batch is classroom read/manage plus its contextual API tests.
Do not remove `users.role`, open creation/joining, or enforce plan limits in this PR.
