# Contextual classroom lesson-plan reads

Status: existing exact-pair compatibility path remains dormant; a bounded batch-1
shared-admission read adapter is in development. Neither path is activation
permission. This does not make the classroom page or combined Teaching / Joined
home safe to enable. No schema or mutation change is part of this read slice.

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

## Shared experience integration

The new early GET branch consumes the existing strict
[shared experience admission](classroom-experience-admission.md). An absent
variable preserves the existing exact-pair/legacy helper unchanged. A present
variable authenticates before admission or parameter parsing; non-admitted
actors retain the original helper. Present malformed configuration fails closed.
Admission grants no ownership, enrollment, entitlement or visibility permission.

Shared requests use a named canonical UUID/real-calendar date-range schema; a
reversed range returns400. Initial relationship preflight retains404/403 behavior
but is never authority for a later data statement. Every payload page roots the
requested classroom and embeds its plans with a left join. Owner pages filter
current teacher_id by session actor, allowing archived history. Member pages
exclude current ownership, require an unarchived classroom and an inner enrollment
join filtered by the same session actor. This keeps an authorized classroom root
available even when its requested plan range is empty, while relationship loss
eliminates it. A missing bound root denies403 and discards all accumulated plans.

Each member page includes current lesson_plan_visibility in that same statement.
The existing Toronto Saturday ceilings govern the returned rows; null conservatively
defaults to current_week. Missing/unknown visibility fails503. A tightened setting
before the first payload uses that current setting. If visibility changes between
pages, including the terminal empty page, discard the entire result503 rather
than mix policies. Even a range wholly beyond the ceiling must execute a bound
root read. These are ordinary independently authorized statement snapshots, not
a cross-statement transaction or a lock.

Pagination uses the unique classroom/date key as an ascending embedded keyset.
Continue until an empty plan page, not a short page, so lower effective PostgREST
caps do not silently truncate a list. Validate monotonic progress, all requested
range/resource/relationship identities and named unknown SDK result envelopes.
Contain both query construction and await failures as generic503, with no unbound
query/RPC or legacy fallback. Explicitly project the eleven current supported plan
fields, including Blueprint provenance, with existing markdown conversion; joined
authorization metadata never appears in the response.

Every plan requires valid Tiptap content using the shared parser/validator;
missing or JSON null content fails503 instead of becoming an empty plan. PostgreSQL
JSONB NOT NULL still allows the JSON literal null, so this is verified against
actual stored JSONB, not only mocks. Valid document and serialized-document
compatibility remain unchanged.

Acceptance requires TDD/admission/auth-order/unchanged-pair/legacy tests, focused
static checks and the actual local PostgREST contract. The synthetic harness must
prove FK/alias semantics, 1001+ plans and short nonterminal pages, empty and
out-of-window ranges, transfer/removal/archive/owner precedence before first and
later pages, current visibility tightening and terminal-page policy change, and
keyset stability after deleting a previously read row. Assert exact fixture/live
state and entitlement-audit cleanup; no real accounts, hosted calls, reset/reseed
or migration application. Independent fixed-SHA review and exact-head PR Gate
remain mandatory. Test receipts belong in the PR, not this design description.

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
