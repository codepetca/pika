# Contextual enrollment access foundation

Status: dormant foundation; no live imports, schema changes, rollout or new access.
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
  When explicitly called in a future pilot, it authenticates before invitation lookup,
  validates a bounded list of exact user/classroom pairs and marks only the exact pair
  as a contextual candidate—not as authorized to join.
  Invalid enabled configuration fails unavailable; it cannot fall back to legacy access.
- `classroom-enrollment-policy.ts` makes the post-lookup admission decision from
  server-trusted evidence. It rejects malformed evidence, archived classrooms, owner
  self-join, direct-ID admission, closed enrollment, roster mismatch and incomplete
  open-join profiles. Existing active membership is idempotent and grants no new access.

The cohort contains UUIDs only. Never put emails, class codes, titles or other personal
or classroom content in configuration or logs. Canonical UUID matching prevents alias
spellings and separately admitted users/classes from becoming a cross-product.

## Required caller order

A future adopter must preserve this sequence; these contracts alone are insufficient:

1. Authenticate the server session before reading a code or classroom.
2. Rate-limit both the authenticated actor and invitation guesses before lookup.
3. Resolve only a normalized verified code. A classroom ID may recognize an existing
   membership for compatibility, but can never create a membership.
4. Load exact classroom, relationship and roster/profile evidence on the server.
5. Evaluate the pure policy. Never accept request-asserted relationship, owner, roster,
   profile, lifecycle or plan data.
6. For a new membership, use one database transaction that locks and revalidates the
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

## Verification

Focused unit coverage validates disabled legacy identity, authentication failure, malformed
configuration, exact pair matching, canonical UUIDs, empty/noncohort behavior and no pair
cross-product. Policy coverage validates every admission/denial state and fails closed on
malformed or internally inconsistent relationship evidence.

No database migration is introduced or applied by this slice. No API route imports either
module. Production login, signup, join, roster, classroom lists, navigation, entitlements,
Pal delivery and the development-only home reference remain unchanged.
