# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-08-04 — Verified draft hot-archive purge replacement

**Risk profile:** runtime-platform — irreversible classroom deletion,
concurrency, managed Storage ownership, and migration safety.

**Completed:**
- Reconciled existing managed-cleanup and archive-compaction concurrency
  fixtures with migration 118's fail-fast lifecycle lock and retry contract.
- Hardened the rollback-only purge fixture to simulate provider-side object
  resurrection without weakening Supabase Storage ownership or app-role access.
- Kept PR #968 draft, PR #963 unchanged, rollout gates disabled, and migration
  118 unapplied by this remediation.

**Validation:**
- Exact-head CI run 30952362597 passed Architecture Database Contracts, Test &
  Build, Browser Experience Matrix, and Vercel at `ab4ce5f6`.
- Pika audit, shell syntax, diff checks, and 27 focused tests pass.
- Targeted security/concurrency and final cumulative integration reviews found
  no P0/P1 or merge-blocking findings.

**Remaining:**
- Keep migration 118 and deletion disabled until separately authorized rollout
  and canary verification. Cold archives and individual-student purge remain
  follow-up scopes.

## 2026-08-04 — Complete native Pal shell integration

**Risk profile:** runtime-platform — authenticated learner scope, external
widget runtime, and persistent classroom shell behavior.

**Completed:**
- Moved the single student-only `PalProvider` into the persistent authenticated
  classroom layout so the roadmap, companion, and reward surfaces share one
  learner snapshot across classroom and tab navigation.
- Kept teachers and invalid/disabled Pal configurations outside the provider;
  optional widget failures remain contained without taking down academic pages.
- Rotated the Pal client and its token cache whenever the opaque authenticated
  scope changes, and cached learner read tokens only until their server-issued
  expiry enters the safe refresh window.
- Added bounded server-side per-learner token reuse, in-flight coalescing, and
  module-shared mint-start backoff so a browser-cache bypass cannot fan out
  privileged Pal mint calls, including failure and short-token paths.
- Kept the native achievement roadmap in Pika's Achievements tab and suppressed
  the ambient companion and reward modal while the student Tests surface is
  active, including Pika's History API tab transitions.
- Published and registry-verified `@codepet/pal-widget@0.1.0-alpha.2`, then
  replaced the temporary package tarball with the exact immutable npm version
  and its integrity-pinned lockfile entry.

**Validation:**
- Full Vitest suite: 467 files / 4,044 tests.
- TypeScript, architecture policy, UI policy, production build, and diff checks
  pass against the registry-installed `0.1.0-alpha.2` package.
- Live local Pika-to-Pal flow returned a same-origin learner read token, fetched
  the cross-origin learner snapshot, and rendered the canonical cat-on-grass
  companion with no iframe.
- Playwright inspection passed for the authenticated student surface at
  desktop/mobile and light/dark viewports. Component coverage verifies the
  native roadmap, host-owned reward modal, retry containment, scope rotation,
  and Tests-tab ambient suppression.

**Remaining:**
- Push the token-burst review remediation to PR #966, then require exact-head
  CI and final independent confirmation before merge.

## 2026-08-04 — Add managed archive binding compatibility

**Risk profile:** runtime-platform — production archive metadata compatibility,
managed Storage reconciliation, and irreversible deletion migration lineage.

**Completed:**
- Added migration 118's narrow compatibility exception so legacy verified
  classroom archives can receive one deterministic managed-object identity
  without permitting any other archive metadata change.
- Required an exact archive operation, classroom owner, bucket/path, purpose,
  checksum, byte size, and compatibility-mode match under the managed-storage
  protocol lock, using canonical operation-before-object lock ordering.
- Resequenced the unapplied hot-archive deletion migration from 118 to 119 and
  updated its tests, fixtures, documentation, lint, and lineage checks.
- Kept production and the shared local Supabase database unchanged.

**Validation:**
- An isolated local 001–119 replay, database lint, generated-type check,
  managed-storage readiness/concurrency fixture, and destructive purge fixture
  all pass.
- Focused migration tests pass (2 files / 9 tests); migration lineage,
  migration-119 function lint, shell syntax, and diff checks pass.

**Remaining:**
- Review and merge the compatibility change before requesting fresh,
  exact-migration authorization for any production application. Migration 119
  and all deletion rollout gates remain unapplied and disabled.

## 2026-08-05 — Apply archive binding compatibility to production

**Risk profile:** runtime-platform — production trigger compatibility for
managed archive ownership reconciliation.

**Completed:**
- Verified the dedicated worktree was linked to the active production Pika
  Supabase project and that remote migration history matched locally through
  migration 117.
- Temporarily excluded migration 119, dry-ran an exact migration-118-only push,
  and applied `118_managed_storage_archive_binding_compatibility.sql` once under
  fresh target-specific authorization.
- Restored migration 119 to the worktree without applying it.

**Validation:**
- Production migration history now matches locally through 118 and reports 119
  as local-only.
- Managed storage remains in `compatibility` mode. No reconciliation, cleanup,
  enforcement activation, purge rollout, or classroom deletion was performed.

**Remaining:**
- Obtain separate authorization before any production reconciliation or other
  write. Migration 119 and classroom deletion remain unapplied and disabled.

## 2026-08-05 — Preflight production managed Storage ownership

**Risk profile:** read-only production inventory — managed Storage ownership
classification and reconciliation readiness.

**Completed:**
- Ran a linked-project SQL preflight inside an explicit read-only transaction;
  no registration, reference reconciliation, readiness refresh, cleanup,
  enforcement activation, migration 119 application, or deletion occurred.
- Classified all 219 objects in managed buckets using exact relational,
  operational, and embedded JSON evidence without reporting raw paths or IDs.

**Validation:**
- 159 objects map to two Classrooms through either live data or operational
  cleanup evidence: 122 submission images, 36 test documents, and one archive.
- Subsequent fail-safe reconciliation separated those into 139 live objects
  and 20 cleanup-ledger-only objects; cleanup evidence is ownership evidence
  but deliberately is not a live reference under migration 117.
- 60 objects are unreferenced: 41 submission images and 19 test documents.
- No object maps to a Blueprint, multiple owners, or an unknown operational
  owner; no referenced object is missing from Storage.
