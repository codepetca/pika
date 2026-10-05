# Broad codebase audit remediation and rollout plan

Coordinator checkpoint: 2026-10-04. This updates the existing plan for all 27
supported findings (19 P2, 8 P3). It records completed implementation and remaining
integration, rollout and dependency work. The owner subsequently instructed this
task to orchestrate the plan. Execution
now covers landing/integration and preparation of the coordinated release; exact
production migration authorization remains separate.

## Current state and intended outcome

All 27 findings have accepted source remedies within the reviewed scope, delivered
in six independently reviewed source-package PRs, originally ready. The original
selected final CI checks and
PR Gate passed on the source-package heads below against
`main` at `902cbf7617bc7f5e0788cfd01fd07d78f051c99c`.
Guidance #1462 is now merged at `24cb8847b7c2d18719089b109ba3b1658108b641`;
the canonical checkout was fast-forwarded and exact source-tree parity passed.
The five remaining packages landed together via #1463 at `5a396899198397e93ffc3dfcc0908bfceaa4f676`.
Exact reviewed-source/merged-tree parity and clean canonical fast-forward passed.
Full CI [37226522459](https://github.com/codepetca/pika/actions/runs/37226522459)
and PR Gate passed: 12,216 tests/8 configured skips; browser 298 passed,
3 retry passes and 20 configured skips. Each retry matches prior accepted UI/auth
source-run failures; audit lifecycle cases passed without retry. Database replay
and all selected Test/auth/storage/concurrency contracts passed. The five-route
validation-debt deletion and optional worker limit preserved their intended scope.
Sibling #1464–#1467 drafts are closed as superseded after merged-source parity.
Phases 1 and 2 have their source/integration exit evidence. Production is public
and usable as of **2026-10-05 06:27UTC**. Migrations226–246 applied in37252303894;
247–248 applied-verified in37267393757 after complete preview37267273069.
Hosted history001–248 is complete, seven installed function bodies/security/
owners/ACLs match, and twelve operational controls are unchanged. Both apply
permissions are consumed. Forward248 fixes the hosted custom40001 retry loop;
the original244 is unchanged. PR1476 promoted c6f23b4b after all required gates
passed in [37268657918](https://github.com/codepetca/pika/actions/runs/37268657918)
at b5cf85b9. Merged-tree parity and Vercel READY/active aliases for both production
domains match c6f23b4b. Authentication/reset, signed downloads and the final
Test canary passed: reopened Return409 in2.47s, close/grade/Return, withheld then
released student results and idempotence. Exact synthetic Test, two Storage files,
new student provider identity, Classroom and two Pika users were cleaned; owned
logout returns401. Existing teacher provider and real student accounts remain.
Unrelated285 managed objects retain their exact digest and17 pending rows.
Temporary WAF removed; public login200 and unauthenticated auth401 verified.
Private completion receipt: `production-public-live-completion-receipt.json` in
the evidence directory below. Owner task-wide approval waived further approval
requests; CI/protection and actual runtime limits remained enforced.

Initial production promotion [#1470](https://github.com/codepetca/pika/pull/1470)
merged on 2026-10-05; #1476 supersedes that application deployment. Historical preview
[37228560431](https://github.com/codepetca/pika/actions/runs/37228560431) passed
against merged source `5a396899198397e93ffc3dfcc0908bfceaa4f676` and full CI
37226522459: exact production history 001–225, ordered pending 226–246 and all
21 hashes match the reviewed manifest. Approval digest:
`645873e4078494fc1d7ad73bb739706352413af4950388ddfec484e6312d8c8c`.
That preview and its subsequent application authority are consumed, not reusable.
One unsuppressed `braces` advisory remains. The dependency PR provides a bounded
recursion mitigation; it does not resolve every width/cycle case or establish
zero registry advisories. Its remaining resolution has a separate checkpoint
below, without rewriting the accepted source-work receipts.

The coordinated source/schema/application release is complete. The remaining
advisory retains the owner-approved temporary exception through 2026-11-04 and
its reassessment triggers below; this release does not establish zero advisories.

The original audit base was `3c5d7097e78258f70c368789e14f88ac2419c1d8`.
Evidence remains in `/Users/stew/.codex/audits/pika/2026-10-04-broad/`:
`audit-report.md`, `remediation-status.md`, `finding-acceptance.json`,
`final-ci-snapshot.json`, `final-remote-review-state.json` and
`final-worktree-source-state.json`. The existing `handoff.json` is the execution
ledger; retain its source acceptance, immutable runtime receipts and review
lineage. This document remains the single repository plan.

## Original reviewed source packages and current landing decision

| Order | PR | Findings | Reviewed head | Final CI run |
| --- | --- | --- | --- | --- |
| 1 | [#1462](https://github.com/codepetca/pika/pull/1462): AI guidance/startup | G1–G9, PAT-06 | `5c84e616884810a7f84e1703716ddb4810788475` | 37216134508, attempt 2 |
| 2 | [#1464](https://github.com/codepetca/pika/pull/1464): cache, surveys, focused checks | PAT-01, PAT-02, V3 | `e451c9057bb53597b279b91dd6795b728cbb2063` | 37216315304 |
| 3 | [#1465](https://github.com/codepetca/pika/pull/1465): summary execution | V2 | `dd1ebc114252809e6e800ba9934373a9886aaab4` | 37216145091 |
| 4 | [#1466](https://github.com/codepetca/pika/pull/1466): UI consistency | PAT-03, PAT-04, PAT-05 | `11d08c3c01311caf9228da4043c2ab8b43e2e789` | 37216149885 |
| 5 | [#1467](https://github.com/codepetca/pika/pull/1467): dependency fixes | DEP-01 | `b25034d6f7b59305ead6408b2fbc069573e54500` | 37216490408 |
| 6 | [#1463](https://github.com/codepetca/pika/pull/1463): Test, auth and storage contracts | CORE-01–03, S1–S4, D1, V1 | `a9a66e58786329311509e3ff0b522bc20f3f06ad` | 37219197293 |

The original order above remains source-package provenance. After guidance
landed, all five branches required journal reconciliation, and composition
identified conflicting deletion-only API-validation baselines. The coordinator
therefore consolidates the remaining packages in #1463, preserving their accepted
source and complete history, and validates the combined result once. One final
review/CI candidate also matches the coordinated production unit. This is a
packaging adjustment within the same 27 findings, not a new feature scope.
Merged-source parity established that the batch contains all sibling work;
#1464–#1467 were retired as superseded, with their review/runtime receipts retained.

## Finding-by-finding coverage

Every row has **implemented, independently reviewed and accepted source** in
its original package. The PR column below records that provenance; actual landing
is #1462 for guidance and the integrated #1463 for the other packages. Landing and production verification remain separate. Preserve these
acceptance contracts during integration; use existing receipts for unchanged
behavior and repeat affected checks when source or interactions change.

| Finding | PR | Remedy and behavior that must remain verified |
| --- | --- | --- |
| G1 | #1462 | Canonical landing guidance uses draft PR, independent review, stable SHA and PR Gate; eliminate conflicting direct-main instructions. |
| G2 | #1462 | Provider route scaffolds use maintained Supabase factories and a valid server/API boundary example. |
| G3 | #1462 | CURRENT provides readable, dated source, schema and rollout checkpoints; a source merge never implies hosted application. |
| G4 | #1462 | Feature records distinguish completed receipts from outstanding epic exit gates; change status only with evidence. |
| G5 | #1462 | Label the obsolete MVP roadmap as history and route current work to current epic plans. |
| G6 | #1462 | Setup guidance describes shipped capabilities and package-derived platform versions. |
| G7 | #1462 | Legacy context loading follows compact canonical startup and task-based document routing. |
| G8 | #1462 | Startup fails precisely for missing required inputs, including context-loaded mode; orient-only and detached-checkout contracts remain supported. |
| G9 | #1462 | Audit skill commands resolve to the existing runnable audit script. |
| PAT-06 | #1462 | Cache examples reject HTTP errors and distinguish freshness from cached failures. |
| PAT-01 | #1464 | Fresh grading polls retain no historical snapshots; zero TTL does not retain values; in-flight deduplication still works. |
| PAT-02 | #1464 | Feature-owned survey validation returns 400 for malformed fields/null/arrays while preserving authorization, partial PATCH and lifecycle rules. |
| V3 | #1464 | Changes to executable script sources select imported test consumers safely; full CI remains the backstop. |
| V2 | #1465 | Bound invocation/provider execution; persist completed summaries, report pending work and retry/resume unfinished dates/classrooms. Preserve Toronto date boundaries. Existing deadline proof uses controlled providers; observe actual latency during rollout. |
| PAT-03 | #1466 | SplitButton scopes keyboard ownership to its open menu, supports roving focus and normal Tab exit, and preserves Escape/dialog focus. |
| PAT-04 | #1466 | Calendar initial failures expose scoped retry; identity-tagged snapshots prevent classroom A data appearing under B after a failed switch. |
| PAT-05 | #1466 | Artifact actions provide non-overlapping 44px targets and visible focus while preserving layout density. Retain approved references and teacher/student visual evidence. |
| DEP-01 | #1467 | Coordinated existing-package upgrades and a braces depth bound pass editor/serialization/image/Markdown/build checks. Record the remaining advisory honestly and complete its separate resolution checkpoint. |
| CORE-01 | #1463 | Serialize autosaves and fence writes by expected revision; delayed saves and competing clients cannot overwrite newer answers. Preserve local work on conflicts and require explicit recovery before submission. |
| CORE-02 | #1463 | Teacher-closed eligible started work gets explicit zero-score evidence for unanswered MC items, with matching Return/Gradebook eligibility. Preserve blank/unstarted/mixed/reopened controls; do not globally zero missing drafts. |
| CORE-03 | #1463 | Check Return eligibility under compatible locks and revision fences; concurrent reopen/grade clear cannot return stale work. Preserve actual transition counts, replay idempotence and existing grading/authority contracts. |
| S1 | #1463 | Latest issuance remains authoritative after consume; transactional generation fencing rejects older codes and handoffs, including issuance/verification races and expiry after lock acquisition. |
| S2 | #1463 | Competing sibling signup handoffs produce one credential winner under user locking; the loser cannot create a session, and session epochs remain fenced. |
| S3 | #1463 | Reject foreign-Origin simple-form login; retain supported same-origin and headless JSON contracts. |
| S4 | #1463 | Enforce bcrypt's 72 UTF-8-byte limit for newly established passwords, including Unicode, while retaining compatible existing-hash verification. |
| D1 | #1463 | Use the reviewed protocol/managed-ID/path lock order and retry a newly appearing identity rather than taking an inverted row lock. Preserve cleanup authority and actual two-session upload/cleanup controls. |
| V1 | #1463 | Select two real isolated desktop Test lifecycle cases in required CI; prove revision, lock/restore, close/reopen, submit/Return, telemetry and student disclosure behavior. |

## Phase 1 — Land and reconcile the reviewed PRs

Owner: coordinator; entry: specific merge authority and a passing current PR Gate.

1. Read current `main`, PR head/base, review threads and selected final CI before
   each merge. Confirm the reviewed source is still the intended package.
2. Land guidance #1462, then the consolidated #1463 using the repository
   workflow after its final integration review and exact-head gates. Record the actual
   resulting `main` SHA and source parity; never switch branches inside an
   existing feature checkout.
3. After each merge, inspect remaining PRs against the new base. Preserve incoming
   source and shared continuity/history records when resolving conflicts.
   Return a ready PR to draft before pushing corrections.
4. For changed source or base interactions, run `pnpm check:focused -- --base
   origin/main`, affected contract checks and bounded independent review of the
   delta. Reuse valid unchanged evidence. Mark ready only at a stable reviewed
   head, then require selected CI and PR Gate on that head before landing.

Exit evidence: actual #1462/#1463 merge receipts, byte/provenance parity for all
six source packages, four explicitly superseded sibling drafts, no unresolved
review blockers, and explicit per-finding merged status. A green run on an older
head cannot authorize a changed head. Historical failed/skipped contexts do not
replace the selected final run; #1466's database job was intentionally unselected.

## Phase 2 — Accept the combined application

Owner: coordinator, with bounded independent contract review when interaction
changes warrant it. Entry: six packages integrated into one pinned revision.

- Run required integrated static, full-suite/build and selected browser/CI
  database checks on the combined revision. Confirm focused selection still
  covers executable script imports and real Test lifecycle cases.
- Verify generated database types against the exact complete migration chain,
  actual-role revision allocation, auth generation/credential fencing, Return
  races, storage locks and owned fixture cleanup. CI's disposable replay remains
  separate from any new shared-local migration/fixture authorization.
- Exercise cache/survey error behavior and summary resume/deadline contracts.
  Repeat UI screenshots and affected role checks if integration changes rendered
  behavior; preserve accepted visual receipts when their source is unchanged.
- Record failures as specific integration work, remediate in reviewed PRs, and
  repeat affected checks plus required final gates.

Exit evidence: one accepted combined source/schema revision and its CI/runtime
receipts. Existing local receipts describe their exact older source; they are
not relabeled as proof of a later schema. Earlier one-time application and fixture
permissions have been consumed and do not authorize a new local replay.

## Phase 3 — Coordinate schema and production promotion

Owner: maintainer for the exact operation/window; coordinator prepares the
reviewable manifest and verifies results. Use the reviewed
`docs/guidance/audit-database-rollout-2026-10.md` from #1463 and the canonical
schema authorization checklist and production migration skill.

Migrations and matching application changes form **one promotion unit**:

| Migration | Coordinated contract |
| --- | --- |
| `244_test_attempt_revision_and_return_guards.sql` | Versioned Start/save/submit and atomic Return; old unfenced non-null save/submit fails closed. |
| `245_managed_storage_write_lock_order.sql` | Compatible storage RPC/ACL signatures with corrected lock ordering and retry. |
| `246_auth_verification_generation_fence.sql` | Fenced auth RPCs and revoked direct verification-table access; old direct-table routes are incompatible. |

1. Inspect actual hosted migration history and relevant flags read-only. The last
   hosted history was freshly verified on 2026-10-04 as exact 001–225 (225 rows,
   no missing/extra versions) in the environment-bound production project.
   The complete candidate pending chain is **226–246**. Recheck it in the
   pinned workflow preview and review prerequisite release gates before applying.
2. Prepare the exact target, reviewed source SHA, migration filenames/hashes,
   release revision, preview output, traffic-drain procedure, canaries and
   compatible recovery decision. Use the production skill's manual GitHub
   workflow preview. Obtain one-time authorization naming the exact target and
   complete migration set before applying; separate fixture permissions remain
   separate. Do not introduce a hosted staging/Preview prerequisite.
3. Coordinate the application and schema transition. Pause/drain Test save/submit
   and verification-confirmation traffic as the runbook specifies. Schema-first
   alone breaks old routes; application-first alone lacks new RPCs. An older
   unfenced application is not a compatible rollback. Prepare a reviewed release
   retaining the new contracts and fix forward if necessary.
4. Promote through the protected `main` → `production` PR flow under its own
   authority gate. Apply the approved schema operation in the coordinated window,
   verify installed functions/history/types, and record actual release identity.
   An attempted application consumes its permission even after partial failure;
   inspect durable state and obtain fresh exact authority before retry.
5. Resume traffic only after approved synthetic canaries pass: signup/password
   establishment, reset/password replacement and old-session refusal, login,
   resend invalidating prior handoff, and versioned Test Start/save/submit. Check
   close/Return grade consistency, storage upload/cleanup, survey validation,
   grading freshness and affected UI roles. Observe summary completion, timeout,
   pending IDs and retry/resume under real provider latency.

Exit evidence: actual schema and application receipts on matching revisions,
passed canaries and observations, and explicit production verification for each
affected finding. Keep unrelated flags and epic status unchanged absent their
own exit evidence; never infer hosted state from a source merge.

## Phase 4 — Resolve the remaining braces advisory

Owner: coordinator prepares a bounded dependency proposal; independent reviewer
checks compatibility; maintainer decides any remaining exception. The read-only investigation and coordinator reproductions are complete. A
temporary exception through 2026-11-04 was accepted by Stewart Chan when directing
the recommended release to proceed; it keeps depth mitigation and the advisory visible. Width expansion
and a plain-AST parent cycle were reproduced; verified Pika inputs are small
repository-authored build globs, with no request-controlled path established.
Full proposal: `/Users/stew/.codex/audits/pika/2026-10-04-broad/advisory-resolution-proposal.md`.
Further authorized remedy work can run alongside landing; it does not
require altering the already reviewed #1467 head.

1. At execution, refresh the advisory scan and resolved dependency graph. Recheck
   upstream fixes and compatible parent upgrades/removal. The recorded path is
   typography → Tailwind → chokidar → braces in build/watch tooling; package
   presence alone does not prove a Pika request-path exploit or absence of risk.
2. Prefer a compatible fix through existing packages. If none is available,
   prepare a bounded local patch covering remaining resource-exhaustion cases,
   with explicit input/depth/width/cycle behavior and preserved valid glob
   semantics. New/replacement dependencies require explicit approval.
3. Verify adversarial cases and normal parsing/glob/build/watch behavior, plus
   editor, image, Markdown and serialization regressions. Commit the reviewed
   lockfile/patch and record the exact fresh scan. Do not suppress the advisory
   merely to make the report green.
4. If full resolution is unsafe or unavailable, prepare a concrete exception
   documenting remaining cases, verified reachability, mitigation limits,
   named owner, review date and reassessment trigger (upstream fix, new
   reachability or mitigation failure). Acceptance requires an explicit owner
   decision.

Exit evidence: advisory absent from the resolved graph with compatibility proof,
or a specifically approved exception. Report these as different dispositions;
the depth-128 patch alone does not establish full resolution. Do not invent a
recurring automation or close the remaining advisory silently.

## Phase 5 — Reconcile closure and AI navigation

Owner: coordinator. Entry: recorded landing/rollout results and advisory decision.

Update the same finding ledger with separate source-reviewed, merged,
schema-applied and production-verified fields and exact receipts. Reconcile
CURRENT, feature verification text and the recent session log with actual state;
change epic status only when all of its independent exit gates are met. Run the
session-log trim/check and canonical startup so future agents can navigate the
new state without treating pending rollout as completed work.

Guidance and tooling findings close with merged-source/startup or CI evidence;
mark hosted-schema/application steps as not applicable where appropriate.
Runtime findings require the relevant deployed behavior and canary evidence.

Exit evidence: all 27 rows reconciled to actual deployment state, no unowned open
integration findings, and the dependency residual explicitly resolved or accepted.
Preserve coverage limits: this was a bounded broad audit, not proof that the
entire codebase has no other defects.

## Orchestration and stop conditions

The current task remains coordinator and sole Git/PR/shared-state writer. This
plan update is handled directly; it does not need another worker or goal.
During execution, delegate only substantial bounded review/investigation that
reduces total effort. Use GPT-6.1 Sol/high for contract/integration review,
GPT-5.6 Sol/high for independent high-risk auth/database review when available,
and GPT-6.1 Sol/medium for narrow guidance/continuity verification. State the
actual selected model and supported reasoning at dispatch, keep worker ownership
exclusive, prohibit recursive delegation and verify delivery before acceptance.
Record lightweight time, available account usage, rework and coordination evidence
without claiming attributable savings. DeepSeek remains paused through 2026-12-31.

The owner's task-scoped override remains in effect for low/unknown usage and
workflow review budgets. Those conditions alone do not require renewed approval.
Still stop dependent actions for an explicit user hold, actual provider/runtime
limits, missing credentials/capability, unresolved correctness/review gates, or
missing specific authority for migration application, fixtures, merge or production
promotion. Prepare the concrete manifest/release first so any required approval
is the final decision. Respect no-new-dependency, Toronto deadline, UI governance
and secret-handling constraints throughout.

### Canary-discovered forward correction

`248_test_conflict_http_status.sql` replaces the four migration 244 Test
functions that raise business conflicts with SQLSTATE 40001. It changes those
five raises to PT409, retaining their signatures, ownership checks, locks,
security attributes and ACLs. API consumers accept both codes during rollout.
Supabase [documents the hosted PostgREST 14 retry loop](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
The real HTTP lifecycle regression now requires reopened Return to finish with
409 within 15 seconds and preserve withheld student results. Historical migration
244 is unchanged. Do not apply 248 or resume public traffic until its required
review/checks, exact permission, matching deployment, canaries and cleanup pass.
