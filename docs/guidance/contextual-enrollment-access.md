# Contextual enrollment access foundation

Status: guarded route adopter; no rollout or newly enabled production access. The atomic
enrollment foundation is migration 159 and was applied locally and to production before
migration 160. Its deployed definition is immutable. Migration 161 adds the service-only
rejected-guess adopter required by the guarded route and remains unapplied. The production
pilot configuration remains unset.
This is the first bounded part of compatibility batch C in the
[classroom access roadmap](classroom-access-and-entitlements-roadmap.md).
It does not complete phase 2 or authorize the Owned/Joined home.

## Purpose

One authenticated person may eventually own one classroom and join another.
Enrollment authority must therefore come from the target classroom and a verified
invitation, not the permanent `users.role` value. Existing production behavior stays
authoritative until the whole reachable mixed-role foundation and recovery floor pass.

This foundation now owns policy-aware class-code joining and one disabled-by-default
mixed-role route adopter:

- `classroom-enrollment-access.ts` preserves `requireRole('student')` while disabled.
  When explicitly enabled for a pilot, it authenticates before reading the request
  body or looking up an invitation, validates a bounded list of exact user/classroom
  pairs and keeps every student-role user on the unchanged legacy path. A wrong-role user
  with no matching pair is rejected immediately; a paired wrong-role user receives only
  an immutable list of that authenticated user's classroom IDs as the permitted lookup
  scope. After a query restricted to that scope, it marks only the exact resolved pair as
  a contextual candidate—not as authorized to join.
  Invalid enabled configuration fails unavailable; it cannot fall back to legacy access.
- `classroom-enrollment-policy.ts` makes the post-lookup admission decision from
  server-trusted evidence. It rejects malformed evidence, archived classrooms, owner
  self-join, direct-ID admission, closed enrollment, roster mismatch and incomplete
  open-join profiles. Existing active membership is idempotent and grants no new access.
- Migration 159 adds a service-only atomic join RPC and a private schema-backed guess limiter.
  Migration 161 exposes a service-only rejected-guess RPC over that private limiter so attempts
  rejected before atomic admission consume the same budgets. The transaction locks and revalidates the exact expected classroom plus code,
  rejects owner self-join and archive/policy changes, and commits roster, stable roster
  binding, enrollment, profile and optional Pal outbox evidence together. No browser role
  can execute the RPC or read limiter state.
- `contextual-classroom-enrollment.ts` is the guarded server adapter. It normalizes the code,
  HMACs an actor budget and an actor-plus-invitation budget with `SESSION_SECRET`, calls
  only the service RPC, builds a validated pseudonymous classroom-joined event when Pal is
  enabled, and fails unavailable on schema or response drift. Scoping the
  invitation budget to the actor prevents one attacker from exhausting a valid classroom's
  budget for everyone else.
- `/api/student/classrooms/join` calls the gate before parsing its body. Authenticated
  student class-code requests use the atomic service contract. Roster-only classrooms
  require exactly one normalized roster identity; open-join classrooms may request the
  bounded first and last name fields required by the transaction. Existing membership
  remains idempotent. Direct-ID compatibility requests stay on the legacy
  implementation. Only a wrong-role user in an exact
  configured pair reaches a bounded pair-scoped lookup, exact normalized code comparison,
  pure-policy check and atomic join. No pattern operator treats invitation input as a wildcard. Direct
  classroom IDs can recognize an existing membership but cannot create one. Contextual
  responses omit class codes and owner data. A non-empty code that misses the exact scoped
  lookup is charged through the rejected-guess RPC before the generic not-found response.

The cohort contains UUIDs only. Never put emails, class codes, titles or other personal
or classroom content in configuration or logs. Canonical UUID matching prevents alias
spellings and separately admitted users/classes from becoming a cross-product.

## Required caller order

A future adopter must preserve this sequence; these contracts alone are insufficient:

1. Authenticate the server session before reading a code or classroom.
2. Send authenticated student class-code requests through migration 159. Reject a wrong-role
   user with no configured pair before reading the request body or looking up a code, then
   use migration 159 to
   rate-limit both the authenticated actor and actor-invitation guesses. Scoped lookup
   misses and pre-atomic policy denials use the service-only rejected-guess RPC; admission
   candidates use the atomic transaction so every observable attempt is charged once.
3. For a contextual candidate, resolve a normalized verified code only in a query scoped
   to the authenticated result's `allowedClassroomIds`; a valid code outside that exact
   scope must be indistinguishable from an invalid code. Carry the server-resolved
   classroom ID into policy evidence. A classroom ID may recognize an existing membership
   for compatibility, but can never create a membership.
4. Load exact classroom, relationship and roster evidence on the server; normalize and
   validate any submitted profile fields.