- No conflicting archive, cleanup, grading, or Blueprint operation is active.
- Production remains in compatibility mode at readiness generation 0 with no
  readiness run. The earlier generation-1 observation came from the shared
  local URL and is superseded by this linked-project result.

**Remaining:**
- Under separate authorization, register and bind the 139 live Classroom
  objects. Separately resolve or delete the 20 cleanup-only and 60 unreferenced
  beta objects before readiness can pass. Keep migration 119 and deletion
  rollout disabled.

## 2026-08-05 — Roll back overbroad production reconciliation

**Risk profile:** production write — managed ownership registration and exact
reference binding, protected by atomic fail-safe verification.

**Completed:**
- Attempted the authorized 159-object atomic reconciliation with protocol
  locking, exact inventory assertions, deterministic identities, and final
  reference verification.
- The first pass rejected two operational submission images that had no live
  Assignment Doc; the corrected pass reached final verification but rejected
  20 objects that were attributable only through cleanup ledgers.
- Confirmed migration 117 intentionally excludes cleanup ledgers from live
  reference authority. Registering those objects as `ready` would create
  ownerless managed objects and prevent readiness.

**Validation:**
- Every attempted write transaction rolled back. A linked-project read-only
  check confirms production still has zero managed objects and zero managed
  JSON references, remains in compatibility mode, and remains at readiness
  generation 0.
- The corrected live set is 139 objects: 120 submission images, 18 test
  documents, and one Classroom archive. The non-live set is 20 cleanup-only
  objects plus 60 completely unreferenced objects.

**Remaining:**
- Obtain fresh authorization for a 139-live-object registration/reconciliation.
  Handle the 80 non-live beta objects only under a separate cleanup/deletion
  authorization. Do not apply migration 119 or enable deletion.

## 2026-08-05 — Reconcile production live managed Storage

**Risk profile:** production write — managed ownership registration and exact
relational/embedded reference binding.

**Completed:**
- Under revised exact authorization, atomically registered the 139 live
  Classroom-owned objects across two Classrooms: 120 submission images, 18 test
  documents, and one verified Classroom archive.
- Bound 24 relational/operational rows and rebuilt 274 embedded JSON reference
  rows. Migration 118 permitted the archive operation and immutable archive row
  to receive the same deterministic managed identity.
- Left all 20 cleanup-only and 60 unreferenced Storage objects unregistered and
  untouched.

**Validation:**
- Read-only post-commit verification found 139 managed objects, all `ready` and
  all live-referenced; 274 JSON references; one exact archive binding; and 80
  Storage objects without registry entries.
- The 20 remaining raw relational paths are the intentionally untouched
  cleanup-only set. Production remains in compatibility mode at readiness
  generation 0.
- Migration 119 remains unapplied and `classroom_purge_settings` is absent, so
  deletion is not enabled.
- A linked read-only breakdown identified the cleanup-only set as two PNG
  submission images and 18 HTML test snapshots from one completed Classroom
  archive compaction. All 20 remain pending in the archive source-cleanup
  ledger. The unreferenced set is 41 JPEG/PNG submission images and 19 HTML
  test snapshots with no current relational, JSON, Blueprint, or operational
  reference. Together the non-live set uses about 7.27 MB.

**Remaining:**
- Decide how to dispose of the 20 cleanup-only and 60 unreferenced beta files
  under separate deletion authorization, then refresh readiness separately.

## 2026-08-05 — Remove authorized non-live production Storage objects

**Risk profile:** irreversible production write — exact-object Storage deletion
and terminal cleanup-ledger reconciliation.

**Completed:**
- Froze and revalidated the previously approved 20 cleanup-only and 60 fully
  unreferenced beta objects. Both aggregate identity digests matched the prior
  read-only inventory before any deletion began.
- Ran a validation-only pass across all 80 objects, then removed each object
  individually through the Storage API after a fresh exact reference check.
- Verified the 20 cleanup-only objects against their recorded size and SHA-256
  before removal and reconciled every matching source-cleanup ledger to terminal
  `deleted` state.
- Exercised the persisted-manifest retry path after two fail-closed pauses; the
  pauses were caused by single-statement CTE visibility in the operator's success
  check, not by reference or ownership drift.

**Validation:**
- Independent linked-project verification reports 139 Storage objects and 139
  managed objects, all `ready`, with zero ownerless objects and zero registered
  objects missing Storage.
- The 274 managed JSON references remain intact. All 20 source-cleanup ledgers
  are terminal and none are nonterminal.
- Production remains in compatibility mode at readiness generation 0. Migrations
  117 and 118 are applied; migration 119 is unapplied and
  `classroom_purge_settings` remains absent.

**Remaining:**
- Refresh readiness only under separate production authorization. Do not apply
  migration 119 or enable classroom deletion without fresh exact authorization.

## 2026-08-05 — Refresh production managed Storage readiness

**Risk profile:** production write — serialized readiness evidence refresh only.

**Completed:**
- Verified the production boundary before mutation: 139 managed/Storage objects,
  all ready; 274 JSON references; zero ownerless or missing objects; zero raw
  identity gaps; and no active archive or cleanup operation.
- Ran the guarded production readiness refresh exactly once with the required
  target-specific acknowledgement.

**Validation:**
- Generation 1 completed `ready` with zero findings, 139 objects, 274 references,
  and inventory digest
  `33ce478050e9220414d3192e2aa4843b9f32c2cfe7d3838bd5be0f7c5f16f775`.
- Independent persisted-state verification found writer revision 842 on both the
  readiness run and singleton settings, with matching digest evidence.
- Production remains in compatibility mode and is not activated. Migration 119
  remains unapplied and `classroom_purge_settings` remains absent.

**Remaining:**
- Decide separately whether to activate managed Storage enforcement. Activation,
  migration 119, generic cleanup, and classroom deletion each remain separately
  gated production changes.

## 2026-08-05 — Activate production managed Storage enforcement

**Risk profile:** production write — managed Storage protocol activation only.

**Completed:**
- Revalidated generation 1 immediately before activation: readiness/run/settings
  digest matched, the persisted and current writer revisions were all 842, no
  archive or cleanup operation was active, and migration 119 was absent.
- Ran the guarded production activation command exactly once using the authorized
  generation and inventory digest.

**Validation:**
- Production settings now persist mode `enforced`, generation 1, the verified
  digest, writer revision 842, and a non-null activation timestamp.
