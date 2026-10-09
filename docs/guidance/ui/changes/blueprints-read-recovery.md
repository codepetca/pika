# Blueprint read recovery — 2026-10-06

Surface: teacher `/teacher/blueprints`, required list and selected-detail reads.
Reference: canonical teacher utility recovery in `src/app/teacher/dashboard/page.tsx`,
`PageState` and `/pattern-lab?role=teacher#page-states`. Preserve the successful
Blueprint utility composition. Page-state conventions take precedence over the
Lab's illustrative card wrappers: failed primary regions are not nested in cards.

Roles: teacher; student n/a because this utility is teacher-only. Verify desktop
and mobile, light and dark, normal and reduced motion. States: initial loading,
list failure, valid empty list, selected-detail failure, keyboard retry/pending,
mixed independent reads, stale responses and retained warm list/editor drafts.
Primary signal: the required read's named error and bounded retry. Composite
accessibility checklist: required for focus/status/retained workspace behavior.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Required-read error/status | PageState | reuse | Approved named primary-region states and alert/status semantics |
| Recovery action | IconButton | reuse | Named keyboard control and existing pending/reduced-motion behavior |
| Utility framing and successful editor | Blueprint PageLayout and split composition | reuse | Preserve geometry, selection and authoring ownership |
| Independent read failures | Existing list/detail generation refs | extend | Scope errors and pending retry to the existing owner |
| Warm list and dirty editor | Existing list/editor state and unsaved-action guard | reuse | Failed reads must not discard usable data or drafts |
| Runtime evidence | Development-only teacher utility fixture convention | extend | Render the actual Blueprint page with intercepted read fixtures |

Scope: distinguish failed required reads from successful empty/selection states,
provide list and missing-detail retries with cache invalidation, prevent duplicate
attempts, and focus stable named regions before replacing a retry control. Retain
warm list rows while a list retry is pending. Keep errors independent of mutation
feedback. Preserve all request-generation/selected-ID guards.

Do not add an unconditional warm-detail refresh: its existing success path replaces
unsaved editor state. Expose detail recovery only while the selected detail is
missing. Existing save/import/proposal/history/purge/selection and dirty-discard
contracts stay feature-owned. No dependency, schema, authorization or new motion
contract is proposed. Loading feedback must remain meaningful with reduced motion;
the separate shared-motion PR is not assumed merged.

Verification uses a development-only fixture mounting the production page with
controlled network reads and blocked mutations. It verifies actual client read,
retry and draft ownership, not authentication, a production outage or server
performance. Compare the error treatment with the approved PageState reference at
matching viewports. Root owns cumulative checks, draft-first independent review
and delivery receipts. Implementation is authorized; merge/production authority
remains separate. The broader product-wide goal is still active.

Acceptance evidence: six initial behavioral cases failed before the fix; 54
component/client/cache/editor tests pass after it, plus three fixture-gate tests.
Sixteen committed browser cases verify actual client cold list/detail retry,
keyboard focus, busy status, generic failure copy and reduced spinner behavior
across the full viewport/theme/motion matrix. Eight supplemental warm-read
variants retain rows, editor node, tab, drafts and caret; genuine-empty success
was independently captured in those eight variants. Root inspected all 80
screenshot states and recorded natural interactions. Synthetic reads are
controlled evidence, not authenticated shell or production-outage verification.

The fixture is blocked in production even when its opt-in flag is enabled;
publication guard tests cover production, disabled development and opt-in
rendering. No golden baselines or timeouts were weakened. Cumulative checks,
independent review and exact-head CI remain required before merge consideration.

Initial independent review found previous-Blueprint save/export feedback surviving
selection changes. The selection boundary now clears that feedback only when the
selected ID changes; same-owner list/detail retries retain it. Two durable
save/export selection regressions ran RED before remediation, and warm list
pending/rejection/success now explicitly retains failed Export feedback. All 56
Blueprint/client/cache/editor tests pass after this bounded correction.
