# Contextual owner archive recovery

This dormant slice dispatches only `GET /api/teacher/classrooms?archived=true`
and `POST /api/teacher/classrooms/[id]/archives` through the existing shared
classroom-experience admission. Admission selects the boundary; current hot
classroom or cold tombstone ownership authorizes recovery independently of
`users.role` and enrollment. Absent or unmatched admission retains the existing
route contracts. Active lists and classroom creation retain their existing guards.

Migration 271 adds a service-only, stable, single-statement recovery projection.
It returns the owner-scoped hot parents, current revisions, latest immutable
archive, latest current-revision export operation, and cold tombstones with
archive identity evidence in one database snapshot. Strict validation rejects
missing revisions, substituted identities, duplicate or overlapping hot/cold
parents, malformed SDK envelopes, and completed-operation/archive mismatches.
Missing migration/schema or uncertain transport returns 503 for admitted actors;
the admitted path cannot fall back to separately authorized legacy queries.

Existing export allowlists, restore budget gates and purge presentation helpers
remain authoritative for their existing purposes. Purge IDs are presentation
hints only. This slice adds no archive/unarchive, cold restore, reorder, purge,
entitlement, format, storage permission or account-role policy.

The admitted export uses the unchanged export coordinator and SQL 107/126
begin/finalize gates. After a successful result, a read-only projection binds
the exact completed export operation to its archive, current hot owner and
expected source revision and compares hashes, sizes, counts and verification.
The evidence requires the deployed v2 format and matching private storage
identity without returning bucket or object paths.
Same-key completed replay uses this same check. Revision/ownership/lifecycle
changes or lost/malformed postflight transport produce an uncertain 503; they
do not prove rollback and do not trigger cleanup, retry or another export.
The immutable archive may still exist even when current-owner confirmation fails.
The existing failure envelope uses `classroom_archive_recovery_unverified` and
the message "Outcome could not be verified; refresh to reconcile it". Its
`retryable: true` retains the same operation key for manual reconciliation;
it promises no rollback or automated retry.

The installed-SDK isolated-transport regression suite exercises request encoding,
admission, strict DTOs and postflight uncertainty. The rollback-only native SQL
source is `scripts/check-contextual-classroom-archive-recovery-read.sql`; it must
run only against an explicitly authorized isolated database with migration 271.
Its synthetic ledger/archive pair proves read identity binding, not actual stored
bytes or coordinator finalization. It does not execute the historical archive-v2
quizzes fixture harness.

Dormant main-merge acceptance requires current-base SQL/genuine metadata, real
SDK/PostgreSQL and strict private-object byte evidence for mixed-role owner
exports, same-key replay/cross-class conflicts, controlled postflight uncertainty,
source preservation, finite fixture cleanup, the separate Pal272 contention
proof, independent final review and final-SHA CI. Source preparation and mocked
tests alone do not certify those native checks.

The broader owner/unarchive/revision/compaction/purge race matrix at archive
begin/finalize/replay remains batch3/cutover evidence, not a passed result or an
additional dormant-merge experiment. This slice does not change the existing
107/126 writer/coordinator synchronization:271 adds one SQL snapshot and the
adapter adds a strict read-only postflight comparison. Native sequential current-
owner/revision/unarchive/cold/deletion projection checks, real export/replay/byte
evidence and adapter uncertainty tests cover that changed boundary. They do not
certify every historical writer race or authenticated/provider rollout. Shared
local249+ and production holds remain; this document authorizes no migration,
live proof or admission activation.

The current-base 271 implementation is resequenced from the older source-only264
preparation; no applied migration is renamed or changed. The single SQL snapshot
materializes its complete result once and rejects more than5000 hot or cold roots
or more than16MiB of serialized UTF-8 JSON by returning NULL. The adapter reports
503, never a truncated list, retry or legacy fallback. Lock/statement settings are
1s/8s and the SDK request has a10s abort deadline. These are infrastructure
failure bounds, not subscription classroom quotas. Purge presentation IDs are
intersected with the verified snapshot by identity sets.

Current bounded evidence: a separately reviewed disposable complete001–272
replay passed both rollback contracts and genuine metadata generation. Actual
typed RPCs and the unchanged export coordinator passed private stored-byte
readback, independent bundle verification, same-key replay, cross-class denial,
controlled postflight uncertainty and exact tiny-source preservation. Native
accounting was82 HTTP exchanges,183 database actions,814 controls and11,498,419
exchange bytes, inside unchanged bounds. Immediate independent preservation
passed7,840 source/98,969 dependency files; canonical/global resource equality
and positive owned cleanup were required for the successful lifecycle. All exact
project resources and workdir are absent. Genuine metadata matches the installed
file byte-for-byte; no prerequisite cast remains. Independent evidence acceptance
is scoped to this tiny fixture, not real-provider compatibility, arbitrary source
objects or the broader races listed above. Final review/CI and the remaining
documented gates are separate requirements; no rollout or production action is
implied.