- All 139 managed objects remain `ready`; all 139 Storage objects and 274 JSON
  references remain intact, with zero ownerless or missing objects.
- Migration 119 remains unapplied and `classroom_purge_settings` remains absent.
  Generic cleanup and classroom deletion were not enabled.

**Remaining:**
- Verify representative production writers under enforcement before considering
  migration 119. Applying migration 119, generic cleanup, and classroom deletion
  remain separately gated changes.

## 2026-08-05 — Verify production managed Storage writers under enforcement

**Risk profile:** bounded production smoke writes using synthetic teacher/student
accounts; no migration, cleanup, or deletion activation.

**Completed:**
- Created a synthetic Classroom, allowlisted and enrolled a synthetic student,
  uploaded one teacher PDF to a Test, and submitted one student image artifact.
- Saved the Classroom as Course Blueprint
  `c318ef23-5039-4b64-9977-66bceee54ba0`, instantiated Classroom
  `7979c0fd-44ae-4c08-a430-39cf432b48fa` from that Blueprint, and hot archived
  the copy.
- Verified the deployment export gate remains disabled, then invoked the exact
  deployed archive writer implementation for the authorized synthetic Classroom.
  Archive operation `18ff7d6f-84ee-49c9-ab7e-e065b4f8391b` completed and
  produced a verified, Classroom-owned `classroom-archives` object.
- Captured and visually inspected teacher/student desktop/mobile production UI.
  Teacher archive controls and student submitted-artifact surfaces rendered
  correctly; permanent deletion remained absent.

**Validation:**
- The five new managed objects cover teacher test material, student assignment
  artifact, Classroom-to-Blueprint copy, Blueprint-to-Classroom copy, and
  Classroom archive creation. All use distinct managed identities and exact
  owner bindings; matching Storage bytes and JSON/relational references exist.
- Production now contains 144 managed objects and 144 managed-bucket Storage
  objects, all `ready`: zero ownerless Storage, missing Storage, ownerless
  identities, unreferenced ready objects, raw references lacking managed IDs,
  or active operations.
- The Blueprint and both user accounts remain intact. The copy remains hot
  archived (no cold tombstone) for a future deletion canary.
- Migration 119 remains unapplied. Generic cleanup and Classroom deletion remain
  disabled. Readiness generation 1 remains the activation evidence; writer
  growth after activation is expected under the enforced protocol.

**Remaining:**
- Decide separately whether to apply exact migration
  `119_hot_archived_classroom_purge_managed_ownership.sql` to production. Do not
  enable generic cleanup or Classroom deletion without separate authorization.

## 2026-08-05 — Apply production hot-archive purge schema

**Risk profile:** irreversible production schema installation; rollout and
execution remained disabled.

**Completed:**
- Verified production project `zhioqbapgfcrronyuidm`, migration history through
  118, migration 119 checksum, focused tests, managed-storage lineage, and
  PostgreSQL function lint.
- The linked dry run contained only
  `119_hot_archived_classroom_purge_managed_ownership.sql`.
- Applied migration 119 exactly once through `supabase db push --linked` under
  exact production authorization.

**Validation:**
- Remote migration history now records 119.
- `classroom_purge_settings.rollout_mode` is `disabled`; canary teacher and
  Classroom IDs are null.
- Managed Storage remains `enforced` with 144/144 objects `ready`; no purge or
  cleanup operation is active.
- The synthetic hot-archived Classroom, reusable Blueprint, and verified archive
  remain intact. No purge, generic cleanup, or Storage deletion ran.

**Remaining:**
- Treat Classroom deletion activation and any first purge canary as separate
  production decisions requiring fresh target-specific authorization.

## 2026-08-05 — Enable and verify exact production purge canary

**Risk profile:** production rollout-gate write only; no purge or cleanup.

**Completed:**
- Revalidated the synthetic target as teacher-owned, hot archived, not cold
  archived, conflict-free, and without any prior purge operation.
- Atomically changed `classroom_purge_settings` from `disabled` to `canary` only
  for teacher `34bd4439-e552-483b-b8aa-e3a8f86009af` and Classroom
  `7979c0fd-44ae-4c08-a430-39cf432b48fa`.
- Opened the production impact dialog without entering confirmation or invoking
  any destructive endpoint.

**Validation:**
- Impact summary reports 0 students, 104 relational records, and two managed
  files / 36 KB: one test document and one verified Classroom archive. Both
  files are present; no Gradex extract, interrupted upload, or conflicting
  operation exists.
- Teacher desktop/light and mobile/dark show exactly one canary action, the full
  irreversible warning, Blueprint/user preservation text, typed-confirmation
  requirement, and a disabled destructive button.
- Student desktop/dark and mobile/light show neither the archived canary nor a
  deletion action; the teacher purge endpoint returns 403 for the student.
- Final read-only state has zero purge operations, zero active generic cleanup,
  144 managed objects all `ready`, and the hot Classroom and Blueprint intact.

**Remaining:**
- The first irreversible production canary purge requires separate exact
  authorization. Broader rollout and generic cleanup remain disabled.

## 2026-08-05 — Complete first production hot-archive purge canary

**Risk profile:** irreversible production deletion of one exact synthetic
hot-archived Classroom.

**Completed:**
- Revalidated the exact canary inventory and rollout binding immediately before
  deletion: no conflict or prior operation, 104 relational records, one test
  document, and one verified Classroom archive totaling 36 KB.
- Used the production teacher UI, typed `DELETE`, and started purge operation
  `e7b434d0-a6b0-4192-b3cb-a50e39985c92`.
- The durable worker deleted both exact managed objects and finalized on the
  first operation attempt with no failed file or retry.

**Validation:**
- The completed audit records 104 relational rows and two files deleted; both
  object paths are redacted, both hashed identities remain reserved, and no
  purged Storage object has reappeared.
- The Classroom, its archive/operation rows, its managed identities, the purge
  resource snapshot, and its fence are gone. No cold tombstone was created.
- Course Blueprint `c318ef23-5039-4b64-9977-66bceee54ba0`, its managed test
  file, both synthetic users, and original Classroom
  `1da6bdef-d231-47d2-90ce-c3675c3afcff` remain intact.
- Global managed inventory is 142 ready registry objects and 142 Storage
  objects, with zero ownerless or missing objects and zero generic cleanup work.
