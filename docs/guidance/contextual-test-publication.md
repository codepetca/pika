# Contextual classroom-owner Test publication

Prepared access-phase2 owner-authoring slice after #1503, which merged at
865d837b740e781086f0209eb9c4d9c8dab78db3 after reviewed9c39132d passed all five
checks in CI37435496517. HTTP/body/SQL source-contract TDD186/4 passed; actual
database acceptance, genuine types, independent review and merge remain pending.
This is not rollout or a phase exit.

The isolated proof implementation is ready for independent source review: one full-row fixture,
one sealed installed-SDK transport, one additive private native profile, rollback
contracts and separately typed committed transitions. The original runner's
whole-row rollback assertions remain intact. Four withdrawn capabilities (247,
252, 139 and134) share one native engine, counters and adopter deadline; genuine
type AST checks and serial normal/forced-CI wiring pass offline. These are source
checks, not actual database, cleanup, CLI-generation or CI acceptance.
The source inventory is 49 rollback contracts, 12 two-session schedules and five
committed transitions. Root fixture/transport/product integration296/6 and
native/lifecycle109/3 tests pass; the final additive shared-race-clock test also
passes (legacy/native suite77/1). Both race runners share one180-second clock
inside the same native engine and the original adopter900-second deadline.
Full TypeScript checking still reports only the missing genuine252 RPC declaration;
no manual generated-type overlay is permitted. Pre-type source freeze is not PR
readiness, database acceptance or merge evidence.

Initial independent security/concurrency and architecture/compatibility source
reviews at243a26 both returned clean. The first normal invocation stopped before
disposable setup because the inherited whole B1 differed from local auth records.
The owner then approved retaining B1 and capturing a NEW complete read-only B2.
Two equal captures cover all183 tables and all5 fields, without exemptions.
Seven changed tables include auth, Classroom/archive, Assignment documents and
Daily entries; attribution remains unknown. Other4 fields and catalog match B1.
Independent review5 accepted the checkpoint and exact-head wrappers at96cfa10.
Normalattempt2 replayed001–252 and restored all four withdrawn capabilities,
then failed in SQL contracts with an unknown diagnostic code. Owned teardown
and a separate read-only whole-B2 check passed; B1 remains unchanged. No normal
success receipt, generated-type artifact or native acceptance was produced.
The diagnostic correction retains only emitted P2501 and P2507–48 codes;
P2502–06/P2549 remain unknown and raw stderr/rows remain suppressed. The next
reviewed native invocation must identify and resolve the actual contract failure.

The authorized quiet window produced B3 (all183 tables/all5 fields; B1/B2 retained).
Normalattempt3 applied001–252 but hit the unchanged180-second startup deadline
while waiting for service health. A single controlled retry, normalattempt4,
passed startup and four capability probes, then identified catalogue codeP2501.
Both attempts completed owned teardown and separate strict whole-B3 checks.
A read-only anonymous PostgreSQL reproduction confirmed a verification-query
alias collision: the catalogue record and trigger-query table alias both used
`p`. Giving the table alias a distinct name resolves that ambiguity without
changing any catalogue predicates, expected definitions, API/SQL252 or limits.
Independent review10 accepted the alias-only correction and exact-head wrappers
at69ae380. Normalattempt5 passed startup and all four capability probes, then
still failed catalogueP2501; owned cleanup and a separate whole-B3 check passed.
Read-only catalogue metadata identified a second verification mismatch: the
question trigger's66-byte declared name is physically truncated to63 bytes by
PostgreSQL. The expected catalogue tuple now names that exact physical trigger,
without changing its schema, function, event bits or any catalogue predicate.
Canonical metadata diagnosis does not attest migration252 (unapplied), its
catalogue or the complete native proof. This correction requires independent
review and fresh native verification; no native success, genuine types, PR/CI,
merge or rollout is claimed.

Full-coverage attempts and their failures are retained in the coordinator receipt.
Local runtime PATH needed the pinned pnpm10.25 shim; startup guidance stays within
its unchanged17000-character budget with all required historical/environment
receipts. The final legacy discard proof timeout is addressed only by splitting
the original assertions into fresh full1001-row/default5-second test cases.
Wholecoverage attempt3 at3f30c482 passed14139 tests/8 skips across1085 files,
with the unchanged global floors. Subsequent diagnostic changes require their
own targeted checks and independent review; no exact-head full-coverage claim is
made for them. No product/native caps, floors or source gates were relaxed.

## Scope and compatibility

Publish only a saved Test draft, materializing its questions and ending exactly
`closed`. Publishing does not open student access, return grades or initiate AI.
Current active Classroom ownership—not account role, historical Test creator,
enrollment or subscription—will authorize the prepared operation.

Use a dedicated, shared-admission-gated `POST /api/teacher/tests/[id]/publish`
with the existing publication body `{ status: 'closed', draft_version }` and
success envelope `{ test }`. Disabled or unmatched admission returns unavailable
without data access. The existing Test PATCH route and UI remain byte-identical.
The overloaded PATCH also accepts document/title edits whose valid payloads can
exceed a publication-specific bound. Classifying all those requests through a
small publication reader would regress them; cloning or reading the body twice
would not establish one finite boundary. A purpose endpoint avoids both issues.
The later controlled UI adopter is explicitly still required before cutover.

## Intended transaction contract

Use one absolute request deadline spanning params, bounded body, read-only draft
snapshot, canonical content validation and publication. Do not use the draft GET
coordinator's create/repair path or renew its deadline. An opaque authoring-source
digest and exact draft version must bind the validated snapshot to the final
current-owner transaction. The existing247 digest covers its declared authoring
projection, not every cache, document, timestamp or Classroom revision field.
Final full-row capture and postconditions must cover those additional fields.

The final RPC binds actor/Test/Class, authoring SHA, expected version, canonical
validated content and that same deadline. Canonical content must equal the
locked raw Draft by JSONB equality; publication cannot silently normalize or
repair a draft. Complete pre/postimages stay private inside SQL. Its bounded
server-only acknowledgement contains version, actor/Class/Test ids, source SHA,
draft version and the full Test row. The browser still receives only `{ test }`.

Delegate the existing139 publication/134 materialization algorithm without
exposing its transient `active` state. Respect both inner service capabilities,
current Class/archive/actor and lifecycle/provider/purge/decommission fences,
fixed Test/Class/Draft bindings, question identity/structure locks and bounded
contention. Protect retained learner, grading and provenance work from the
materializer's question deletions and rewrites. Prove complete materialized
question, Test, unchanged Draft, settings and Class/archive postimages; derive
revision effects from actual writes, never guessed trigger counts.

Lost acknowledgement can follow a committed publication. Do not automatically
retry, compensate, fall back to table writes or expose private witnesses/errors.

## Acceptance and holds

Require TDD route/helper/schema and literal legacy/UI regressions; disposable
full-migration replay with actual installed-SDK effects, rollback fault contracts,
two-session races and genuine generated types; exact cleanup and unchanged whole
canonical baseline; independent review; focused/coverage gates; stable reviewed
SHA and PR Gate before ordinary main merge. Source plans are not native evidence.

Canonical local and production remain last recorded001–248. Migrations249–251
and the future publication migration remain unapplied. No production promotion,
cohort/account/plan change, provider operation, billing, shared admission, home,
page or cutover activation is part of this component. Other Test edits, documents,
reorder, general deletion, learner access/participation, grading and other domains
remain separate obligations. The classroom-access epic remains incomplete.
