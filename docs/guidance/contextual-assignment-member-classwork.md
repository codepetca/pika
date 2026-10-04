# Contextual Assignment learner writes — locked Classwork visibility

Status:241 applied once locally after clean source review, reconciled with actual
main2595c775 (1457 merged). Local001–241/main001–240; production is last verified
001–225, not freshly queried here. Initial security/compatibility and targeted
proof correction reviews are clean. Genuine types generate/check have zero drift;
new and unchanged save rollback harnesses, complete canonical baseline and strict
001–241 isolated replay/forced-failure teardown checks pass. Final cumulative review
and exact reviewed-head CI/mainmerge remain required.
No application consumer, admission, UI, account, billing or provider activation
changes. This does not close batch2 or the full goal.

## Exact compatibility boundary

The existing member save, submit, unsubmit and submission-preflight RPCs must
conceal hidden Classwork at their own locked authorization boundary. Application
preflight/postflight cannot substitute for a transaction-bound effect check.
Migration241 replaces only those four latest complete214 definitions:

- `save_assignment_doc_for_member_v1`
- `submit_assignment_doc_for_member_v1`
- `unsubmit_assignment_doc_for_member_v1`
- `prepare_assignment_doc_submission_for_member_v1`

Only240's predicate is added: an object containing JSON boolean`classwork:false`
hides access. Missing/null/malformed normalizer inputs remain default-visible;
205-forbidden stored shapes are not claimed persisted-RPC cases. Visibility is
selected under the existing classroom/Assignment locks. Owner/self-enrollment
denial42501 remains before hidden/archive/draft/scheduled P0002 concealment.
Global account-role labels do not grant learner or owner authority.

After stripping those allowed additions, each complete body is byte-identical to
214. Preserve signatures/defaults/DTOs, UPDATE versus SHARE row locks, advisory
lock order, membership fences, revision and retry semantics, save history/metrics,
artifact freeze, Pal validation/capture, security-definer metadata/empty search
path and service-only execution grants. No table/backfill/index/data mutation is
part of the migration. Existing legacy wrappers and application consumers remain
unchanged. Before241 the four contextual RPCs retain their old visibility gap;
the shared admission/cutover must remain OFF during that compatibility window.

## Verification and release gates

The canonical-local harness requires241 already installed; it never applies SQL.
Synthetic c241 UUID/sc241 textual namespaces must be empty before fixture writes.
Every fixture/settings change stays in one BEGIN/ROLLBACK with3s lock/30s statement
bounds, service-role RPC calls and immutable168/169 guards enabled. It tests hidden
missing/writable/submitted work, whole-row document/history/save-ledger/requirements/
artifacts/Pal evidence, owner precedence, default visibility, both historical role
labels, revision errors, idempotent retries and nonempty artifact preflight/freeze.
Visible legacy and membership-Pal controls must be nonvacuous; no provider call is
made. A fresh-null signal activation boundary uses only the existing240 rollback
fixture's coalesce pattern; an established169 boundary is never replaced.

Existing isolated observers explicitly replay001–241 after review; no future SQL
is silently accepted. Only their floor and matching offline fixture count change.
All001–240 SQL, fixture DML, resource identities, transport containment, allowed
transitions, restoration and teardown authority stay unchanged. Actual replay,
both exact forced-failure cleanup receipts and canonical fingerprints are required;
structural/offline tests are not those receipts. Runtimecc206cce replay passed nine
learner read/projection cases and six original revocations, preserving the original
list cases/revocations. Nine sealed open RPC stubs used created=false/view=false;
zero actual open RPC/Storage/provider network calls are claimed. Both forced modes
returned exactly exit1/two expected markers, with exact teardown and unchanged
complete canonical baseline. Private0600 receipts remain at
`/private/tmp/pika-learner-open-cleanup.oe8GJq` and
`/private/tmp/pika-learner-open-cleanup.mZNJ54`.

The first rollback fixture run failed on five invalid null due dates after241
application and genuine types had succeeded; transaction rollback and separate
complete canonical baseline check passed. A two-file proof-only regression-first
fix preserves the schema/auth/capture/cleanup boundary. Targeted21-case review is
clean; actual new241 and unchanged save rollback harnesses then passed, with
nonempty artifact freeze/preflight and nonvacuous legacy/membership Pal controls.
All complete canonical public/private/Storage row fingerprints and immutable
168 metadata/settings/cron/resources match the preapplication baseline.

Root owns the single exact local application, genuine generated-type checks,
runtime operations, review budgets and normal merge. No production operation is
authorized by this preparation. One-session rollback tests do not prove a
two-session visibility-change race. Existing save/concurrency behavior must be
rechecked in final CI's ephemeral database. The committed-fixture concurrency
script was deliberately not run on canonical local because168 retains immutable
generation identities even with PalOFF; no broader cleanup authority was added.
Sibling history/restore/artifact/inline visibility, actual integrated
learner opening effects, nonempty supplements, live signing and authenticated
HTTP/browser lifecycle remain separate work before full cutover.