- Teacher desktop/light and mobile/dark show no archived canary; teacher GET is
  404. Student desktop/dark and mobile/light remain isolated; teacher endpoint
  access is 403. Visual verification passed.

**Remaining:**
- The rollout row still points in `canary` mode to the deleted Classroom, which
  enables no remaining Classroom. Disabling that stale row or selecting a new
  canary/broader rollout requires fresh authorization. Generic cleanup remains
  disabled.

## 2026-08-05 — Complete student/artifact production purge canary

**Risk profile:** irreversible production deletion of one exact synthetic
hot-archived Classroom with a student, assignment artifact, and test material.

**Completed:**
- Archived synthetic Classroom `1da6bdef-d231-47d2-90ce-c3675c3afcff` through
  the teacher UI and atomically retargeted the existing exact canary gate.
- Revalidated no conflict or prior purge and an impact of one student, 106
  relational records, and two ready managed files / 114,179 bytes.
- Used the production teacher UI, typed `DELETE`, and completed durable purge
  operation `afb8e6aa-e36a-4196-9e7e-49d5ab57da99` on its first attempt.

**Validation:**
- The audit records 106 relational rows and two files deleted: one
  `assignment-artifacts` object and one `test-documents` object. Both paths are
  redacted, both hashed identities are absent from Storage, and neither object
  reappeared.
- The Classroom, enrollment, roster, assignment/document/artifact, test, 96
  class days, archive state, managed ownership, purge resources, and purge fence
  are absent.
- Course Blueprint `c318ef23-5039-4b64-9977-66bceee54ba0`, its managed file,
  and both synthetic user accounts remain intact.
- Global inventory is 140 ready registry objects and 140 Storage objects, with
  zero ownerless, missing, unregistered, or generic-cleanup objects. The 20
  historical archive-source cleanup ledgers remain terminal `deleted`.
- Teacher and student desktop/mobile light/dark boundaries passed before and
  after deletion. Teacher GET is 404 after deletion; student access remains 403.

**Remaining:**
- The exact canary row points to the now-deleted Classroom and therefore enables
  no remaining Classroom. Broader rollout and generic cleanup remain disabled.

## 2026-08-05 — Record managed Blueprint lifecycle follow-up

- Added a separate failing feature for durable Blueprint deletion with managed
  files; no Blueprint deletion implementation was added to the Classroom purge
  reconciliation patch.
- The acceptance sequence first creates and verifies a Classroom from preserved
  canary Blueprint `c318ef23-5039-4b64-9977-66bceee54ba0`, then exercises the
  future Blueprint purge so preservation and deletion are independently proven.

## 2026-08-05 — Validate production-reconciliation patch

- Full Vitest passed: 468 files and 4,047 tests. Production build, lint,
  TypeScript, Pika audit, focused migration/server tests, migration lineage,
  migration-118 function lint, feature validation, shell syntax, and diff checks
  also passed.
- The shared local database currently lacks the managed-storage/purge schema, so
  database fixtures stopped before mutation on missing migration-117/119
  objects. No reset or migration application was performed. Disposable CI must
  replay 001–119 and pass both database fixtures before merge.

## 2026-08-05 — Preserve merged migration 118 during reconciliation

- Independent review found that replacing merged migration version 118 would
  break databases that had already applied `main`: they would skip the new 118
  and fail when the non-idempotent purge DDL moved to 119.
- Restored the merged purge migration 118 byte-for-byte, hash-locked it, and
  appended archive-binding compatibility as migration 119. Current clean replay
  therefore exercises the real upgrade order, and the managed-storage database
  fixture proves the legacy binding after that upgrade.
- Verified production already has the equivalent final schemas recorded as
  versions 118 and 119 under its separately authorized reconciliation history;
  this source correction performed no remote migration or state change.

## 2026-08-05 — Prove post-purge Blueprint reuse in production

**Risk profile:** exact synthetic production create/archive/purge canary; no
broader rollout, generic cleanup, migration, or Blueprint deletion.

**Completed:**
- Created Classroom `362b444c-ec43-4f33-bdc5-47d957c4bcc0` named
  `Post-Purge Blueprint Reuse Canary` from preserved Blueprint
  `c318ef23-5039-4b64-9977-66bceee54ba0` through the teacher UI.
- Verified 96 class days, one assignment, one test and document, and distinct
  ready Classroom-owned managed object
  `dfffde84-1b21-502e-8b30-167d4fe4de79` (14,760 bytes).
- Hot archived the Classroom, conditionally retargeted only the existing
  synthetic canary binding, typed `DELETE`, and completed durable purge
  operation `c40b3f5d-865f-4997-8046-c780eb77b401` in one tick.

**Validation:**
- The impact summary reported 0 students, 102 relational rows, and one 15 KB
  managed file, with no missing file or conflicting operation.
- The Classroom and its managed object are absent; the audit object is terminal
  `deleted`, its path is redacted, and the purge resource snapshot is empty.
- The instantiate operation remains completed with Blueprint lineage preserved
  and deleted Classroom references reconciled to null.
- The Blueprint still has one assignment, one assessment, one Version, and its
  original ready 14,760-byte managed PDF in Storage. Teacher and student
  accounts remain.
- Global managed state returned from 141/141 to 140/140, with zero non-ready,
  missing, or unregistered objects.
- Teacher/student desktop/mobile light/dark verification passed before and
  after deletion. The teacher sees the preserved Blueprint test/PDF; the
  student sees `Classroom unavailable` for the purged Classroom.

**Remaining:**
- The exact canary row points to the deleted Classroom and enables no remaining
  Classroom. Global rollout and generic cleanup are still disabled.
- Durable teacher-owned Blueprint/managed-file deletion remains the next local
  implementation scope. Production migration or Blueprint deletion needs fresh
  exact authorization.

## 2026-08-05 — Implement durable Course Blueprint deletion locally

**Contract:**
- Owning teachers may permanently delete only Pika-managed Course Blueprints.
  Deletion removes the draft graph, immutable Versions, planned course site,
  proposals/sessions, audit identifiers, and exact Blueprint-owned
  `test-documents` objects.
- Linked Classrooms, their independently copied files and student data, all
  users, and unrelated Blueprints remain. Linked Classrooms and artifact rows
  are explicitly unlinked from the deleted Blueprint/Versions.