5. Evaluate the pure policy. Never accept request-asserted relationship, owner, roster,
   lifecycle or plan data.
6. For a new membership, use the migration 159 transaction that locks and revalidates the
   classroom, owner, archive state, enrollment toggle, join policy, invitation, roster
   and existing enrollment; then writes roster/binding, enrollment, profile and any
   transactional outbox fact together. Duplicate concurrent joins must return one
   idempotent membership. No partial roster/profile side effects may survive failure.
7. Project a least-data response. Do not return the class code or private owner data.

Client handoffs after `profile_required` may carry a non-authoritative UI hint to show
the profile form without repeating the same join probe. The subsequent profile submission
must still pass through this server sequence, and `rate_limited` responses must display the
returned retry delay rather than inviting an immediate retry.

## Route-adoption invariants

- A separately reviewed service-only atomic RPC and schema-backed guess limiter exist.
- Rollback-only database tests prove duplicate races, archive/ownership/enrollment-policy
  races, self-join denial, exact invitation binding and all-or-nothing side effects.
- The `/api/student/classrooms/join` route preserves authentication-before-body behavior
  and legacy direct-ID compatibility while class-code joins enforce the classroom's
  roster-only or open-join policy inside the atomic transaction.
- Pal enabled/disabled behavior uses the same atomic source of truth and does not publish
  a membership fact for a rolled-back or pre-existing enrollment.
- Teacher roster reads/writes and student classroom lists are migrated as separate,
  reviewed adopters. A successful join does not imply those surfaces are mixed-role ready.
- Guess-limit availability, disable procedure, compatible application floor and mixed-role
  canaries are rehearsed before a real cohort. The controlling flag remains unset.

## Migrations 159 and 161 operational boundary

- The provisional fixed window is 10 minutes: 12 attempts per actor and 3 attempts for
  the same actor plus normalized invitation. These values are database-owned so a caller
  cannot weaken them. The actor budget is consumed before an invitation row is created;
  blocked actors therefore cannot grow the table by rotating guesses. Downstream join
  failures roll back membership effects but preserve the charged attempt. Revisit limits
  with production telemetry before a pilot.
- Stale limiter cleanup is a separate bounded, service-only function with an indexed age
  scan and `SKIP LOCKED`; it is deliberately off the join request path. The existing
  authenticated `/api/cron/cleanup-history` owns one batch of at most 10,000 rows
  daily at 07:00 UTC through the Vercel schedule. Only rows untouched for more
  than one day qualify; active limiter windows are preserved by the database.
  A database/transport error, invalid result, or full batch returns 503 and records
  `classroom_join_limiter_cleanup_unhealthy` in the existing cron-run ledger.
  The cron health snapshot exposes failed or missing scheduled runs; sanitized
  deployment logs report the deleted count. A full batch signals possible backlog
  for operator investigation, rather than an unbounded retry. This uses the existing
  cron secret and ledger with no additional schema, configuration, or schedule.
- A classroom roster may seed a missing global student profile, but cannot overwrite an
  established profile from another classroom. Any future profile-editing authority or
  classroom-scoped identity model is a separate product and data-contract decision.
- `check-contextual-enrollment-database.sh` is local-only and rollback-only. It proves
  service/browser privileges, mixed-role admission, owner/archive/closed/code denials,
  idempotency, least-data output, complete lineage/profile/Pal writes and forced-failure
  rollback. It never applies the migration.
- `check-contextual-enrollment-concurrency.mjs` creates randomized synthetic fixtures,
  proves duplicate serialization, archive/ownership/enrollment-toggle ordering, join-first
  linearization and the exact concurrent guess budget, then removes its fixtures. It never
  applies the migration or reads hosted credentials.
- Production and local migration 159 history predates the rejected-guess adopter. Migration 161
  must be separately reviewed, authorized and applied to each target before any pilot cohort is
  enabled. Applying it does not authorize a cohort or production configuration change.

## Verification

Focused unit coverage validates disabled legacy identity, authentication failure, malformed
configuration, pre-lookup wrong-role rejection, paired-student legacy compatibility, an
immutable exact pair-scoped lookup, canonical UUIDs, empty/noncohort behavior and no pair
cross-product. Policy coverage validates every admission/denial state and fails closed on
malformed, cross-class invitation or internally inconsistent relationship evidence.

The regular join route uses the guarded adapter for policy-aware student class-code joins;
the controlling flag still limits only mixed-role access. Production login, signup, direct-ID
compatibility, roster, classroom lists, navigation, entitlements and the development-only home
reference otherwise remain unchanged. Contextual Pal delivery
uses the same event instant as its transactional outbox fact. Local verification does not
authorize migration 161 application or a pilot cohort.
