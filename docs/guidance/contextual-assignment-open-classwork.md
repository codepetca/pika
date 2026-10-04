# Contextual Assignment open — locked Classwork visibility

Status: source-only implementation reconciled onto actual1455 merge97e16dec.
Migration240 is UNAPPLIED. A draft freezes source for independent review; local
preview/application, database proof and generated-contract verification precede
ready/exact-head CI and merge.
Production and shared admission/page/home/cutover remain unchanged and OFF.

## Bounded compatibility contract

The existing member-only `open_assignment_doc_for_member_v1` must conceal hidden
Classwork before creating a document, refreshing `viewed_at`, or enqueueing a Pal
event. Application preflight and postflight reads cannot guarantee this boundary:
the setting can change after preflight but before the RPC's side effect.

Migration240 replaces only that function's latest complete214 body. Classroom
visibility is selected under the existing classroom/assignment row locks; only
an object containing JSON boolean`classwork:false` hides access. Missing/null or
nonboolean values retain the current `normalizeClassroomFeatureVisibility`
default-visible behavior. This does not change feature visibility policy.

Existing owner-precedence42501 rejection remains before learner concealment.
Hidden Classwork uses the same P0002 concealment as archived/draft/scheduled work.
The existing classroom-operation, subject and membership advisory lock order,
binding retry, enrollment row lock, Pal validation/enqueue, content initialization,
no-op/returned-work view behavior, unique pair, signature, return DTO, empty search
path, security-definer owner and service-only execution privileges stay intact.
No global role, plan or entitlement lookup is added. No data backfill, table,
other RPC, legacy route, UI, rollout setting or provider behavior is changed.

## Proof and release boundaries

The implementation worker owns only the new migration, structural regression and
rollback-only local behavior harness. The coordinator owns exact local application,
generated-contract verification, actual runtime evidence, reviews and release.
No worker is authorized to run SQL/DB/Storage/provider operations.

The existing isolated list/overview/student-detail lifecycle must replay the
explicitly reviewed001–240 floor after this source change, not silently ignore240
or accept future SQL. The001–239 migration bytes, fixture DML, allowed transitions,
resource identities, canonical read-only snapshots and cleanup/restoration
authority stay unchanged. A regression-first offline240 fixture fails against
the previous239 count; the narrowly updated floor passes55 lifecycle/proof tests.
This is offline evidence, not an actual240 replay or application receipt.

The new local harness must be source-reviewed before execution and use a complete
rollback for its synthetic rows/settings. It cannot disable/alter168 guards,
delete retained membership generations, contact providers or expand cleanup
authority. Two-session visibility-change behavior must not be claimed verified
from structural checks or one-session rollback tests alone.

This prerequisite does not migrate the learner's shared-admitted GET supplements,
prove nonempty artifact/feedback/identity/repository responses, or close sibling
learner write/history/restore/artifact visibility integrations. Those remain
bounded assessment work before integrated cutover. Existing source-only and
historical proof receipts are not production or activation evidence.

## Offline preparation receipt — 2026-10-04 Toronto

The source worker returned the three owned files:41 tests across five suites,
shell syntax and scoped lint pass. Its initial RED includes missing new files;
the explicit214 gap and complete-body stripping regression also pass. No live
database operation occurred. Owner labels, defaults and source closure are tested.
Malformed visibility values forbidden by205 are normalizer/predicate evidence,
not claimed persisted-RPC cases.

Root inspected the complete migration,112-line structural suite and398-line
rollback harness. Added a positive visible legacy-Pal control before hidden
fingerprints; the membership-Pal phase also has positive mixed-role first views.
Serial CI guard fails RED before the new step and passes GREEN afterward, without
changing existing open/concurrency steps or gate behavior.123 targeted checks and
150 focused checks plus architecture/UI/design/TypeScript/lint pass. Migration240
and the rollback harness remain UNAPPLIED/UNRUN. Actual parent merge/review/local
database and concurrency evidence are not implied by these offline results.

Parent1455 superseding receipt: all five exact-reviewed-head ea080944 checks
in37178120557 passed (0queue/1817runseconds), normal squash merged97e16dec at
2026-10-04T05:21:54Z. Squash tree equals reviewed tree; canonical main cleanFF.
This child rebase is conflict-free and byte-preserves executable source. No240
application, runtime, review or production receipt is implied by the parent merge.