**Implementation:**
- Added unapplied migration 120 with an independent disabled rollout gate,
  durable operation/fence/object ledgers, exact-object leases, retries,
  storage-absence and reappearance checks, raw-path redaction/reservation,
  explicit graph finalization, and fail-closed direct root deletion.
- Added Blueprint/Version-lineage, managed-object, provisional-copy, and
  Storage fences. Blueprint-to-Classroom copies now establish a source-aware
  provisional intent before provider work, with a safe pre-120 fallback.
- Added owner-scoped purge APIs, typed impact/confirmation validation, a
  resumable worker and cron safety net, and a Blueprint deletion dialog that
  states the irreversible scope and preserved Classroom/user boundary.
- Added a transactional database fixture covering authorization, active
  operation conflicts, concurrency fences, provider failure/retry, exact file
  cleanup, path reappearance, explicit database finalization, Classroom/user
  preservation, and durable audit evidence. The fixture is authored but not run
  because migration 120 has not been authorized for local replay.
- Documented the contract and staged rollout in
  `docs/guidance/course-blueprint-purge.md`.

**Validation:**
- Full Vitest, production build, lint, TypeScript, Pika audit, shell syntax,
  static migration contracts, focused server/API/UI tests, and diff checks
  pass after updating the cleanup-cron mocks for the new safety net.
- Teacher UI verified at 1440×1000 and 390×844 with a read-only intercepted
  impact response. Confirmation remains disabled until the exact title or
  `DELETE`; the mobile dialog scrolls to reachable actions. Student purge API
  access returned 403 and `/teacher/blueprints` redirected to Classrooms.
- No migration 120 replay, local reset, remote mutation, rollout activation, or
  Blueprint deletion occurred.

**Remaining:**
- Obtain exact authorization to reset local Supabase, replay 001–120,
  regenerate types, reseed, and run the destructive transactional database
  fixture. Keep all remote rollout gates disabled.

## 2026-08-05 — Verify Course Blueprint purge on clean local replay

**Completed:**
- Reset local Supabase and replayed migrations 001–120 from the dedicated
  worktree, regenerated database types, and reseeded against loopback Supabase.
- Corrected migration-120 PL/pgSQL row selection, made the polymorphic Blueprint
  trigger use table-safe JSON fields, and removed an unnecessary transaction-
  scoped begin bypass that could outlive purge initialization.
- Updated the Blueprint purge fixture to model the Storage API's transaction-
  local delete capability while retaining exact managed-object authority.

**Validation:**
- Managed-storage readiness, activation, Blueprint-adoption, and reference/
  deletion concurrency fixtures pass against `supabase_db_pika`.
- The Blueprint purge database fixture passes authorization, conflict, fence,
  retry, exact Storage deletion, reappearance, finalization, Classroom unlinking
  and preservation, user preservation, and unrelated-Blueprint preservation.
- Migration history is exactly 001–120, generated database types match, seeded
  users remain, and diff/static migration checks pass.
- Local managed Storage is `compatibility`; Classroom purge, Blueprint purge,
  and generic cleanup remain disabled. No staging or production state changed.

## 2026-08-06 — Harden Blueprint purge recovery boundaries

**Review remediation:**
- Active purges are rediscovered before fresh inventory, return their persisted
  impact, and reuse a client-retained operation UUID after a lost start response.
  Pre-migration APIs now fail closed with an intentional 503 instead of a
  generic 500.
- Source-aware Blueprint copies now heartbeat a durable intent and explicitly
  settle it as adopted or aborted after ownership or cleanup is durable.
  Expired abandoned intents no longer block purge forever, while a running
  operation or heartbeat keeps the fence live.
- The confirmation digest now includes each linked Classroom's Blueprint
  Version, source revision, and origin identity, and begin locks those lineage
  rows before sealing inventory.
- A periodic heartbeat now spans individual provider calls, and finalization
  uses a separate Blueprint-owned membership digest so preserved Classroom
  edits cannot strand deletion after Storage cleanup.
- Expanded unit, API, UI, static migration, and transactional database fixtures
  for lost responses, partial deletion, pre-120 compatibility, copy failures,
  intent lifetime, and equal-membership lineage drift.

**Validation and boundary:**
- Focused remediation tests pass (58/58), with TypeScript, focused ESLint,
  shell syntax, feature validation, and diff checks also passing.
- Full Vitest (4,078 tests), lint, and production build pass. Final targeted
  review still found one P1: after a transient heartbeat failure, the current
  timer stops renewing while an in-flight provider call can remain stalled.
  The feature remains failing pending an abortable deadline or durable copy
  operation ledger; no further review-fix batch was taken in this session.
- The changed migration 120 has not been replayed after this review batch;
  fresh exact local-reset authorization is required before database fixture and
  generated-type verification. No staging or production state changed, and all
  deletion/cleanup rollout gates remain disabled.

## 2026-08-06 — Make Blueprint copy fences fail closed

**Implementation:**
- Removed lease expiry from Blueprint purge authorization: every unclosed
  source-copy intent now blocks purge until durable settlement.
- Heartbeats continue after transient failures; a later successful heartbeat
  clears the operational error while the durable intent remains the safety
  boundary throughout provider I/O.
- Added a private, service-role-only hard-crash recovery RPC. It requires the
  exact owner/operation/teacher/source tuple and expiry snapshot, 24 hours of
  staleness, no running operation, no live provisional files, and explicit
  confirmation that no worker remains. Recovery is compare-and-swap and
  idempotent.
- Expanded static, runtime, privilege, stale-intent, exact-snapshot, running-
  operation, and provisional-file reconciliation fixtures.
- Classified heartbeat transport failures as retryable and intent/fence
  rejection as terminal. A single wrapper now checks authority before and after
  every asynchronous copy action so no later reservation, read-back, or
  verification begins after authority is lost.
- Completed-operation retries return the deterministic owner identity and
  idempotently repair lost settlement. Migration 120 also binds and closes only
  legacy adopted owners proven by a matching completed operation and live
  teacher-owned source Blueprint.

**Boundary:**
- Full Vitest (4,083 tests), lint, architecture, production build, Pika audit,
  shell syntax, static migration checks, and final bounded reviews pass.
  Migration 120 has not been replayed after this change; generated types and
  the database fixture still require a fresh authorized local reset. No staging
  or production state changed, and all rollout gates remain disabled.

