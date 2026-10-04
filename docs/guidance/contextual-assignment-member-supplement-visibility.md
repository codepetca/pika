# Contextual Assignment supplemental learner boundaries

Status: source-only preparation from reviewed1458 head28e8af46, now merged as
actual main61c44aec with exact tree parity. Candidate242 is UNAPPLIED. Local/main001–241;
production is last verified001–225, not freshly queried here. Reconcile this branch
with actual merged main before publication/ready; preserve all applied migration bytes.
This is part of active assessment batch2, not its exit or a rollout milestone.

## Bounded implementation

Use the exact locked Classwork predicate from240/241 for four latest complete
definitions, preserving their original bodies after only visibility additions:

- `public.get_assignment_doc_history_for_actor_v1` from214: apply concealment
  only to its learner branch. The current owner can still inspect history when
  Classwork is hidden; member-only owner requests still fail42501 first.
- `public.restore_assignment_doc_for_member_v1` from214: conceal before restore
  effects, preserving target-history integrity, document revision and save history.
- `private.lock_assignment_artifact_member_context_v1` from214, not its earlier
  190 body: covers existing190 public prepare/upsert/delete wrappers unchanged.
- `private.lock_assignment_inline_image_member_context_v1` from213: covers
  existing reserve/finalize wrappers before managed-object effects.

Only an object with JSON boolean`classwork:false` hides learner access. Missing,
null or malformed normalizer inputs remain default-visible; forbidden stored
shapes are not persisted-RPC cases. Read visibility under the existing locked
classroom/Assignment context. Preserve owner precedence, current membership,
binding/advisory fences, lock kinds/order, signatures/defaults/DTOs, revisions,
history/artifact/object semantics, security invoker/definer metadata, empty search
paths and existing execution revocations/grants. No dynamic function-body rewrite.
Existing001–241 migrations remain immutable.

No new route, global role, plan rule, table/index/backfill, feature knob, UI,
dependency or data mutation belongs to this migration. Private locking helpers
remain non-callable directly by service_role. No production, account, admission,
page/home/cutover, billing or provider activation is implied.

## Proof and release gates

Independent source review precedes any canonical local application. Root owns
target verification, exact pending242-only preview, one application, genuine type
generation/check, actual rollback proof, disposable replay and normal reviewed
draft-first main PR lifecycle. Source tests must first demonstrate the existing
visibility gap, then verify exact latest-body parity and owner-history exception.

The prepared canonical harness must be collision-guarded in exact c242/sc242
synthetic namespaces and stay in one BEGIN/ROLLBACK, with3s lock/30s statement
bounds and immutable168/169 guards enabled. Cover both historical role labels,
concealment before effects, current-member visible controls, owner-history access,
member-only owner42501 precedence, outsider/revision/history integrity and all
five existing public artifact/inline wrappers. Whole-row fingerprints must prove
denials leave documents/history/artifacts/managed objects and evidence unchanged.

For nonvacuous inline finalization, source preparation may follow213's scoped
synthetic `storage.objects` metadata fixture inside the same rollback transaction.
That grants no Storage API/bytes/network/delete authority; bucket ACL/settings
and unrelated metadata remain unchanged. Never disable guards or perform cleanup,
seed/reset, real object operations or application/provider calls. An existing Pal
activation boundary must never be replaced; any needed fixture setting change is
transaction-only and coalesces only a fresh null boundary.

Original isolated SDK fixture/transport/transitions/restoration/cleanup authority
must remain immutable; these new rollback fixtures do not extend that observer.
Actual SQL compilation, runtime behavior, generated types, concurrent visibility
races and combined replay remain UNPROVED at source preparation. Existing committed
concurrency fixtures belong to ephemeral CI, not canonical local retained identities.
Enrolled/outsider/cross-subject controls do not prove a same-actor post-revocation
transition. This harness must not update guarded enrollment identities, directly
delete enrollment or invent a roster mutation/cleanup path to obtain that receipt;
actual removal/concurrency remains a separate lifecycle integration gate.
No authenticated HTTP/browser, live signing, nonempty SDK supplementary projection
or actual learner-open effects are claimed. Those integration gates remain separate
before full cutover; assessments, lifecycle services and dormant home still need work.

Explicit read/delivery prerequisite: the sole latest213
`public.read_assignment_inline_image_for_context_v1` does not yet check locked
Classwork visibility in its nonowner branch. This four-function write/history
slice does not modify that fifth definition. A later bounded read boundary must
conceal hidden learner images while preserving owner inspection and the existing
404 DTO/current-subject/object identity contracts before image delivery admission.
Standalone image/artifact pair gates remain OFF; no compatibility gap is treated
as proof of readiness merely because save/submission writes are guarded.
