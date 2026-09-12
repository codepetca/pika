# Pal membership identity foundation — Phase 1

Status: implementation prepared; migration 168 has not been applied or replayed.
Risk profile: runtime-platform (identity, authorization, schema lifecycle).
Model recommendation: GPT-6 Astra for implementation; Sol/high for independent
identity/security review and Terra/high for compatibility review.

The selected [phased plan](classroom-pal-and-student-cleanup-plan.md) governs this
slice. Each future classroom membership gets its own entire Pal profile. No
existing reward, achievement, event, or profile is copied or reset here.

## Identity and retention

`classroom_enrollments.id` is the immutable membership generation. Migration 164
copies it to `classroom_roster.removed_enrollment_id` before removal deletes the
enrollment; migration 165 prevents readmission while that deny record remains.
Archive v1/v2 enrollment rows preserve the primary key. New enrollments default
to a fresh UUID. The roster/student binding is unsuitable as the generation:
it cascades away with roster/classroom deletion and is reconstructed on restore.

Installation uses one explicit transaction and locks roster/enrollment writes
before backfill until the tracking triggers are installed. Ambiguous historical
generations abort the whole installation. Enrollment registration runs after a
successful insert, so discarded `ON CONFLICT` retries create no phantom ledger.

Migration 168 creates a private, non-cascading ledger keyed by that generation.
The scope digest is SHA-256 of a versioned, unambiguous classroom/student UUID
pair. It is an internal lookup and binding check, never a provider identifier.
The `pika-membership-v1-<32 hex>` provider reference is a separate random UUID,
persisted once under a unique constraint. No Pika IDs or secrets are embedded.
Rotating integration or pseudonym secrets cannot rename an existing reference.

This metadata is outside the archive resource graph. Archive restore never
imports the ledger. Removing enrollment marks its generation removed, except
for the existing authorized compaction context. Restoring an allowed archived
enrollment reuses its ledger row. Removed and purged rows cannot reopen, even
under archive maintenance. Old cold archives unknown to migration 168 register
their preserved generation on restore; none could previously have received a
scoped Pal profile. Ambiguous backfill IDs fail the migration transaction.

The ledger retains only generation, opaque reference, internal scope digest,
and state. No email, raw account/classroom IDs, credential, or academic content
is added. Removed scope digests support later cleanup lookup after enrollment
deletion. A future verified cleanup may transition removed → purged and clear
the digest, retaining generation/reference/state as resurrection evidence.
There is no service-role write privilege, cleanup RPC, receipt, or worker for
that transition in this phase. Tests model it as database owner with synthetic
rows and rollback. Existing purge completion is not evidence that this new
ledger or any Pal profile was erased; integration into verified cleanup and an
approved evidence-retention policy remain Phase 3 gates.

## Authorization and disabled behavior

`prepareMembershipPalReadRequest` is server-only by the enforced repository
module boundary. It accepts only a classroom UUID and obtains the student from
`requireRole('student')`. It requires the exact server flag
`PAL_MEMBERSHIP_IDENTITY_ENABLED=true`; absent or malformed values disable it.
The service-role-only resolver separately checks a private database gate that
defaults false. Both gates remain off. The resolver checks current student
role, enrollment, open generation, active classroom, removed-roster denial,
and student/hot/cold classroom purge fences. It shares the membership operation
lock. Every invocation rechecks access; no account-level fallback or cache exists.
Missing schema, configuration, malformed output, or database failure closes the
new path. Disabled calls do not create a database client or call a provider.

Successful preparation returns only `{ learner_id: opaqueReference }` to its
server caller. This is a snapshot, not a reusable authorization capability.
No route or live integration imports it. Before future token issuance, the
mint coordinator must reauthorize and handle removal during network calls;
provider token revocation and in-flight delivery fencing belong to Phase 3.
This phase does not revoke already issued legacy tokens.

Pal's checked local source at `69c3c91` accepts one `learner_id`, 1–128 URL-safe characters,
and keys identities within the integration. Its read-token endpoint calls
`getOrCreateLearnerIdentity`; therefore Phase 1 does not call it. Legacy Pal
routes, read-token broker, signals, outbox, widgets and student achievements are
unchanged. No Pal/Bara repository edits are made.

## Verification and next gate

Unit tests were written before implementation, including a red transport-error
privacy regression. They cover auth, strict input/output, disabled/missing-schema
behavior, no caching, and reference stability across secret rotation. The
rollback-only SQL fixture covers distinct subjects/courses, retry identity,
immutable generations, removal retention, archive boundary replay, purged
resurrection denial, evidence retention and modeled fresh re-add. The existing
full archive/removal contracts must also pass against migration 168.

No migration application, local replay, database fixture, production operation,
flag enablement, real-data mutation, or provider provisioning is authorized by
this task. Before public types can be generated, a separately approved
disposable/local target must receive the exact migration
`168_pal_membership_identity_foundation.sql` through the repository workflow.
Run the targeted SQL fixture plus existing archive/removal contracts, generate
public types from that verified schema, remove the temporary narrow RPC adapter
in `pal-membership.ts`, and run `db:types:check`. Generated types must not be
edited by hand. Keep the PR draft until that evidence and independent review
are complete. Ready-event CI also replays migrations and must wait for replay
authorization. Production application, rollout, and merge authority are separate.

The shared local database contains unrelated migration 166, and another active
worktree owns 167. This branch reserves 168 and must not generate types from
that shared database. Proposed verification target: isolated local Supabase
project `pika-pal-phase1`, with seeding disabled and migrations 001–165 only as
its empty baseline. Provisioning/replay of that baseline needs authorization.
The separately gated `scripts/check-pal-membership-migration-rollback.sh` then
replays migration 168 with an ambiguous synthetic generation inside its
transaction and checks complete rollback. That script's acknowledgement is an
execution guard, not user authorization. A subsequent clean application of
168 requires fresh authorization; the script never retries or applies it cleanly.
After clean application, `PAL_MEMBERSHIP_PROJECT=pika-pal-phase1 bash
scripts/check-pal-membership-database.sh` runs rollback-only lifecycle checks
and two-session lock-barrier checks. These prove source-write exclusion and
normal removal ordering; they do not claim a completed production rollout or a
full concurrent writer-between-statements migration rehearsal.

Pre-application independent source review used Sol/high for security and
Terra/high for compatibility against `9eee7313`. Both identified the unlocked
backfill window; Sol also identified missing transaction atomicity. One batched
correction adds both protections, red-first source-order tests, a rollback
rehearsal and lock-barrier coverage. Database execution remains the next gate.

Targeted Sol/high re-review cleared both findings at implementation commit
`a553bf8ce0502ff5059e918a3a917803a3db446f`, with no new actionable defects.
Local focused verification passed 113 tests plus architecture, UI/design policy,
TypeScript and lint. Review usage: three launches, one full wave, one targeted
wave, one fix batch. Final integration review is deferred until verified schema
generation replaces the temporary adapter. No PR has been opened because the
required pre-PR database type check cannot pass on the shared schema; no ready
event or CI replay has been triggered. The goal remains active pending approval.