## 2026-08-06 — Verify revised Blueprint purge on clean local replay

**Risk profile:** runtime-platform — authorized destructive local reset and
schema/Storage concurrency verification only.

**Completed:**
- Verified the target was loopback `127.0.0.1:54321` with the healthy
  `supabase_db_pika` container, then used the one-time authorization to reset
  local Supabase and replay migrations 001–120 including the revised migration
  120.
- Regenerated `database.generated.ts`, reseeded one teacher, two students, one
  Classroom, assignments, tests, grades, and history, and confirmed generated
  types match the replayed schema.
- Passed the managed-storage contract/readiness and multi-session concurrency
  fixtures plus the transactional Course Blueprint purge fixture, including
  fail-closed copy intents and guarded recovery.

**Postconditions:**
- Migration history is exactly 001–120 with no gaps or mismatches. Both purge
  modes are `disabled`; managed Storage is `compatibility`; cleanup/compaction
  environment gates are disabled or unset; no purge operation is active.
- Synthetic fixture users and Storage objects were removed. No staging or
  production state changed, and migration 120 remains local only.

## 2026-08-06 — Prepare verified Blueprint deletion draft

**Risk profile:** workspace-state — publish the already verified feature only.

**Prepared:**
- Reconfirmed this dedicated branch matches current `origin/main`, the complete
  worktree diff is limited to Course Blueprint deletion and its continuity
  metadata, and the Pika audit and diff checks pass.
- Prepared migration 120, the disabled-by-default application/API/UI flow,
  tests, fixtures, and rollout guidance for a separate draft PR. PR #963 and
  all staging and production state remain untouched.

## 2026-08-06 — Reconcile Blueprint deletion CI contracts

**Risk profile:** runtime-platform — test and CI integration only.

**Fixed:**
- Updated the versioned Blueprint database fixture to assert that migration
  120 rejects direct root deletion while preserving the Blueprint and its
  immutable Version. The independent user-account cascade test remains.
- Added the transactional Course Blueprint purge fixture to the Architecture
  Database Contracts job so authorization, fencing, retries, exact Storage
  cleanup, and Classroom/user preservation run in CI.

**Validation:**
- Shell syntax, the versioned Blueprint database contract, and the Course
  Blueprint purge database fixture pass against local `supabase_db_pika`.
- No migration, application runtime, staging, or production state changed.

## 2026-08-07 — Add workflow-friction guardrails

**Risk profile:** workspace-state.

- Updated the E2E coverage and weekly simplification automations to create their
  named task branch before edits when Codex starts them on a detached HEAD, and
  to stop on any unexpected checkout state.
- Added an explicit fallback for the workflow-friction review memory path while
  retaining the configured hub project roots and report-only boundary.
- Made session-log trim and check operations reject empty entries, removed the
  existing empty duplicate heading, and added focused regression coverage.
- Validation passed: focused trim/startup tests (51), full Vitest (468 files,
  4,049 tests), lint, session-log check, TOML parsing, and diff checks.

## 2026-08-07 — Center login password-recovery link

**Risk profile:** none — localized unauthenticated login layout refinement.

**Completed:**
- Moved “Forgot password?” from the password-field edge to a centered row
  between the Login button and Sign up link.
- Preserved the recovery navigation and added the shared minimum target and
  visible keyboard-focus treatment.

**Validation:**
- Focused LoginClient tests, lint, design/UI policy checks, Pika audit, and
  diff checks passed.
- Regenerated and reviewed the affected Playwright desktop light/dark login
  visual-regression baselines; their focused snapshot suite passed.
- Playwright visual verification passed for the unauthenticated desktop/mobile
  login screen in light and dark themes, including default, hover, and focus
  states. Teacher/student authenticated variants are not applicable.

## 2026-08-08 — Rebase Blueprint deletion onto current main

**Risk profile:** runtime-platform — migration and durable deletion integration.

**Completed:**
- Rebased PR #971 onto current `origin/main`, preserving the login recovery and
  AI-continuity guardrail changes added after the initial review.
- Resolved only derived continuity-archive conflicts; application code and
  migration 120 had no merge conflict or numbering collision.
- Kept Course Blueprint deletion rollout disabled and migration 120 unapplied
  outside the existing local development database.

**Validation:**
- Exact-head migration lineage, generated-type parity, shell/workflow syntax,
  147 focused tests, both Blueprint database contracts, feature validation,
  TypeScript, lint, production build, and diff checks pass.
- Fresh cumulative PR review and GitHub CI remain before merge.

## 2026-08-08 — Add immediate Pal event delivery

**Risk profile:** runtime-platform — transactional outbox delivery and learner
state refresh behavior.

**Completed:**
- Added a targeted, two-second post-commit delivery attempt for authenticated
  sessions, classroom joins, qualifying daily logs, first assignment views, and
  assignment completions while preserving the existing durable outbox,
  idempotency, leases, retry backoff, and daily recovery worker.
- Refreshes the mounted Pal provider only after a newly confirmed delivery, so
  achievements and companion reactions can update without waiting for the
  60-second polling fallback.
- Documented the reusable host/provider SaaS boundary and clarified that the
  daily cron owns weekly configuration reconciliation plus delivery recovery,
  not the primary user-action response path.
- Independent review tightened the hard caller deadline across adapter I/O and
  added atomic recovery of expired immediate-delivery leases.

**Validation:**
- Full Vitest passed (473 files, 4,093 tests), plus TypeScript, lint,
  architecture/UI policy checks, production build, and diff checks.

## 2026-08-08 — Harden Pal delivery release readiness

**Risk profile:** runtime-platform — delivery telemetry, PostgreSQL claim
concurrency, outage recovery, and production release evidence.

**Completed:**
- Added privacy-safe structured logs for immediate delivery and daily outbox
  drains, plus protected ready/retry/expired-lease/backlog-age and recent
  delivery-latency metrics.
- Added an ephemeral PostgreSQL concurrency harness proving one claim winner
  for pending and expired batch and targeted claims.
- Added a loopback-only HTTP recovery smoke that persists a 503 retry, restores
  the peer, delivers the queued event once with the same idempotency key, and
  removes its synthetic fixture.
