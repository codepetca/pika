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

Acceptance still requires real SDK/PostgreSQL and strict private-object byte
evidence for mixed-role owner exports, same-key retries/cross-class conflicts,
owner/unarchive/revision/compaction/purge races at begin/finalize/replay, source
preservation on successful and failed exports, finite fixture cleanup, independent
review and final-SHA CI. Source preparation and mocked tests do not activate
admission or certify those native checks. Shared local249+ and production holds
remain in force; no migration or live proof is authorized by this document.

The current-base 271 implementation is resequenced from the older source-only264
preparation; no applied migration is renamed or changed. The single SQL snapshot
materializes its complete result once and rejects more than5000 hot or cold roots
or more than16MiB of serialized UTF-8 JSON by returning NULL. The adapter reports
503, never a truncated list, retry or legacy fallback. Lock/statement settings are
1s/8s and the SDK request has a10s abort deadline. These are infrastructure
failure bounds, not subscription classroom quotas. Purge presentation IDs are
intersected with the verified snapshot by identity sets.

Current implementation evidence: installed SDK with isolated transport plus API
and SSR-focused regression checks pass. The rollback SQL contract passed against
an isolated complete001–272 replay, and genuine generated metadata is installed;
the prerequisite RPC cast is removed. This is not complete native/Storage
acceptance. Native SDK/stored-byte and preservation verification, visual checks,
independent final review and exact-head CI remain gates.
