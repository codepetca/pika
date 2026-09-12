# Pal membership identity foundation — Phase 1

Status: migration 168 applied and verified on the existing local `pika` database
on 2026-09-12, following migrations 166/167. Foundation remains disabled.
Prerequisite PR #1252 is merged to main as `0aeba623`. Draft PR #1253 is synced
with that main commit and awaits final integration review and combined CI.
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

The user corrected the target to the existing local Pika database. Its verified
history already contained 001–167. After integrating the reviewed prerequisite
branch, the exact local preview contained only 168; the reviewed checksum was
unchanged and read-only checks found no ambiguous historical generation IDs.
One `supabase db push --local` applied 168 successfully. History now contains
001–168, the ledger count matches the source backfill count, and the database
and app gates remain disabled. The rollback-only membership lifecycle fixture
and both source-lock barriers pass on this database. Public types regenerated
through the canonical command match the merged generated contract and pass
`db:types:check`. Combined focused checks pass 1,676 tests across 145 files plus
architecture, UI/design policy, TypeScript and lint. Database lint is warning-free,
and the classroom schema audit passes all 241 foreign-key relationships.

Extra Pal disposable containers were stopped, preserving their volumes. The
proposed `pika-pal-integration` database received no application migrations and
is no longer the verification target. No production application, provider
provisioning, flag enablement, or real-data erasure is included. The approved
bounded final integration review remains available; #1253 stays draft until
the synced candidate is reviewed for CI.

### Earlier isolated verification evidence

Unit tests were written before implementation, including a red transport-error
privacy regression. They cover auth, strict input/output, disabled/missing-schema
behavior, no caching, and reference stability across secret rotation. The
rollback-only SQL fixture covers distinct subjects/courses, retry identity,
immutable generations, removal retention, archive boundary replay, purged
resurrection denial, evidence retention and modeled fresh re-add. The existing
full archive/removal contracts must also pass against migration 168.

The initial task did not authorize migration application. The user subsequently
approved isolated baseline migrations 001–165, migration 168's intentional
rollback rehearsal, and then one clean application of 168 in three separate
instructions. Each succeeded on 2026-09-12. Production operations, flag
enablement, real-data erasure and provider provisioning remain unauthorized.
Public types were generated from the verified isolated schema with the
repository's `db:types:generate` command and passed `db:types:check`. A temporary
local CLI launcher pointed those commands at this isolated Supabase workdir;
the shared database was not used at that stage. The only Pal public change is the
`resolve_pal_membership` RPC. The temporary RPC type adapter was removed.
Production application, rollout, and merge authority are separate.

Initially the shared local database contained unrelated migration 166, and
another active worktree owned 167. This branch reserved 168 and generated types
from an isolated schema at that stage. Earlier verification target: local project
`pika-pal-phase1`, with seeding disabled and migrations 001–165 as its empty
baseline. Runtime files are at
`/Users/stew/.codex/worktrees/pika/.pal-phase1-db`; the database container is
`supabase_db_pika-pal-phase1` on port 56322. After an empty-project start,
the exact migration list and dry run were checked against a 165-file checksum
manifest, then one approved `supabase db push --local` applied the baseline.
Read-only verification confirmed all 165 migration names/numbers, zero users,
classrooms and enrollments, and no migration-168 ledger. Public types generated
from this isolated baseline exactly match committed `database.generated.ts`.
No shared database, hosted target, seed, or provider profile was changed.
The separately gated `scripts/check-pal-membership-migration-rollback.sh` then
replays migration 168 with an ambiguous synthetic generation inside its
transaction and checks complete rollback. That script's acknowledgement is an
execution guard, not user authorization. A subsequent clean application of
168 required fresh authorization; the script never retries or applies it cleanly.
The approved rehearsal passed with the reviewed migration checksum
`30af63fcfd32932b13f21ddfef92c94611d646807984410e48df073e5210d4f1`:
only 168 was pending in the dry run; the injected duplicate generation raised
the expected primary-key failure; all migration objects and synthetic fixtures
rolled back. Postflight found zero users, classrooms, enrollments and roster
rows, zero migration-168 functions, and unchanged history through 165. This is
failure-path execution evidence. Subsequently the user authorized one clean
168 application to the same isolated local target. Its reviewed checksum and
exact pending-only-168 dry run were rechecked; `supabase db push --local`
succeeded and history now includes 168 with the expected name. The database
gate remains false. No production or shared local schema was changed.

The following checks passed against that schema:

- Membership lifecycle SQL and both directions of the two-session source-lock
  barrier (`check-pal-membership-database.sh`).
- Existing classroom archive and compaction database contracts.
- Existing student-removal/archive SQL fixture in both roster primary-key orders.
- Existing standalone Gradebook contract, including archive round trip.
- Full canonical archive recovery drill: 44-resource manifest, seven
  representative rows, file-byte verification and four idempotent replays.
- Public ownership graph/primary-key audit, warning-level database lint,
  generated public types and type-drift check.

These prove source-write exclusion and normal removal ordering, not a production
rollout or full concurrent writer-between-statements migration rehearsal.
An obsolete `check-classroom-archive-restore-database.sh` fixture stopped at its
reference to the retired `quizzes` table; current CI does not run it. Verification
used the current compaction, removal/archive and full recovery contracts above.
The old migration-replay quiz harness was not run because its additional
database creation/migration/deletion sequence is outside this local approval.

Pre-application independent source review used Sol/high for security and
Terra/high for compatibility against `9eee7313`. Both identified the unlocked
backfill window; Sol also identified missing transaction atomicity. One batched
correction adds both protections, red-first source-order tests, a rollback
rehearsal and lock-barrier coverage. Database execution subsequently passed.

Targeted Sol/high re-review cleared both findings at implementation commit
`a553bf8ce0502ff5059e918a3a917803a3db446f`, with no new actionable defects.
Local focused verification passed 113 tests plus architecture, UI/design policy,
TypeScript and lint again after the generated RPC and adapter removal.
Review usage at that checkpoint: three launches, one full wave, one targeted
wave, one fix batch.
The user approved a final Sol/high review extension and disposable CI schema
replay/reset tests. Final cumulative review cleared `6d150f91` with no findings.
The first ready-event CI run (`34705814298`) then exposed an existing test
fixture that reinserted a removed enrollment UUID between its two grade-race
cases. The new identity guard correctly rejected that closed generation. The
failure reproduced locally before changing the fixture to use a fresh default
enrollment UUID for each case. The test harness now accepts only the existing
`pika` project or the explicitly named isolated `pika-pal-phase1` project, with
matching container name and label checks. Product source and migration 168 are
unchanged by this correction. PR #1253 was returned to draft before correction;
targeted Terra/high review cleared it at `15a6566e`. CI also exposed the missing
166/167 sequence, now supplied by the reviewed prerequisite branch. Five review
launches and two remediation batches are complete; the user approved one more
Sol/high integration pass capped at 20 minutes after the prerequisite lands.
