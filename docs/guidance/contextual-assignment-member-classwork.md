# Contextual Assignment learner writes — locked Classwork visibility

Status: candidate241 is prepared from actual mainc7e5a487, not applied. Local/main
history is001–240; production is last verified001–225, not freshly queried here.
No application consumer, admission, UI, account, billing or provider activation
changes. Independent source review and local database/type/runtime proof remain
required before ready/CI/mainmerge. This does not close batch2 or the full goal.

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
both exact forced-failure cleanup receipts and canonical fingerprints are still
required; structural/offline tests are not those receipts.

Root owns the single exact local application, genuine generated-type checks,
runtime operations, review budgets and normal merge. No production operation is
authorized by this preparation. One-session rollback tests do not prove a
two-session visibility-change race. Existing save/concurrency behavior must be
rechecked. Sibling history/restore/artifact/inline visibility, actual integrated
learner opening effects, nonempty supplements, live signing and authenticated
HTTP/browser lifecycle remain separate work before full cutover.
