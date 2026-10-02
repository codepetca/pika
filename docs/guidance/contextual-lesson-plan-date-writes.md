# Dormant shared-admission lesson-plan date writes

Single-date teacher lesson-plan PUT and POST admit a user through
`PIKA_CLASSROOM_EXPERIENCE_ADMISSION`. Admission itself grants no access: the
server checks the live owner relationship, and migration 226 checks the owner
and archive state again while holding the classroom operation and parent locks.
An admitted owner may have either global role. With admission absent or the user
outside it, the original teacher-role route and mutation behavior remain active.
The separate lesson-plan read-pair gate does not control writes.

The service-only `save_lesson_plan_for_owner_v1` function handles one date per
transaction. Ordered mutations retain the existing per-client sequence engine;
unversioned saves and clears do not create mutation heads. Existing content,
artifact identity, Blueprint lineage, revision and purge triggers remain in
place. A stale or equal ordered sequence returns `applied: false` and the
current authorized row or null. A deleted unversioned date returns the prior
`{ lesson_plan: null, date }` envelope.

Migration226 was applied locally once under exact owner authorization; its
generated types match the installed schema. Production remains through225.
Production application still requires separate exact-target authorization under
`schema-rollout-checklist.md`; local approval is not release or cohort permission.
An environment missing the RPC fails closed for admitted writes; callers retain
the original path when shared admission is absent. Bulk/copy remain legacy.

Named SDK envelopes require explicit `error: null` for success and validate
PostgreSQL's nullable error details/hints before mapping denial/conflict codes.
Malformed results or wrong classroom/date binding return generic503, never an
unguarded legacy-write fallback. The existing ordered/unversioned HTTP envelopes
and archived-owner preflight message remain intact.

The synthetic local/ephemeral harness verifies both owner role values, actual
anon/authenticated execute denial, stale/equal no-side-effect state, unversioned
head preservation, current-owner/archive transaction order, row locks, Blueprint
lineage preservation and contention rollback, and the shared purge lifecycle
fence. It exercises real SDK denial mapping and asserts exact fixture/audit cleanup.
These checks do not prove the complete decommission workflow; that remains an
integrated lifecycle/release gate. No destructive real-classroom lifecycle operation,
UI, hosted schema, billing, AI or admission activation is part of this slice.
