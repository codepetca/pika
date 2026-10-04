# Audit database contract rollout — October 2026

Migrations244–246 and their matching application changes form one promotion
unit. Prepare and review the complete unit before choosing an application or
migration window. This runbook grants no migration, fixture, reset, cleanup,
merge or deployment permission.

| Migration | Contract and compatibility |
| --- | --- |
| `244_test_attempt_revision_and_return_guards.sql` | Adds a monotonic draft revision, versioned Start/save/submit RPCs, atomic Return eligibility and explicit zero-score evidence for teacher-closed unanswered multiple-choice items. Old non-null unfenced save/submit RPCs fail closed. The new client reads the actual revision, serializes writes, preserves local answers on409 and requires explicit recovery. |
| `245_managed_storage_write_lock_order.sql` | Retains RPC signatures/ACLs and cleanup/tombstone authority. Writers take protocol, existing managed IDs in UUID order, then paths in order. An identity appearing after an absent-row path lock causes a retry instead of an inverted row lock. |
| `246_auth_verification_generation_fence.sql` | Backfills deterministic generations and adds service-only issuance/finalization/credential-consumption RPCs. Resend supersedes older codes and minted handoffs. Direct service-role verification-table access is revoked; this deliberately removes the unfenced legacy path. |

Migration244 requires the new client and backend together: deploying only the
migration makes old save/submit fail; deploying only the new application before
the RPCs are installed fails closed. Migration246 is also deliberately
non-additive: the old direct-table auth routes fail after application of246,
and the new routes fail before its RPCs exist. Plan an owner-approved coordinated
migration/application window; do not promise an additive migration-first rollout.
Migration148 and its historical rollout record remain unchanged. Login password
verification remains compatible, including existing passwords; the72UTF8-byte
policy applies only to newly established passwords.

Before any shared local or hosted application, independently review SQL and
application contracts, replay the complete branch schema in an explicitly
approved disposable local target, generate `database.generated.ts` from that
schema, remove the temporary auth RPC cast, and run `db:types:check`. Do not hand
edit the generated file or generate it from the shared243 database. Required
final CI replays the branch schema and checks drift before contract harnesses.

Runtime verification must include the244 rollback contract and observed
Return/clear/reopen lock ordering, normal and forced-failure exact teardown,
245 storage queue/verify/rename/new-identity lock tests,246 latest-generation
and credential/session contracts, and the two required isolated desktop Test
lifecycle browser cases. Source checks, mock tests, collection and intercepted
visual fixtures do not establish PostgreSQL or live auth correctness. New
harnesses require explicit fixture opt-in and refuse identity collisions.

Keep global flags/modes, shared accounts and other tasks' databases unchanged.
Fixture writes/cleanup require separate authorization; application permission
does not authorize reset, seed or data cleanup. Use
[schema authorization](./schema-rollout-checklist.md#ai-migration-application-authorization)
for the exact target and complete migration set. Production uses the repository
production migration skill/manual GitHub workflow and its own approval gate.

The destructive `clear-and-seed` command retains its existing wipe guard and
uses the existing user foreign-key cascade for verification codes after246;
it does not regain direct table privileges or add an unfenced cleanup RPC.
Do not run this command as part of audit verification.

Record exact schema/source SHA, generated-type output, runtime results and
remaining permission gates before declaring this unit ready. Return a ready PR
to draft before corrections, repeat only affected verification, and wait for
PR Gate on the final independently reviewed SHA. Merge and application promotion
remain separate owner-authority decisions.

If promotion fails after schema application, an older application that requires
unfenced RPCs/direct verification-table access is not a compatible rollback.
Keep the coordinated window or use a reviewed release retaining the new schema
contracts, then prepare a fix forward. Do not restore revoked privileges, reset
history, apply down migrations or overwrite live data as an automatic recovery.
Those actions need their own specific owner decision and permission. An attempted
application consumes its one-time permission even if partially unsuccessful;
inspect durable state read-only and obtain a fresh exact instruction before retry.

During the coordinated window, pause Test save/submit and verification-confirmation
traffic or drain outstanding requests before the schema/application transition.
A request already hashing a code or password must finish against the same fenced
contract or fail and restart; do not replay its old generation or handoff into
the new application. Resume traffic only after these canaries pass on the exact
release and schema: new signup verification plus password establishment, reset
verification plus password replacement and old-session refusal, normal login,
resend invalidating a prior handoff, and Test Start/save/submit using returned
revisions. Use owner-approved synthetic accounts, never an existing user's
password or session. Record failures and durable state before selecting a
compatible fix forward.
