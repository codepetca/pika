# Contextual classroom home backend

This is the dormant backend half of phase 2 home/navigation batch B in the
[classroom access roadmap](classroom-access-and-entitlements-roadmap.md). It does
not change the live `/classrooms` page, global role routing, signup, joining,
creation policy, plans or billing. No migration is required.

## Contract

`GET /api/classrooms/home` authenticates with the existing server session, then
returns two active-classroom collections for the same identity:

- `owned`: classrooms whose `teacher_id` is the authenticated user;
- `joined`: classrooms with an active enrollment for the authenticated user.

The global `users.role` value is not consulted. Ownership takes precedence over
a stale or historical self-enrollment, and duplicate enrollment evidence cannot
produce duplicate cards. Joined classrooms are active-only. Archived ownership,
hidden joined classrooms, leave operations and the archived/hidden page remain
separate lifecycle slices.

The response contains only the home-card summary fields already available from
the existing teacher/student list endpoints. It does not expose `teacher_id`,
`student_id`, arbitrary classroom columns or client-provided role/plan claims.
Both reads must succeed, and every returned classroom/enrollment identifier and
relationship is validated before any response. A source error returns 503; the
endpoint never returns a partial home or falls back to global-role authority.

## Rollout gate

The endpoint is unavailable by default and has no live UI consumer:

- `PIKA_CLASSROOM_HOME_ACCESS_ENABLED=true` enables cohort evaluation. Every
  other value returns 404 after authentication.
- `PIKA_CLASSROOM_HOME_ACCESS_USER_IDS` is a JSON array of exact authenticated
  user UUIDs, maximum 100. UUIDs are canonicalized for casing; `[]` admits no
  one. Missing, malformed or oversized enabled configuration returns 503.
- A valid authenticated non-cohort user receives 404 and causes no relationship
  query. The cohort is server-only and must never use `NEXT_PUBLIC_` variables.

This user-scoped gate is deliberately separate from
`PIKA_CLASSROOM_CORE_ACCESS_PAIRS`. A home response enumerates all current
relationships for one identity, whereas the core API pilot admits exact
user/classroom pairs. Enabling one does not enable the other.

## Verification and next boundary

API coverage proves authentication-before-gating, exact enabled values, strict
cohort parsing, mixed legacy-role values, owner precedence, active membership,
subject-bound queries, sanitized responses, deduplication and fail-closed source
or evidence errors. A local service-client canary must return only aggregate
owned/joined counts; do not print account or classroom identifiers.

Do not point the live page at this endpoint until contextual classroom-page
routing/navigation and every reachable surface for the selected mixed-role pilot
are compatible. The next UI slice must use the approved Pattern Lab Teaching /
Joined reference, remain off by default, and complete Pika's teacher/student
desktop/mobile light/dark verification. Production cohort enablement requires a
separate permission-widening decision, canaries, stop thresholds and compatible
rollback floor.
