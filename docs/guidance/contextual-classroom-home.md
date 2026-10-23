# Contextual classroom home backend

This records the original dormant home reader in the
[classroom access roadmap](classroom-access-and-entitlements-roadmap.md).
The [live-home integration](live-classroom-home.md) now prepares its SSR consumer,
personal visibility persistence and capability-based entry. Those changes remain
dormant; they do not activate production, change plans or rewrite account roles.
The original summary reader requires no new migration; visibility persistence does.

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
relationship is validated before any response, including an exact enrollment
`classroom_id` to embedded classroom `id` match. A source error or non-array source
payload returns 503; the endpoint never returns a partial home or falls back to
global-role authority.

## Rollout gate

The endpoint is unavailable by default. The prepared `/classrooms` SSR consumer
uses the same reader only when both this home cohort and complete-experience
admission select the authenticated account:

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

## Verification and activation boundary

API coverage proves authentication-before-gating, exact enabled values, strict
cohort parsing, mixed legacy-role values, owner precedence, active membership,
subject-bound queries, sanitized responses, deduplication and fail-closed source
or evidence errors. A local service-client canary must return only aggregate
owned/joined counts; do not print account or classroom identifiers.

The contextual classroom-page routing foundation selects
the existing owner/member experience without rewriting the session role. Do not point
the live home at this endpoint until every downstream surface reachable from those
experiences is compatible. The eventual home UI must use the approved Pattern Lab
Teaching / Joined reference, remain off by default, and complete Pika's teacher/student
desktop/mobile light/dark verification. Production cohort enablement requires a separate
permission-widening decision, canaries, stop thresholds and compatible rollback floor.

For the new complete live-home cohort, the home gate plus complete-experience
admission also selects trusted relationship resolution on classroom pages. It
does not require prelisting a newly created classroom ID. Home admission alone
does not change page access. The older exact-pair page pilot remains available
independently for accounts outside that complete cohort. Personal visibility
writes require the same two admissions and reprove exact current membership in SQL.

### Historical incremental reader preparation

The following paragraphs describe the original domain-by-domain preparation,
not the current integration exit. Consult the roadmap and live-home report for
current evidence; none of these historical entries authorizes activation.

Contextual owner/member announcement list reads are now available behind another
independent dormant gate, but announcement mutations/read receipts and the other
reachable classroom domains remain role-bound. The live home must still not consume
this endpoint.

Contextual owner/member lesson-plan list reads are also available behind their own
dormant gate with member visibility limits preserved. Lesson-plan writes and the
remaining domains are still role-bound, so the home activation rule is unchanged.

Contextual owner/member material list reads are likewise available behind a separate
dormant gate with member draft filtering and row binding preserved. Material writes
and the remaining domains are still role-bound, so the home activation rule remains
unchanged.

Contextual owner/member assignment list reads are available behind another independent
dormant gate with owner statistics and member own-document binding preserved. Assignment
item routes, writes, submissions, grading and the remaining domains are still role-bound,
so the home activation rule remains unchanged.
