# Classroom Test tier caps

Owner-approved 2026-10-07: Basic 20, Pro 50, Max 100 retained Tests per
classroom. See SUB-16 in [subscription policy](subscription-policy.md).
Implementation is prepared separately from the dormant atomic reorder PR
#1515. These limits are not activated, applied to canonical local/production,
or used as a replacement for that PR's missing capacity evidence.

The quota foundation uses migration `253_classroom_test_tier_caps.sql`, the next
contiguous migration after main's 252. PR #1515's separate reorder source also
currently uses 253; that source must be resequenced when rebased after the quota
foundation lands. This does not apply either migration to a canonical database.

## Contract and enforcement boundary

Derive the cap from the classroom owner, never the actor's client-supplied plan,
historical teacher role or a member subscription. Runtime `basic`/`plus`/`pro`
map to 20/50/100. Free cannot add Tests to retained work. Do not add manual
per-classroom quota configuration or repurpose active-classroom grants.

Enforce Test insertion and movement into a different classroom at the database
boundary. Count all physical rows, including draft, active, scheduled and
Blueprint-retired work. Same-classroom editing, grading, viewing, export,
reordering and status changes are not additional consumption. Preserve
over-limit classrooms following a downgrade; no automatic Test deletion.
Privileged archive recovery/compaction rehearsals preserve their retained graph;
ordinary Blueprint materialization is not recovery and must consume capacity.

Legacy ordinary creation directly inserts Tests. Contextual creation uses
`create_test_for_owner_v1`; guided creation uses `create_guided_test_for_owner_v1`.
Blueprint instantiation and classroom proposal application also insert Tests.
Package/AI editing of a reusable Blueprint template does not consume a
classroom slot until materialization. No standalone Test duplicate route was
found in the bounded writer inventory at main `7357f9f0b`.

Billing-managed accounts use their immutable offering's explicit
`features.tests_per_classroom`, not today's advertised tier. Prior versions
without that term retain their purchased terms; new version publication and
subscriber migration remain separate billing work under SUB-07/SUB-08. Do not
modify old offering JSON or historical migrations to retrofit this allowance.

## Rollout and acceptance

1. Prepare the migration with enforcement disabled and no account changes.
2. Verify 20/50/100 exact boundaries, Free and unknown assignments, all statuses,
   over-limit same-class updates, bulk rollback, movements, restore exemptions,
   offering-version behavior and role privileges in disposable database checks.
3. Verify simultaneous inserts, plan changes and owner changes cannot overspend
   or use stale authority. Source-string assertions alone are not database proof.
4. Integrate the closed quota errors through ordinary/guided/Blueprint creation
   responses. Review rendered error states using the existing Test error surface;
   do not introduce a new dashboard or billing UI in the foundation slice.
5. Verify the updated contextual Test proof catalogs include the exact new trigger and
   private function metadata. Keep every inherited trigger/effect/rollback
   assertion. Off-by-default runtime compatibility is not complete proof parity.
6. Complete independent risk-matched review, focused checks and exact-head CI.
   Then obtain exact migration/target and activation authority separately.

Canonical local/production migration application, live enforcement, account
changes, billing, admission/home/page/cutover activation and production
promotion remain held. A main merge alone must not make the cap live.

## Current evidence

The initial migration and rollback contract passed against isolated PostgreSQL 17
on 2026-10-07: all tier boundaries, bulk rollback, moves, retained edits,
historical offering terms and an unprivileged restore-context spoof. Separate
observed two-session cases covered last-slot insertion, plan-lock contention,
parent-lock contention and owner transfer; stale transaction isolation failed
closed. Settings and fixture rows returned to `false|0`, and the owned container
was removed. This was a narrow schema-shaped fixture, with an initial-plan setup
stub, not full Supabase replay or proof of the production plan-writer RPC.

Independent initial review found three fixture/compatibility issues: required
Test creators, destination gradebook categories, and the actual Pro trial
assignment. One correction batch adds all creators, clears transfer categories,
and validates trial/access/entitlement revisions and windows. Active trials have
50 slots; elapsed and applied expiry deny additions even below the cap, without
blocking retained edits. Malformed trial graphs fail closed.

The corrected migration replayed with all 001–253 source migrations in a fresh,
database-only Supabase project (CLI 2.109.1, PostgreSQL 17). Its rollback fixture
passed with the real plan and trial/expiry writers and inherited constraints;
the setting/users/Tests/trials returned to `false|0|0|0`. All three additional
quota metadata blocks executed successfully. Observed two-session cases passed
for the last slot, real plan writer, parent row and eligible Pro-to-Basic owner
transfer, plus stale isolation and retained edits. The inherited `car_tests`
archive-revision update serializes some writes before quota evaluation: observed
last-slot/owner contenders waited about 1.8s of a 2s holder, then denied with
`PTC01`. The new guard's TRY/NOWAIT locking is not an end-to-end no-wait claim.
The whole owned test project is disposed after committed concurrency fixtures;
no canonical database, API application or hosted project was used.

Creation, publication and pristine-discard catalogs now retain every previous
trigger and attest the additional trigger, its column scope, sealed function,
private privileges and disabled settings. Final corrected focused checks pass:
487 tests in 27 files and all static gates. Whole inherited native-profile
execution, independent delta review, exact-head CI and friendly creation error
integration remain distinct gates; passing the new metadata blocks alone is not
whole-profile acceptance or authority to enable enforcement.

The complete local create proof at77f9 failed before SDK execution because the
canonical248 catalog has183 tables, while source253 adds the private quota
settings table. Exact teardown and the same full183-table/five-field checkpoint
passed. The proof now derives its isolated catalog externally from the unchanged
canonical catalog plus that single required, migration-SHA-bound addition. It
does not infer expected names from the observed fixture, omit any table or exempt
quota fingerprints from rollback/restoration. Missing, extra and duplicate
tables still fail closed. Normal/types and both forced modes for create,
publication and discard, independent delta review and exact-head CI remain gates;
the failed local run is retained and is not native acceptance.

A loopback-bound, read-only query of `supabase_db_pika` on 2026-10-07 found
the largest local classroom had 5 Test rows, with zero local classrooms above
20, 50 or 100. This is development data, not production inventory. No classroom
IDs, account identities or student data were included in the receipt.

The 10,000-Test failure discussed in this task was a disposable reorder stress
fixture, not evidence that a real classroom exceeded the proposed caps. Existing
over-limit classrooms and old purchased offerings mean the new quota does not
automatically close PR #1515's whole acceptance gate. Its decision must be
reconciled explicitly after the quota foundation, not by silently shrinking a
failing fixture or dropping preservation assertions.
