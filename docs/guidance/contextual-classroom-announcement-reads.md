# Contextual classroom announcement reads

Status: shared-admission GET integration and the existing dormant exact-pair
compatibility path. Not approved for rollout. This read-only slice does not make
the classroom page or combined Teaching / Joined home safe to enable.

## Endpoint contract

| Handler | Contextual permission | Preserved resource rules |
|---|---|---|
| `GET /api/teacher/classrooms/[id]/announcements` | Owner, regardless of global role | Archived owners may read; drafts and scheduled items remain owner-visible |
| `GET /api/student/classrooms/[id]/announcements` | Active member, regardless of global role | Drafts stay hidden; scheduled items appear only at their publication boundary |

The server authenticates first and resolves ownership or active membership from
trusted classroom/enrollment records. A teacher-valued member receives member
visibility only. A student-valued owner receives owner visibility only. Request
role, plan or relationship claims are never accepted.

## Shared-admission reads

The shared `PIKA_CLASSROOM_EXPERIENCE_ADMISSION` contract admits an authenticated
actor to the new read path; it does not grant ownership or membership. Authentication
precedes route parameters and configuration validation. Missing configuration or
a non-admitted actor retains the exact-pair/legacy path below; malformed configured
admission fails closed. See [shared admission](classroom-experience-admission.md).

Preflight retains existing 404/403 distinctions. Every payload statement then starts
from `classrooms`, with current ownership or an inner, actor-bound enrollment join.
Announcements remain left joined so an authorized empty or all-hidden list returns
`{ announcements: [] }`. Members must not be the current owner, even with historical
self-enrollment, and cannot participate in archived classrooms. Owners may read
archived classrooms. A lost relationship, including on the terminal empty page,
denies the whole request without returning accumulated pages.

The response contains exactly the existing ten announcement fields, never relationship
metadata. Named schemas verify SDK envelopes, canonical UUIDs, exact classroom binding,
types, timestamps and the persisted publication-state invariant. Errors, exceptions or
malformed/substituted data return generic 503 without a partial list. `created_by` need
not equal the current owner: a transferred classroom retains previous authorship.

Lists use `published_at DESC NULLS FIRST, id ASC` with a composite keyset and an explicit
terminal empty statement. Null-publication drafts, tied publication timestamps and
PostgreSQL microseconds remain ordered without offset pagination or 1,000-row truncation.
Short pages are not treated as completion. Duplicate or backward rows fail closed.

Member publication eligibility remains `is_draft = false AND (scheduled_for IS NULL OR
scheduled_for <= cutoff)`. A UTC request cutoff, captured once from the application
clock, is used both in SQL and returned-row checks. It freezes schedule eligibility
for this request instead of reevaluating database `now()` per statement. A future
`published_at` with null `scheduled_for` remains visible, as in the existing handler;
no new publication policy is imposed. Each statement has a current relationship/content
snapshot, not an immutable cross-page snapshot: simultaneous content edits can produce
a mixed snapshot or a fail-closed response. Access revoked before a subsequent payload
statement prevents that statement from returning data; no claim is made about revocation
after the final statement has completed.

Verification: focused helper/route tests plus
`pnpm exec tsx scripts/check-contextual-announcement-read.ts` exercise actual SDK joins,
empty lists, cross-role relationships, 1,001+ rows, precise timestamp ties, short pages,
publication filtering and committed revocation before first/later/terminal reads.
`--verify-cleanup-after-fixture` deliberately fails after setup and proves unconditional,
exact-tag cleanup of fixture data and provisioning audit rows. No migration is required.

## Existing independent exact-pair gate

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

For actors not admitted to the shared path, this gate stays independent from home,
page and classroom-core gates. Its existing minimal ID/classroom row validation and
legacy queries are unchanged. Production and shared-admission configuration remain
unchanged; code integration alone does not activate either cohort.

## Deferred mutation boundary

The [owner-write slice](contextual-announcement-owner-writes.md) is in development,
with provisional migration232 and no activation or completed database concurrency
claim. Until it merges and is schema-verified, teacher create/edit/delete and
member read-receipt POST requests retain their
existing global-role and classroom guards. They are not safe to widen by replacing
only the top-level role check: owner/archive or enrollment removal can race the
write. A later mutation slice must use transaction-time relationship and resource
binding (normally a service-only atomic database operation), preserve publication
validation and prove removal/archive concurrency before joining shared admission.
Next bounded slices are owner create/edit/delete and member read-receipt atomicity;
notification/export consumers remain separate boundaries to inventory before rollout.

The current announcement UI is reused unchanged. No navigation, visual pattern,
signup, creation, joining, entitlement, migration or production setting changes in
this slice. The classroom page gate must remain disabled while announcement
mutations and the other reachable domains are still role-bound.