- Closed independent-review gaps by emitting sanitized error-category drain
  telemetry, reserving a 60-second cron execution budget, and replacing timing
  assumptions with database-observed claim and lock contention gates.
- Bounded the complete drain path across claims, delivery transitions, and the
  final count, and made ready-backlog age use the actual retry/lease-ready time.
- Classified both direct and PostgREST-wrapped abort/timeout failures as the
  sanitized `deadline` drain outcome.
- Confirmed read-only that the current production adapter is enabled and has
  delivered events; no Pal code, Pal PR #50, migration, or production data was
  changed by the readiness implementation.

**Validation:**
- Full Vitest passed (475 files, 4,101 tests), plus TypeScript, lint,
  architecture/design/UI policy checks, Pika audit, production build, both
  real-database/HTTP Pal harnesses, continuity validation, and diff checks.

## 2026-08-08 — Install production Blueprint purge schema

**Risk profile:** irreversible production schema installation; rollout and
execution remained disabled.

**Completed:**
- Verified the dedicated worktree at merged `main`, the hub-linked production
  Pika project, migration history through 119, migration 120 static checks, and
  the managed-storage lineage.
- Confirmed the linked dry run contained only
  `120_course_blueprint_purge_managed_ownership.sql`.
- Applied migration 120 exactly once through `supabase db push --linked` under
  exact production authorization.

**Validation:**
- Production migration history now records 120.
- `course_blueprint_purge_settings.rollout_mode` is `disabled`; canary teacher
  and Blueprint IDs are null, and no Blueprint purge operation exists.
- No purge, managed-storage cleanup, rollout activation, or Storage deletion
  ran. Enabling a canary remains a separate production decision.

## 2026-08-08 — Complete managed deletion production rollout

**Risk profile:** irreversible production deletion availability with fail-closed
authorization, ownership, operation-conflict, and managed-storage gates.

**Completed:**
- Ran successful production canaries for managed Course Blueprint deletion and
  hot archived Classroom deletion, preserving linked Classrooms, reusable
  Classroom-owned files, and user accounts where required.
- Enabled permanent deletion broadly for eligible teacher-owned Pika Course
  Blueprints and hot archived Classrooms. Cold archives and comprehensive
  individual-student purging remain separate follow-up scopes.
- Refreshed the protected synthetic verification credentials after invalidating
  a diagnostic-output exposure; no real-user credentials were affected.

**Validation:**
- Production migration history matches local migrations 001–120, and managed
  storage remains enforced at protocol version 2.
- All three current hot archived Classrooms and both current Course Blueprints
  report deletion available, with zero active purge operations or conflicts.
- Managed Storage reconciles at 140 registered/140 stored objects with no
  missing, unregistered, interrupted, or active-cleanup objects.
- Desktop/mobile teacher and student boundaries passed; non-owner teacher
  access returned 404 and student access returned 403. No purge was started by
  either broad rollout action.

## 2026-08-08 — Add accessible student test flag toggles

**Risk profile:** exam-mode — student test-taking interaction and lock behavior.

**Completed:**
- Exposed each `StudentTestForm` question flag heading as a named toggle with
  `aria-pressed`, plus `aria-disabled` and removed tab stops while interaction
  is locked.
- Preserved the existing heading-sized target, visual treatment, localStorage
  contract, and single-toggle Enter/Space behavior.
- Added component coverage for pointer round trips, Enter, Space, accessible
  naming, initial/updated pressed state, persistence, and locked behavior.

**Validation:**
- Focused `StudentTestForm` component tests, TypeScript, lint, architecture,
  UI/design policy checks, Pika audit, and `git diff --check` passed.
- Playwright visual verification passed for the student form in desktop/mobile,
  light/dark, flagged/unflagged, and keyboard-focus states; teacher was not
  applicable.

## 2026-08-08 — Audit remaining managed deletion scopes

**Risk profile:** runtime-platform — irreversible cold recovery loss,
cross-Classroom student lineage, managed Storage, and durable purge recovery.

**Audited:**
- Created dedicated worktree `codex/remaining-deletion-scopes`, completed the
  session-start workflow, and verified the local read-only schema is exactly at
  migrations 001–120.
- Traced cold tombstones, immutable archives, restore/compaction operations,
  Gradex extracts, managed ownership/cleanup leases, hot/Blueprint purge
  fences, and the complete Classroom resource graph.
- Traced Classroom-scoped student rows, embedded JSON/provenance, managed
  student files, existing partial roster removal, account-level data, Pal
  ledgers, and cross-Classroom preservation boundaries.

**Recommendation:**
- Add privacy-safe read-only deletion health monitoring first, then implement
  cold-Classroom purge and Classroom-scoped individual-student purge as
  separate migrations and PRs with independent rollout gates.
- Keep generic orphan cleanup disabled; neither purge scope depends on it.
- Require cold archives to be restored before individual-student purge; do not
  rewrite immutable archive bundles or erase user accounts/other Classrooms.

**Boundary:**
- No implementation, migration application, local reset, rollout change,
  production query, purge, or Storage deletion was performed. PR #963 remains
  closed and untouched. Awaiting approval of the scope and sequencing package.

## 2026-08-08 — Add managed deletion health monitoring baseline

**Risk profile:** runtime-platform — read-only production health aggregation
across irreversible purge ledgers and managed-storage ownership.

**Completed:**
- Added migration 121 with a service-role-only, aggregate RPC for hot
  Classroom and Course Blueprint purge failures/stalls, fence/lease drift,
  deleted-object reappearance, and managed-storage ownership/reference drift.
- Added an exact Zod response boundary, code-first missing-schema compatibility,
  privacy-safe structured counts, and sanitized probe failures.
- Integrated the probe after successful work in the existing authenticated
  daily cleanup cron. Critical findings return 503; warning-only findings remain
  observable without granting cleanup authority.
- After the initial independent review of PR #980, moved recursive JSON/history
  reconciliation out of the daily path into a separate unscheduled,
  service-role-only diagnostic; added payload UUID/digest mismatch detection and
  made every dependency error except the exact missing-RPC signal fail closed.
  A targeted follow-up made evidence reconciliation registry-driven so removing
  a payload's final managed reference cannot hide the stale registry row.
- Documented operator response and staged rollout. Generic orphan cleanup stays
  disabled, and no additional cron schedule or deletion capability was added.

