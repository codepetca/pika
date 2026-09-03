# Contextual enrollment access foundation

Status: dormant foundation; no live imports, rollout or new access. Migration 157 is
authored but must not be applied to any database without the repository's separate,
exact-target migration authorization.
This is the first bounded part of compatibility batch C in the
[classroom access roadmap](classroom-access-and-entitlements-roadmap.md).
It does not complete phase 2 or authorize the Owned/Joined home.

## Purpose

One authenticated person may eventually own one classroom and join another.
Enrollment authority must therefore come from the target classroom and a verified
invitation, not the permanent `users.role` value. Existing production behavior stays
authoritative until the whole reachable mixed-role foundation and recovery floor pass.

This slice adds two contracts with no production adopters:

- `classroom-enrollment-access.ts` preserves `requireRole('student')` while disabled.
  When explicitly called in a future pilot, it authenticates before reading the request
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
- Migration 157 adds a service-only atomic join RPC and a private schema-backed guess
  limiter. The transaction locks and revalidates the exact expected classroom plus code,
  rejects owner self-join and archive/policy changes, and commits roster, stable roster
  binding, enrollment, profile and optional Pal outbox evidence together. No browser role
  can execute the RPC or read limiter state.
- `contextual-classroom-enrollment.ts` is a dormant server adapter. It normalizes the code,
  HMACs an actor budget and an actor-plus-invitation budget with `SESSION_SECRET`, calls
  only the service RPC and fails unavailable on schema or response drift. Scoping the
  invitation budget to the actor prevents one attacker from exhausting a valid classroom's
  budget for everyone else.

The cohort contains UUIDs only. Never put emails, class codes, titles or other personal
or classroom content in configuration or logs. Canonical UUID matching prevents alias
spellings and separately admitted users/classes from becoming a cross-product.

## Required caller order

A future adopter must preserve this sequence; these contracts alone are insufficient:

1. Authenticate the server session before reading a code or classroom.
2. Keep student-role users on the legacy path. Reject a wrong-role user with no configured
   pair before reading the request body or looking up a code, then use the migration 157
   transaction to rate-limit both the authenticated actor and actor-invitation guesses.
3. For a contextual candidate, resolve a normalized verified code only in a query scoped
   to the authenticated result's `allowedClassroomIds`; a valid code outside that exact
   scope must be indistinguishable from an invalid code. Carry the server-resolved
   classroom ID into policy evidence. A classroom ID may recognize an existing membership
   for compatibility, but can never create a membership.
4. Load exact classroom, relationship and roster/profile evidence on the server.
5. Evaluate the pure policy. Never accept request-asserted relationship, owner, roster,
   profile, lifecycle or plan data.
6. For a new membership, use the migration 157 transaction that locks and revalidates the
   classroom, owner, archive state, enrollment toggle, join policy, invitation, roster
   and existing enrollment; then writes roster/binding, enrollment, profile and any
   transactional outbox fact together. Duplicate concurrent joins must return one
   idempotent membership. No partial roster/profile side effects may survive failure.
7. Project a least-data response. Do not return the class code or private owner data.

## Gates before any route adoption

- A separately reviewed service-only atomic RPC and schema-backed guess limiter exist.
- Rollback-only database tests prove duplicate races, archive/ownership/enrollment-policy
  races, self-join denial, exact invitation binding and all-or-nothing side effects.
- The current `/api/student/classrooms/join` response contract remains unchanged outside
  an exact pilot pair, including authentication-before-body behavior and legacy ID use.
- Pal enabled/disabled behavior uses the same atomic source of truth and does not publish
  a membership fact for a rolled-back or pre-existing enrollment.
- Teacher roster reads/writes and student classroom lists are migrated as separate,
  reviewed adopters. A successful join does not imply those surfaces are mixed-role ready.
- Guess-limit availability, disable procedure, compatible application floor and mixed-role
  canaries are rehearsed before a real cohort. The controlling flag remains unset.

## Migration 157 operational boundary

- The provisional fixed window is 10 minutes: 12 attempts per actor and 3 attempts for
  the same actor plus normalized invitation. These values are database-owned so a caller
  cannot weaken them. Revisit them with production telemetry before a pilot.
- `check-contextual-enrollment-database.sh` is local-only and rollback-only. It proves
  service/browser privileges, mixed-role admission, owner/archive/closed/code denials,
  idempotency, least-data output, complete lineage/profile/Pal writes and forced-failure
  rollback. It never applies the migration.
- `check-contextual-enrollment-concurrency.mjs` creates randomized synthetic fixtures,
  proves duplicate serialization, archive/ownership/enrollment-toggle ordering, join-first
  linearization and the exact concurrent guess budget, then removes its fixtures. It never
  applies the migration or reads hosted credentials.
- Applying migration 157, regenerating database types, enabling a cohort, adopting a route
  and deploying remain distinct approvals. Until generated types are refreshed after an
  authorized application, the dormant adapter contains one localized RPC-client cast.

## Verification

Focused unit coverage validates disabled legacy identity, authentication failure, malformed
configuration, pre-lookup wrong-role rejection, paired-student legacy compatibility, an
immutable exact pair-scoped lookup, canonical UUIDs, empty/noncohort behavior and no pair
cross-product. Policy coverage validates every admission/denial state and fails closed on
malformed, cross-class invitation or internally inconsistent relationship evidence.

No API route imports the adapter or calls the RPC. Production login, signup, join, roster,
classroom lists, navigation, entitlements, Pal delivery and the development-only home
reference remain unchanged. Authoring migration 157 does not authorize applying it.
