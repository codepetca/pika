# Broad codebase audit remediation

Coordinator checkpoint: 2026-10-04. Audit and implementation base:
`3c5d7097e78258f70c368789e14f88ac2419c1d8` (`main`, PR #1460 merged).
The owner authorized planning and orchestration of fixes in this task.

## Outcome and evidence

Resolve the 27 supported findings from the broad audit, including workflow and AI
navigation inconsistencies. Revalidate each against current source, implement a
bounded remedy, prove the affected behavior, and deliver independently reviewed
PRs with stable revisions. Preserve the distinction between a source fix, merged
code, applied schema, and production rollout. A disproved finding needs evidence;
an unresolved or deferred finding remains open with its reason.

Audit evidence is retained at
`/Users/stew/.codex/audits/pika/2026-10-04-broad/`: `audit-report.md`,
`findings.json`, lane reports and reproduction receipts. The existing
`handoff.json` carries the coordinator's execution state, worker receipts and
acceptance decisions. This document is the repository entry point to that plan.

The initial audit was representative source inspection with targeted tests. It
did not establish deployed state or execute database races and browser attacks.
Its passing baseline does not prove a remedy.

## Execution order and ownership

Use the smallest team for each ready batch. The coordinator owns integration,
Git operations, PR state, shared continuity and final acceptance. Workers have
exclusive file ownership and may not recursively delegate. Initial independent
lanes share `codex/audit-remediation` with no concurrent Git mutations. Split
verified deliveries into narrow branches before publication where their review
and rollout boundaries differ.

1. **Authentication and guidance, alongside bounded API/cache/tooling repairs.**
   Auth implementation: GPT-6.1 Sol/high, for credential races and compatibility.
   Guidance/startup and API/cache/tooling implementation: GPT-6.1 Sol/medium,
   for concrete findings with focused acceptance checks. These are implementation
   assignments; none substitutes for independent review.
2. **Test lifecycle and required browser coverage.** Establish the revision and
   transaction interfaces before changing clients and SQL. Keep the lifecycle
   migration and its server/client contracts in one coherent review.
3. **UI interaction and failure states.** Record reference surfaces and reuse
   decisions before implementation. Verify keyboard behavior, scoped errors and
   physical target geometry in the declared browser matrix.
4. **Nightly execution and dependencies.** Bound providers and resumable work;
   evaluate coordinated compatible package upgrades and explicitly handle
   advisories without available fixes. Keep editor changes separately reviewable.
5. **Storage locking and final reconciliation.** Prove a consistent lock order
   with a two-session database harness. Recheck all findings, PR gates, schema
   evidence and required deployment decisions.

Independent ready work can advance while a database or review decision is
pending. Do not launch speculative future writers or merge unrelated fixes
into one large PR merely because they share this audit.

## Finding acceptance matrix

All entries start open. Implementation delivery, coordinator verification,
independent review and rollout status are recorded separately in the handoff.

| Finding | Batch | Required evidence before acceptance |
| --- | --- | --- |
| S1 | 1 | Signup and reset reject older codes after the newest issuance is consumed; newest issuance remains authoritative. Identify and fence issuance/verification races rather than claiming a reread is transactional. |
| S2 | 1 | Two sibling signup handoffs competing on an initially unset password produce one credential winner and no losing session; session epoch remains fenced. |
| S3 | 1 | Foreign-Origin simple-form login is rejected; supported same-origin and documented headless JSON requests retain their contract. |
| S4 | 1 | New credentials respect bcrypt's 72 UTF-8-byte limit, including Unicode boundaries; existing stored credentials still verify compatibly. |
| G1 | 1 | Canonical landing instructions use the draft/review/stable-SHA/PR Gate lifecycle and normal merge authority. No direct-main workaround remains. |
| G2 | 1 | Provider route prompts resolve to current server factories and a maintained, valid boundary example. |
| G3 | 1 | CURRENT labels dated source and recorded database/rollout checkpoints; merged #1460 is distinguished from pending #1461 proof and hosted state. |
| G4 | 1 | Feature verification text separates recorded completed receipts from outstanding epic gates; status changes require exit evidence. |
| G5 | 1 | Status routing labels historic MVP work and points at current epic plans; shipped history is represented accurately. |
| G6 | 1 | Setup describes shipped capabilities and package-derived platform versions. |
| G7 | 1 | Legacy load-context follows canonical compact startup and task routing. |
| G8 | 1 | Missing required startup inputs fail with precise errors, including context-loaded mode; orient-only intentionally skips environment work; valid detached checkouts remain supported. |
| G9 | 1 | Audit skill commands point at an existing runnable script. |
| PAT-06 | 1 | Cache guidance throws on HTTP errors and explains freshness without caching error payloads. |
| PAT-01 | 1 | Fresh grading polls retain no historical snapshots; zero TTL does not retain values, and in-flight deduplication remains valid. |
| PAT-02 | 1 | Null, arrays and malformed survey fields return 400; authorization, partial PATCH and lifecycle rules remain intact. |
| V3 | 1 | Changed executable script sources select their imported test consumers; launchers do not invoke themselves or unnecessarily select the full suite. |
| CORE-01 | 2 | Serialized form saves plus server revision fencing retain newer answers under delayed-old writes and two clients sharing a base revision; recoverable conflicts preserve local work; submit/close controls pass. |
| CORE-02 | 2 | Started unanswered MC work closes and returns with explicit zero-scored rows and matching result/Gradebook/Grades eligibility. Cover blank, unstarted, mixed and reopened attempts. Never globally convert missing drafts to zero. |
| CORE-03 | 2 | Return eligibility is checked under compatible ownership/parent/attempt locks; reopen and grade-clear interleavings cannot return stale work; counts reflect actual transitions and idempotent replay. |
| V1 | 2 | A bounded real exam lifecycle browser set is selected for relevant changes and full CI, with isolated fixtures proving lock, restore, close/reload and telemetry contracts. Listing specs alone is insufficient. |
| PAT-03 | 3 | SplitButton owns keyboard events only inside its open menu, supports roving focus and normal Tab exit, and preserves Escape and newly opened dialog focus; browser verification completes. |
| PAT-04 | 3 | Calendar failures show a scoped retry state; classroom A's data cannot appear under B after a failed switch; initial error cannot masquerade as setup. |
| PAT-05 | 3 | Artifact actions preserve density with non-overlapping 44px targets and visible focus; physical browser measurements and affected teacher/student views pass. |
| V2 | 4 | Provider calls have explicit deadlines; invocation work is bounded; durable progress resumes unfinished dates/classrooms without starving optional feedback or losing summaries; timeout/retry tests pass. |
| DEP-01 | 4 | Coordinated editor/transitive upgrades are compatible, serialization/image/Markdown regressions pass, and a fresh advisory scan records fixed packages and any justified unresolved exception. Package presence is not application exploit proof. |
| D1 | 5 | Forward migration uses one compatible exact-path/managed-row lock order, including absent rows; actual two-session upload/cleanup controls avoid the demonstrated cycle. |

## Authority and review gates

- No new dependencies without explicit approval. Existing-package upgrades need
  compatibility evidence and a committed lockfile.
- No local or production migration application without one-time authorization
  naming the target and exact prepared migration. Never mutate the shared local
  database to unblock a worker. Generated database types are not edited manually.
  CI's disposable replay remains a separate verification gate.
- UI changes use `pika-ui-change` and `pika-ui-verify`; both roles are covered when
  affected. Source inspection or interaction tests alone do not close visual work.
- Follow `docs/dev-workflow.md`: focused checks, draft PR, risk-matched independent
  review, batched corrections, stable reviewed SHA, ready CI and PR Gate. Merge
  and production promotion retain their separate authority gates.
- On 2026-10-04, the owner directly instructed this coordinator task
  (`01a10695-f3c2-7532-97f4-3fbad0c2cbd3`): "Override stoppages to continue with
  current work." The task-scoped `override-task-stops` skill waives low-usage and
  workflow review-budget stops for this remediation, preserving cumulative review
  counters and correctness/authority gates. This receipt is not authorization for
  another task. DeepSeek remains explicitly paused through 2026-12-31. Actual
  execution limits, human holds and separately specified user budgets still apply.

Closure means every finding has accepted evidence or an explicit, evidence-backed
disposition and every required gate for the agreed outcome has been satisfied.
Preparing this plan or opening a draft PR does not complete the remediation goal.