**Validation:**
- Full Vitest passed (478 files, 4,128 tests), plus focused monitoring/migration
  tests, TypeScript, lint, architecture boundaries, managed-storage
  lineage, hot-Classroom purge SQL lint, production build, and diff checks.
- After separate exact authorization, the dry run previewed only migration 121
  and it was applied once to the dedicated local Supabase database. Rollback-only
  database fixtures proved read-only/service-role/privacy boundaries, warning
  and critical findings, partial/lease/reappearance detection, eight concurrent
  readers, and a 1,000-object runtime of 9–34 ms with 6,265 shared-buffer hits.
- The originally authorized local application predates the review correction;
  that one-time permission was not reused. Final generated types and the revised
  rollback fixture are gated on PR CI's fresh ephemeral migration replay. No reset, remote migration,
  rollout change, production query, purge, or persistent Storage deletion was
  performed; the temporary helper and all fixtures were removed. No UI changed,
  so visual verification was not applicable.

## 2026-08-09 — Deploy managed deletion health monitoring

**Risk profile:** runtime-platform — production schema activation, daily cron
monitoring, and managed-storage health visibility.

**Completed:**
- Merged `main` into protected `production` through PR #981 after the full CI,
  database-contract, build, and browser matrix passed; Vercel confirmed
  production commit `64e8a22a` deployed.
- Verified the linked production Supabase project had migrations 001–120 and
  that the dry run contained only `121_managed_deletion_health_monitoring.sql`,
  then applied migration 121 once under exact production authorization.
- Kept generic orphan cleanup disabled and did not invoke a purge, retry,
  cleanup route, rollout gate, Storage deletion, or the deep JSON diagnostic.

**Validation:**
- Production migration history now records 001–121.
- The lightweight service-role aggregate RPC returned HTTP 200 with
  `healthy: true`, zero critical findings, zero warnings, and zero managed
  storage or purge-protocol drift; anonymous invocation was denied with 401.
- The production worktree is clean and synchronized with `origin/production`.

## 2026-08-09 — Implement cold-archived Classroom permanent deletion

**Risk profile:** runtime-platform — irreversible cold recovery loss, teacher
authorization, exact managed Storage ownership, concurrency, and resumability.

**Completed:**
- Added independent, disabled-by-default cold-Classroom deletion using the
  existing managed-deletion operation ledger, fences, leases, retries, and
  monitoring; hot-Classroom and Blueprint purge behavior remains separate.
- Bound every operation to one teacher-owned cold archive, prioritizing the
  authoritative recovery bundle last, and preserved user accounts, reusable
  Blueprints, other Classrooms/archives, and their managed files.
- Added fail-closed teacher APIs, conflict/readiness checks, resumable cron
  ticking without a new schedule, audit-safe resource hashes, and irreversible
  confirmation UX. Generic orphan cleanup remains disabled.
- Independent high-risk review caught and fixed two cross-scope regressions:
  migration 122 now preserves Blueprint purge Storage-lease authority, and the
  hot/cold safety nets filter scope and terminal failures before limiting work.
  Regression coverage exercises both worker-starvation cases, while fresh CI
  replay runs the existing Blueprint purge fixture and the new cold purge fixture.
- Documented contracts, recovery-loss consequences, rollout gates, operations,
  and tests. Added desktop/mobile teacher and student-boundary visual coverage.

**Validation:**
- Under exact local-only authorization, previewed migration history 001–121,
  applied only `122_cold_archived_classroom_purge.sql` to the dedicated local
  Supabase database, regenerated types, and confirmed the gate remains
  `disabled`.
- The rollback-only database harness passed authorization, restore-conflict,
  tombstone fence, live-lease, retry, exact-object ordering, cleanup, audit, and
  preservation checks, then rolled back all fixtures.
- Full Vitest passed (483 files, 4,159 tests), plus TypeScript, lint, generated
  type parity, production build, architecture/design/storage checks, Pika audit,
  diff checks, and Playwright visual verification across desktop/mobile and
  light/dark teacher states plus the student boundary.
- No staging/production migration, rollout, purge, object deletion, or generic
  cleanup was performed. Migration 122 and its rollout still require separate,
  exact production authorization after merge.

## 2026-08-10 — Refine archived Classroom action terminology

**Risk profile:** low — presentation-only labels, accessible icon treatment,
and focused regression coverage; no lifecycle behavior or rollout gates changed.

**Completed:**
- Renamed the hot-archive actions from “Use again” to “Reuse” and from
  “Restore” to “Unarchive,” including the confirmation dialog and supporting
  copy. Cold-archive recovery remains “Restore.”
- Replaced the permanent-delete text action with the standard trash icon while
  retaining the accessible “Delete permanently” name and tooltip.
- Added component assertions and a focused teacher/student visual matrix for
  desktop/mobile and light/dark modes.

**Validation:**
- Focused Vitest passed (2 files, 23 tests), lint passed, and the isolated
  Playwright matrix passed (3 tests, including auth setup).
- Screenshots were visually reviewed for all teacher matrices and the student
  boundary. No database, migration, API behavior, feature gate, or destructive
  operation changed.

## 2026-08-10 — Add Student Tests live-status accessibility

**Risk profile:** exam-mode, workspace-state — student test announcements and
autosave error feedback while preserving the mounted attempt and exam owner.

**Completed:**
- Added action-only polite flag/unflag announcements without announcing loaded
  localStorage state or duplicating pointer/keyboard toggles.
- Added polite autosave transition announcements for unsaved, saving, and saved
  states while keeping the visible status layout and teacher preview unchanged.
- Exposed save and submission errors as assertive alerts without changing API,
  draft, retry, availability, locking, or submission behavior.
- Added controlled timer/promise coverage for announcements, save failure draft
  preservation, preview isolation, and existing pressed/locking/storage rules.

**Validation:**
- Focused StudentTestForm tests pass (15 tests), plus TypeScript, lint,
  architecture, UI policy, Pika audit, and diff checks.
- Playwright verified real student flagged/unflagged, saving/error, response
  preservation, and keyboard-focus states plus teacher preview at desktop/mobile
  and light/dark; no layout regression or overflow was found.
- The temporary local test fixture was deleted after capture; no API, database,
  migration, Gradex, exam-mode ownership, or dependency changes were made.
