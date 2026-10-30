# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-10-24 — Manual grader label owner-read regression

The dedicated pilot saved manual scores, then owner readback failed503 because
the strict detail schema treated graded_by as an actor UUID. Installed manual
writer223 stores teacher text; existing grading/list contracts already accept
text. Align only this metadata field, retaining owner/member UUID checks and
strict shape/size guards. No migration, stored-data repair or authorization change.
An installed-SDK RED reproduced the503; GREEN101 tests covers manual text,
AI/model/legacy UUID/null compatibility and malformed/missing refusal. Full
focused4418 PASS/8SKIP plus architecture, UI/design policy, TypeScript and lint;
independent review and exact-head CI follow. Both pilot sessions remain signed
in; Return/learner feedback remain pending compatible release and readback.
No production, cohort, provider, plan or schema change; growth stays frozen.
First CI caught the prior pilot summary's changed controls marker; restored
the accurate established Controls unchanged prefix without reverting admission
or provider state. Runtime grader fix unchanged; targeted docs regression and
independent delta review precede the next stable-SHA CI.

## 2026-10-24 — RepoLight integration foundation (in progress)

Task01a15c49-e31b-7060-8c2b-a7d1bc347706 owns codex/repolight-integration. Public repo reports only; Pika keeps marks/comments/Return. Added canonical contract/client and source-only293 foundation;73 focused source/client/policy tests pass. Owned ephemeral native replay/types, portable archive/provider cleanup adoption, routes/UI/visuals/review remain pending. No sharedlocal/production migration, credentials or provider activated. See docs/integrations/repolight.md; coordinator plan lives in RepoLight docs/REVIVAL-PLAN.md.

## 2026-10-24 — RepoLight publication approved

Owner approved branch publication and main merge after required CI. Product code
remains reviewed36ca8cd70; only continuity evidence refreshed. Local5892tests,
native/HTTP/archive/browser and final reviews pass. Analyze OFF;293 unapplied
shared/prod. Publish draft, mark stable head ready, require PR Gate; no deployment
or production promotion. Optional AI stays RepoLight-owner-only and disabled.

## 2026-10-24 — RepoLight CI compatibility remediation

PR1681 held as draft after40154111852: full coverage found two stale292
proof-target assertions and CURRENT receipt-label drift;22,346tests passed.
Both isolated runners now admit only the sealed293 target through the existing
closed validators, retain historical sources and reject changed/renamed293/294.
CURRENT restores recorded DB/control/attendance labels within17k. SourceSQL293
and app behavior unchanged. Local37runner/profile and83receipt tests pass; actual
offline native replays and targeted independent review tracked in PR evidence.
Shared/prod293 remains unapplied; Analyze OFF. No provider activation.

## 2026-10-24 — Complete current-chain native proof audit

Caught the remaining Home visibility292 cutoff before merge; PR1681 held as
draft and40155285541 cancelled. Home manifest now requires the exact293 seal
while retaining historical dirty-tree manifests and all clone/source guards.
76unit tests/types/lint/syntax pass. Real293Home replay, rollback/recovery,
two-session contention and generated types pass; shared fingerprints unchanged.
Audit of159direct scripts,20package aliases,282reachable files and120shell
scripts found no remaining current-chain cutoffs. NoSQL/app/flag changes.
Final targeted review and exact-head CI remain required; Analyze OFF.

## 2026-10-24 — RepoLight warning-level SQL lint correction

User approved one further fix batch and eighth independent review (30-minute
extension) before rerunning CI and conditional main merge. Cleanup discovery
initializes its empty array with an explicit JSONB cast; both current migration293
seals refreshed to b03d4dccd88ecbbf06d103b57c0cee97fccd6b07f13dfc2b0a4ed438fd68d052.
An owned offline001–293 replay reproduces SQLSTATE42804 with the original initializer;
the corrected schema is warning-free across569public/private PL/pgSQL functions
using CLI2.103.0's query. Home rollback/recovery and real two-session contention
pass; generated types and canonical-preservation checks retained. Required local
focused checks, targeted review and exact-head PR Gate remain merge prerequisites.
No shared/prod migration or provider activation; Analyze OFF.

## 2026-10-24 — RepoLight legacy archive inventory correction

Owner approved one additional proof-only fix batch and ninth targeted review,
then exact-head CI and conditional main merge. The legacy archive check now
counts RepoLight's three resources/revision triggers when its table family is
installed, matching the existing archive-v2 compatibility condition. Strict
inventory equality remains; SQL293 and both b03d4dcc seals are unchanged.
Owned offline293 replay passes the actual archive lifecycle, compaction/races,
Gradex and legacy Quiz backfill/restore/v2 checks. Platform ACLs preserved in
clone setup; no shared mutation. Home recovery/contention, warning lint across
569functions, generated types and canonical aggregate fingerprints pass.
Focused5966tests/one skip, types/lint/architecture/UI/design pass. Ninth targeted
review and exact-head PR Gate remain required; Analyze OFF, shared/prod293 unapplied.

## 2026-10-25 — Refresh the grading inspector after Return

The dedicated-account manual canary exposed a stale revision after a successful
Return. Refresh the open learner inspector only when the acknowledgement marks
that learner returned/already returned, before awaiting list refresh. Existing
read fences, dirty-form handling and revision-conflict refusal remain intact.
RED component regression reproduced unchanged inspector; focused owner/controller
141 checks pass. Synthetic real-parent/controller browser flow saves and sends
with the refreshed revision without document reload; teacher/student desktop/
mobile light/dark matrix8cases passes. Final teacher captures scroll the sent
comment into view; existing learner recovery coverage is unchanged. Two initial
driver failures (modal accessibility scope, then same-document navigation counted
as reload) are retained; corrected semantic/time-origin checks pass unchanged
app code. CI browser inventory retains all prior cases and adds this scenario.
Reconciled actual #1683 production receipt/source6eacd7540 and manual canary with
normal reload recovery; this automatic-refresh fix still requires review/CI/main
merge and separately authorized compatible release. Same3cohort/schema/plans and
provider holds remain, with no production action or live-provider call.

## 2026-10-25 — RepoLight SDK catalogue and CI memory correction

Owner explicitly overrode task workflow review-budget/low-usage stops through
completion; keep independent review, strict CI and normal merge/rollout controls.
Nine targeted reviews are recorded; next delta receives actual tenth review.
Shared proof catalogue now includes ten literal tables from sealed293; member
proof retains explicit292 admission and rejects partial/unknown catalogues.
Historical unit profiles stay pinned; complete293 preservation includes private
state, missing-fingerprint and restoration-drift checks. Two reorder fixtures
now fingerprint the same complete source-defined family; assertions unchanged.
CI's89light-browser failures followed one Next dev heap OOM; CI-only supported
--disable-source-maps removes automatic server-map tracking. Numeric RAM/cgroup/
config-process heap diagnostics added; no environment/heap dumps, assertion,
project, timeout or compiler change. Full browser gate still required.
Synced onto main7c275690 (#1682 owner-read fix): only continuity conflicts;
upstream code/tests/pilot receipt byte-identical, original checkpoints archived.
SQL293/b03d4dcc seals unchanged. Focused checks, tenth review and actual pinned
CLI SDK lifecycle are required before ready; Analyze OFF, shared/prod293 unapplied.

## 2026-10-25 — RepoLight rebase after green CI

CI40190824792 passed all ten jobs on0c159847e, including repaired member-list
SDK and full light-browser matrix. Before merge, main advanced to19b5abab9
(#1684 selected-inspector refresh after Return), creating continuity conflicts.
Rebased feature commits; only CURRENT/archive conflicts required resolution.
Kept upstream Return refresh, tests and UI brief; retained Prod6eacd7540/#1683
receipt and all held controls. No new deployment/query/provider authority.
SDK/catalogue/SQL293/b03d4dcc/browser-memory sources remain byte-identical to
reviewed/native-verified0c. Existing normal/forced SDK evidence is retained by
that equivalence; new-head CI still reruns the actual proof. Focused checks and
one targeted main-sync review precede ready; task stop override remains active.

## 2026-10-25 — RepoLight local pilot and repeat-click guard

Authenticated synthetic teacher/student browser pilot collected a real public report, switched contributor/evidence views and appended edited feedback. Repeated Add exposed duplicate explicit imports; workspace per-report/scope/text completion guard now disables already-added previews. Regression first failed, then component/hook/panel and focused tests plus type/lint/policy checks passed. Teacher/student desktop/mobile light/dark inspected. Scoped cleanup proof and independent review are recorded in private pilot receipts. Hosting target, shared/prod293 and deployment remain pending; AI off. No Zero changes.

## 2026-10-25 — Reconcile deployed classroom pilot acceptance

Record protected production1685/9a and actual seamless Assignment Return/comment
persistence. Reviewed bounded API attempt4 passed34requests: normal email-code
sessions, reciprocal owner/member reads, contextual read/write/student-target
denials, Free create403 and one-create/exact-replay without duplication. Scoped
read-only SQL matched five protected fingerprints; Aowns2/B1/Control0, plans and
original work unchanged. Exact3cohort/provider24metadata/pageflags pre/post match.
Earlier failed attempts remain spent. Retain the one new empty synthetic class.
Reconcile receipt/readiness/roadmap/CURRENT; no runtime, schema, UI, account, plan,
configuration, production or provider action. Remaining work is candidate-specific
evidence applicability and separately authorized observed expansion; isolated
domain proofs and layered recovery are not all-domain/deployed outage evidence.
Main-only docs review/CI follow; no overall-goal completion or production authority.

## 2026-10-25 — RepoLight production migration and release

Human approved production293 once plus reviewed1687 and the coordinated lifecycle
window. Apply40226843818 verified only293/history001–293 and the approved digest.
Catalog/RLS/ACL/body/trigger/archive checks pass;13renamed originals preserved.
PR1687 merged dbd1f62c1; Vercel dpl_tCawB6aLRNnQN6FBxw35QinNZtx8 READY on that SHA.
All10 CI40222687057 jobs and public HTTP boundaries passed. Cohort/provider
metadata unchanged; Analyze/AI OFF; shared local and fixtures untouched. Window
released to both coordinated Pika tasks. Connection provisioning and hosted
integration acceptance remain pending. Standalone inventory diagnostic limitation
is tracked in the integration guide/PR; no passing claim for that command.

## 2026-10-25 — Controlled RepoLight connection and blank-login regression

User authorized the controlled owner/workspace pilot. Installation-bound create/read/erase
attestation and one sensitive server connection passed; unchanged reviewed dbd1f62c1
redeployed READY. Analyze server/DB gates ON for the configured owner; AI OFF.
Original24 provider/Home cohort controls preserved; no schema reapply or role/plan change.
Normal controlled student join/repository save/submit PASS. Teacher overview exposed
own undefined optional GitHub metadata; mapper now omits absent fields. Regression
failed first;227 affected tests pass, raw malformed payloads still rejected. Review/CI
and source release pending; no report/import/grade/sent-feedback acceptance claimed.
Private connection/pilot receipts remain outside Git.

## 2026-10-25 RepoLight contextual-owner report admission

Blank-login fix#1690 and promotion#1691 passed final-head CI; production45a604275
is READY. Overview now loads; pilot stopped before Analyze because report routes
required global Teacher for admitted contextual owner A. No report/import; AI OFF.
Draft preparation briefly saved zero marks in Final mode; normal Draft restored
all synthetic marks/graded/returned fields to null. Production window released
to coordinating Pika tasks; roles/cohort/schema unchanged. Source correction uses
shared admission with legacy Teacher fallback, retaining owner/source/lease fences
and dormant pair flags. Real owned ephemeral293 rollback contracts passed with
a Student-labelled owner and synthetic creation grant; fixture resources removed.
Route regressions and independent auth/compatibility review precede CI and specific
owner merge/release approval. Hosted report/edited-draft pilot remains incomplete.

## 2026-10-25 RepoLight release and hosted quota stop

1692main73a65fb8b and1693production405ef92cc passed final-head CI/alltenjobs;
canonicalREADY dpl_9eR44SBCseFRjBik1GRJyJNeNcg5. Two auth reviews plus cumulative
promotion review passed; all6276parent journal occurrences preserved. Controlled
Student-labelled owner access and blank-login overview PASS. One hosted analysis
failed upstream_rate_limited after3worker attempts;0reports/imports. Full before/after
assignment_doc equality PASS; submitted/privateprefix preserved, marks/returnednull.
AIoff; original24/Home3/feature3 controls unchanged, schema293 unchanged. Window
released to coordinated Pika tasks; fixture/lastcleanupcredential retained. Public-read
GitHubtoken vs Appdiscussion/unauthenticatedwait decision pending; no new token or
provider change. Contract: docs/integrations/repolight.md. Epic remains incomplete.

## 2026-10-26 Future post dates

Announcements and posted Classwork materials accept future Post date values.
Schedule explicitly sends the existing scheduled_for contract at Toronto midnight;
today/past dates retain posted_on. A field hint discloses student hiding. No schema
or dependency changes. Risk none. Reference/reuse: production Material editor and
Pattern Lab; extend both feature editors, reuse FormField/Input/SplitButton and
existing scheduling. No new shared UI pattern or unrelated refactor. Composite
checklist reviewed: labels/descriptions, enabled actions, existing keyboard/focus
contracts retained and interaction-tested; no new ARIA widget.
Focused1890/102 and architecture/UI/design/TS/lint PASS. Feature135 tests and
material-owner88 PASS; student/API scheduling checks PASS. Playwright8 matrix
cases PASS across1440x900/390x844 light/dark (one stale punctuation selector
corrected then targeted desktop rerun). Teacher focused/future/invalid/saved and
student reading/hidden screenshots inspected under /tmp/pika-future-post-browser
and /tmp/pika-future-post-browser-final; montage /tmp/pika-future-post-matrix.png.
Material student editing n/a (teacher-only); existing student release API checks
reused. Capture source equals this candidate's UI files; deterministic fixtures,
Playwright1.58, localhost3127, October26 Toronto. Shared env unchanged; temporary
process secret used. Draft PR and independent review follow; merge/release require
authority. Weekly remaining84%; DeepSeek pause honored; coordinator handles edits.

## 2026-10-27 Accept the bounded 70-account classroom rollout

Consolidated the authorized dedicated/owner/P3/P5/PPZ expansions on runtime405
and schema293 into the dated70-account acceptance receipt. Retained actual
signed-in versus isolated/source-qualified boundaries, exact roster checks,
selected academic preservation and compatible recovery constraints. PPZ keeps
Tests/native attendance off/no policy/mapping/manual log unchanged. Original
observation gap remains historical; the fresh08:04–08:34 Toronto readonly window
passed7timely samples and final exact70/provider/work readbacks. Timed process
exited, watcher deleted, Audit relayed explicit release. CURRENT/roadmap/Home and
historical pilot now point to bounded acceptance; wider admission/provider/billing
holds and incomplete epic/paused goal remain. Documentation only; no live action.

## 2026-10-27 Prepare wider classroom admission design

Prepared a proposal for one durable service-owned admission source, exact70
bootstrap retention and staged expansion/new-user policy. Current Home/API each
cap100; Bara also selects protocol behavior from admission. The plan requires
Home/API consumer migration and frozen bootstrap provider-compatibility decisions
before widening, with current nonadmitted behavior preserved too. New grants use
atomic approved batches/growth stop; automatic signup stays off until separately
approved. Rollout stages and exact-source recovery/verification gates are recorded;
no code, SQL, cohort, plan, production or provider operation performed. Existing70,
all other holds and paused goal/DeepSeek remain unchanged.

## 2026-10-27 — Scheduled assignment card date order
- Branch `codex/scheduled-date-card-order`: reuse SortableAssignmentCard; scheduled release now precedes due date. Existing formatting/status/actions unchanged. Other list owners inspected: Tests have a calendar date/manual access but no due date; materials/announcements have no due date; surveys have no scheduling. Student n/a: future assignments hidden.
- UI brief: approved Classwork/Tests family and Pattern Lab workspace framing; teacher desktop/mobile, light/dark, scheduled/default + keyboard focus; reading order is the primary signal. No new pattern, component, composite behavior, experimental promotion or refactor.
- Evidence: focused gate 79 files/1,209 tests plus architecture/UI/design/TypeScript/lint PASS; audit PASS. Playwright actual Classwork list via intercepted fixture APIs 4/4 PASS, y-order/no-overflow assertions and all four screenshots visually reviewed. Screenshots `/tmp/pika-date-order-pattern-lab-{desktop,mobile}-{light,dark}.png`; repeatable driver `/tmp/pika-scheduled-date-order.ui-pattern-lab.spec.ts`; logs `/tmp/pika-date-{unit,browser,audit}.log` and `/tmp/pika-scheduled-date-focused.log`. Browser first launch lacked session secret; rerun with generated process-only secret passed.
- Draft PR#1698 initially paused at the 4% weekly-usage checkpoint. Owner explicitly authorized continuation despite low usage, then PR and merge, on 2026-10-27 in chat 01a17da9-f37c-7872-bbcc-268e37a3f5fd. This task-scoped low-usage waiver persists through completion; ordinary review/check gates remain. DeepSeek stays paused through 2026-12-31. Review ledger starts at 0 launches/waves/fix batches; one Luna/medium reviewer on a fixed SHA. Risk profile none; no epic status change; production promotion excluded.
- Independent review1: GPT-6 Luna/medium accepted full four-file diff at c9d2b342f; zero findings. CI40537585928: 22,485 tests passed, eight existing skips, one pre-existing CURRENT-format contract failed; all three browser lanes failed before assertions on GHCR image-download rate limits. PR returned to draft before corrections.
- Remediation batch1 preserves CURRENT's recorded values while putting DB001–293 at the start of its own line and naming the existing unchanged-controls statement, restoring compatibility with the existing attendance guidance test. No application change or rollout action. Source/tests/UI remain identical to the visually verified implementation. Targeted re-review and fresh required CI follow.

## 2026-10-27 — Investigate CI registry throttling for PR1698
- Owner authorized orchestrated investigation/fix and merge after all required checks pass. Existing task-scoped low-usage waiver retained; no billing/reset/provider-pause change. Risk profile runtime-platform. Branch remains codex/scheduled-date-card-order; PR1698 returned to draft before implementation.
- Terra/medium handled bounded read-only CLI2.103.0 source/log investigation, then received sole write ownership of workflow, registry-workflow tests and the two CI workflow/runbook docs; coordinator owns integration/log/review/merge. Native execution accepted despite exhausted ordinary allowance; no credential/provider workaround. Investigation accepted after independent manifest verification; worker/coordinator tokens and exact active time unknown, no savings claim.
- Auth was used correctly; pinned ghcr.io/supabase/postgres:17.6.1.132 repeatedly returns HTTP429, including public manifest requests outside Actions. Official public.ecr.aws mirror is reachable. Coordinator verified ECR and Docker Hub index bytes share sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13; linux/amd64 child9d50688a826cf1455a0e91013160171de73b4d31df1509014e73463fb276a84d. GHCR digest parity could not be checked and is not claimed. Primary sources: pinned CLI internal/utils/docker.go and config/templates/Dockerfile; supabase/postgres .github/workflows/mirror.yml. No live database or image-layer download performed.
- Plan: restore official CLI-default public ECR, remove unnecessary GHCR permissions/login/cleanup from current CI, preserve historical exact-auth safety contracts, all pinned versions, lanes, commands and gates. Existing obsolete exclusion names are out of this repair scope. Verify targeted tests and focused gate, independent risk-matched review on fixed SHA, then one fresh required native CI run and squash merge only after final PR Gate passes.
- Terra implementation accepted in five owned files (local-ci test ownership explicitly extended after six stale GHCR expectations surfaced). Targeted registry/auth/workflow/local-runner suites PASS430 tests/4files; coordinator inspected diff and confirmed parser/native auth guards unchanged. No files/edits conflicted. Current ECR plan omits all seven GHCR credential blocks and extra permissions; reconstructed historical GHCR plan keeps exact-auth/drift coverage. No registry layers or databases started locally.

## 2026-10-27 Prepare inactive admission registry

Implemented stage0 source: candidate294 service-only registry, exact atomic/idempotent
batches and growth stop, request-scoped async reads, shared Home audience and frozen
bootstrap attendance protocol selection. Existing version1 and70 stay active.
Isolated001–294 replay/ACL/rollback/committed races/source preservation and genuine
types pass; first harness import failure retained and fixed. Focused11735 tests
passed, plus architecture/UI/design/TypeScript/lint. All294 tables join sealed whole-row
proof catalogs; historical profiles retained. Review found a concurrent growth-stop
race; one correction gives restrictive stops priority, preserves original replay
binding and records actual predecessor; four review turns are clean. CI coverage
passed22623 tests but failed one inherited CURRENT-label assertion. Restored the
factual production/control receipt labels;83 targeted checks and local build pass.
Fresh final CI remains pending. No shared
local/prod migration/import/release/config/provider/account action; goal/DeepSeek paused.

## 2026-10-27 Admission registry integration with current main

Rebased1699 onto9756a9751, retaining the reviewed294 SQL and registry behavior.
Resolved continuity conflicts by preserving canonical production/control labels
and both substantive journal histories. Main's official ECR image transport and
scheduled-date display changes remain intact; no UI or SQL behavior changed here.
Earlier GHCR setup failures remain historical. Focused integration checks and a
proportional independent delta review precede fresh reviewed-head CI. Existing70,
provider/schema/release holds and paused goal/DeepSeek remain unchanged.

## 2026-10-27 Restore isolated CI image authentication after quota failures

#1699's current-base build22626 tests, primary SDK and browser matrix passed; five
other lanes failed ECR image startup in attempts1/3; one serialized attempt2
failed identically. Kept failed evidence. Normal bounded GHCR Postgres17.6.1.132 pull succeeded
locally; cache reuse is possible and final CI is still required. Returned draft
before restoring the previously reviewed GHCR workflow and exact auth/drift tests,
retaining historical ECR coverage. Registry helper/parser/native guards and every
noncredential lane step stay unchanged. No SQL, product/UI, version, deadline,
provider, shared schema, release or70-account configuration changes. Goal/DeepSeek
remain paused. Targeted checks, focused gate and independent delta review precede
one stable ready event; no registry fallback or automatic extra retry is added.

## 2026-10-27 Independent calendar post dates

Owner clarified: calendar placement is independent of release, superseding Oct26's
future-date-as-schedule interpretation (never deployed). PR1695 returned to draft.
Calendar date defaults today for new posts; past/future edits retain Post/Save.
Release metadata says Releases; Schedule retains explicit release timing. New,
draft, posted and scheduled editors retain independent placement. Student lists
keep published content; every Calendar view applies the server advance horizon
for announcements/materials, failing closed while unconfirmed. Test exceptions
remain navigation-only. Existing Material/announcement owners and Pattern Lab
are reference; reuse FormField/Input/SplitButton, extend feature adapters; no new
shared visual pattern or dependency. Composite labels/hints/actions and existing
keyboard/focus contracts retained. Risk none; review high (schema/owner RPCs).

294 adds nullable posted_on and atomic create wrappers. No backfill or historical
SQL edits. Existing locks/immutable/after-row/ACL guards retained; null mutation
keys omitted for legacy decoders. Coordinate app/migration rollout; no shared or
production application authorized. Shared local history292 and normalized schema
unchanged. Private001–294 replay, rollback/tamper/atomic/date/state/ACL proofs and
type equality PASS /tmp/pika-material-post-date.Op5td6; all owned clones removed.
Source seal7b4d0853057c7876f4f45bdeaf568e8a62425ff53391fef7ada62bf63ce482d3.

Initial focused5733/175 + static PASS. Added coverage passes175 source/list and175
interaction tests; corrected browser inventory count and235 regression recheck
PASS. Final focused gate/review/CI receipts follow in PR1695. Twelve Playwright
matrix cases PASS across teacher/student1440x900/390x844 light/dark; additional
new/draft/scheduled editor captures inspected. Evidence /tmp/pika-calendar-post-
placement-browser, /tmp/pika-calendar-visibility-probe, /tmp/pika-calendar-visibility-
final and /tmp/pika-post-placement-editor-states-final (desktop-light probes named
similarly); montage /tmp/pika-calendar-post-placement-matrix.png. Current candidate
source, synthetic production-owner fixtures, Playwright1.58, localhost3127; calendar
clock fixed Oct20 for window proof. No live classroom mutation or shared env edit.
Coordinator edits/API; Sol-medium worker calendar adapter/read tests, Sol-high
worker SQL/profiles/types; verified deliveries. Weekly remaining82%; DeepSeek pause
honored. Effective configs, attributable effort/tokens unknown; no savings claim.

Two independent Sol-high full reviews of559ff277e completed their app/compatibility
and SQL/security scopes, finding one deduplicated blocker: untouched displayed
dates were omitted during draft/schedule publication changes. Batch1 persists the
visible date in both editors, including legacy null-date publication transitions.
Default schedule, draft creation/reopen across midnight and scheduled Post now
regressions reproduce before correction;217 affected tests, TypeScript and lint
PASS afterward. Private SQL proof and unchanged visual matrix remain applicable.
Fresh12 browser editor scenarios PASS across desktop/mobile light/dark; screenshots
inspected under /tmp/pika-post-date-remediation-browser. Staged audit PASS; composite
keyboard/focus coverage retained. Default date metadata also respects fixture actions.
Final focused gate, targeted and cumulative review receipts follow in PR1695.

## 2026-10-27 Calendar date CI proof alignment

Final56ff40d41 review clean; prior implementation canonical5741/175PASS. Exacthead
broad run5740PASS plus one5s preflight timeout under load; isolated38PASS and all
static gatesPASS. CI40510181489 found the native announcement reader's old exact
field inventory, plus main's compact CURRENT labels rejected by the existing
attendance guidance test (22590other casesPASS/8skip). Returned PR1695 to draft.
Batch2 extends both native material/announcement inventories narrowly with posted_on
and asserts published future-calendar rows reach both member roles. Restores
existing DB/control label anchors in CURRENT without changing any recorded facts.
No application, SQL, ACL, shared data, visibility or release behavior changed.
Targeted verification/review and replacement exacthead CI follow; no migration,
merge or release authorized. Review ledger retains5 prior launches including the
superseded interpretation;2fix batches, targeted wave2 planned within7launch/60min.

## 2026-10-27 Accept the bounded 70-account classroom rollout

Consolidated the authorized dedicated/owner/P3/P5/PPZ expansions on runtime405
and schema293 into the dated70-account acceptance receipt. Retained actual
signed-in versus isolated/source-qualified boundaries, exact roster checks,
selected academic preservation and compatible recovery constraints. PPZ keeps
Tests/native attendance off/no policy/mapping/manual log unchanged. Original
observation gap remains historical; the fresh08:04–08:34 Toronto readonly window
passed7timely samples and final exact70/provider/work readbacks. Timed process
exited, watcher deleted, Audit relayed explicit release. CURRENT/roadmap/Home and
historical pilot now point to bounded acceptance; wider admission/provider/billing
holds and incomplete epic/paused goal remain. Documentation only; no live action.

## 2026-10-27 Prepare wider classroom admission design

Prepared a proposal for one durable service-owned admission source, exact70
bootstrap retention and staged expansion/new-user policy. Current Home/API each
cap100; Bara also selects protocol behavior from admission. The plan requires
Home/API consumer migration and frozen bootstrap provider-compatibility decisions
before widening, with current nonadmitted behavior preserved too. New grants use
atomic approved batches/growth stop; automatic signup stays off until separately
approved. Rollout stages and exact-source recovery/verification gates are recorded;
no code, SQL, cohort, plan, production or provider operation performed. Existing70,
all other holds and paused goal/DeepSeek remain unchanged.

## 2026-10-27 Material owner calendar receipt proof correction

Owner explicitly approved one additional correction batch/eighth targeted review,
then existing credits for this fix/review only; no purchase/reset or broader waiver.
CI40514407721 passed22591coverage cases/8skip, TypeScript/build, both future-date
native read proofs and cleanup. Its later owner-write proof compared the raw
posted_on:null column with the deliberately omitted legacy receipt key. PR1695
returned to draft; no application/SQL migration/ACL/UI change. Batch3 normalizes
only that missing null in the comparison; strict14/15-key cases and unchanged
historical identity/lineage/release/calendar date checks cover null and future dates.
Private replay now records each migration after success and includes the complete
owner-write rollback proof before metadata equality. Reproduced CI failure in
owned offline clone /tmp/pika-material-post-date.pgrIwt; corrected full001–294
replay/proofs/types/shared-schema equality PASS /tmp/pika-material-post-date.rnxlag.
All owned clones removed; shared history292 unchanged. One syntax correction was
caught locally before the final private pass. Targeted checks, canonical gate,
review8 and replacementCI receipts follow in PR1695. No merge/release/migration
application authorized; prior cumulative45a coverage reused for unchanged sources.

## 2026-10-28 — Creation action placement

- Moved test Preview and Settings above Publish and assignment Preview above date/Post; owner confirmed assignment Settings should remain absent. Updated Pattern Lab test example.
- Focused checks passed (1,631 tests); Pattern Lab browser scenario passed desktop/mobile in both themes, with screenshots inspected. Composite menu keyboard and focus return covered; student authoring is not affected. Authenticated UI verification script could not run due to missing auth setup and port conflict.

## 2026-10-28 — Integrate calendar dates after admission294

Human moved coordination to Teacher vs student login and then directed Do next
after its1699 merge receipt. Rebased this existing calendar worktree onto actual
main8d3c6e19; preserve admission294 exact908ac8f3 source and rename unchanged
calendar SQL7b4d0853 to actual nextfree295. Historical001–293 files unchanged.
40 feature app/e2e/API/component/lib files match a calculated clean three-way merge
with main; current main guidance and admission awaits preserved. Combined exact
profiles/catalogs/runner proofs and genuine metadata are being verified before
independent integration review and fresh stable-head CI. Prior calendar-only294
receipts stay historical; current294 means admission only. No shared schema
application, production release, provider/cohort/account or reset action. Durable
plan and review ledger: private future-post-date/ADMISSION-294-FIRST-v1 receipt.

## 2026-10-28 — Restore hosted browser CI compatibility

- PR 1702 CI browser jobs failed when ubuntu-latest resolved to Ubuntu 26.04, unsupported by the pinned Playwright Chromium installer. Pin hosted heavy jobs to Ubuntu 24.04; self-hosted selection and gate requirements are unchanged.
- The preceding run also hit a Supabase registry rate limit and an unrelated gallery test timeout; rerun evidence remains in the PR checks.

## 2026-10-28 — Update assignment focus test

- Updated the assignment drag-retirement browser helper to focus Preview directly after its relocation; it still verifies focus returns to Title after the fixture refresh.

## 2026-10-28 — RepoLight assignment summary prepared

Prepared a local Pika-only, teacher-editable assignment summary from the current
fingerprinted source and digest-validated matched-contributor evidence. Saved
reports and service contracts are unchanged; unavailable and partial evidence is
explicit. No migration, publication, deployment, provider or credential changes.
Verification and independent review remain with the coordinating task.

## 2026-10-28 Required repository usernames — base refresh

Rebased the previously reviewed required-username change onto current main. Preserved
upstream journal history and the prior local preparation evidence; focused verification
is recorded in the task handoff. No migration, provider or production action.

## 2026-10-29 — Managed RepoLight plan integration

Prepared managed per-owner workspace provisioning, Pro/Max/trial entitlement,
expiry-safe report access, subscription outbox and versioned offering source.
AI and rollout gates remain off; no hosted migration or deployment. Independent
reviews and isolated replay001–298 pass; focused 5,352 tests pass (one skip).
Cross-service handler contract passed with in-memory synthetic stores; real
DB-backed end-to-end and controlled activation remain outstanding. RepoLight
service implementation is at worktree `repolight/pika-managed-provisioning`.

# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-10-29 — RepoLight plan policy

Owner selected Pro and Max, including active Pro trial. Documented SUB-17 and
preserved offering-version, pilot, billing, and activation boundaries. Runtime
plan enforcement remains unimplemented; sandbox billing status is not a safe
production resolver. Next: implement and verify authoritative entitlement and
race-safe analysis admission before any separately authorized rollout.

# Pika Session Log

Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.

**Rules:**
- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.
- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.
- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.
- Use `node scripts/trim-session-log.mjs --check` to reject empty entries and verify the log is chronological and within the 60-entry cap.
- Keep enough recent entries for weekly automations to inspect roughly the last week of work.
- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.
- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## 2026-10-29 — Delete from assignment and test editors

- Added editor delete actions using existing confirmation and deletion flows; focused interaction tests cover cancellation and deletion. Local Supabase services restarted without migrations; Playwright verified teacher editor and confirmation states on desktop and mobile in light and dark themes. Student editor is unaffected.

## 2026-10-29 — RepoLight required username integration

Rebased the reviewed username branch onto the merged RepoLight summary. Preserved
journal history and both integration contracts; application and test patches match
the previously reviewed branch. Focused checks and final PR review follow.

## 2026-10-29 — RepoLight selected-student drafts

Prepared an approval-gated selected-student repository action beside AI Grade.
It runs individual public reports sequentially and appends matched assignment
summaries to revision-checked private drafts while the page remains open. No AI,
grades, sending or Return. Skips and uncertain outcomes remain visible. Focused
component and executor checks, policy checks, and synthetic teacher desktop/mobile
light/dark verification are in progress; publication and rollout remain separate.

## 2026-10-30 — Test and assignment settings menus

Moved editor delete actions into teacher settings menus; preserved confirmation flows. Verified the teacher desktop/mobile open-menu states in light/dark with Playwright fixtures; student views are not applicable. Focused checks and independent PR review follow.

## 2026-10-30 — Remove calendar-date help text

At the owner’s request, remove the persistent explanatory sentence from new and
existing announcement editors and the Classwork material editor. Retain the
Calendar date label, validation and separate Post/Save/Schedule behavior. Reuse
existing FormField/Input and Pattern Lab reference; no new shared UI pattern.
Teacher desktop/mobile and light/dark checks cover future-date editing; student
view is unaffected because this text appears only in teacher editors.
Risk profile: none. No production changes or migration are part of this edit.

## 2026-10-30 Scheduling date display

- Updated the shared teacher scheduling picker to display selected dates as `EEE MMM d, yyyy`, retaining its native date input and Toronto scheduling semantics. Verified the Pattern Lab assignment dialog at desktop/mobile in light/dark; student scheduling is not applicable. Added focused date-control coverage.
- Owner requested picker-only date selection: block typed entry, retain the formatted display on focus, and open the native calendar by pointer or keyboard activation.

## 2026-10-30 — Named attendance schedules

Prepared date-specific named QR attendance schedules, replacing the proposed manual open override. Regular policy remains the default; migration 296 adds guarded storage and sync source tracking. Focused tests and fixture visual checks are in progress. Local migrations 293–296 require separate explicit authorization; database replay, independent review, and release remain outstanding.

## 2026-10-30 — Local named-schedule migration

Applied local migrations 293–295. Migration 296 initially failed on a reserved SQL alias; corrected the alias and reviewed-source hashes, then applied 296 with renewed authorization. Verified local migration history, database objects and access controls; focused checks passed (4,489 tests). The rollback-only synthetic database harness passed on a temporary isolated copy, which was removed afterward.

## 2026-10-30 — Named schedule CI fixes

Updated generated database types and the classroom resource inventory for named attendance schedule tables. Updated the attendance browser fixtures for the new picker and added create/select coverage. Local schema audit, generated-type check, classroom contract tests and affected desktop/mobile-dark browser scenarios passed; PR CI rerun follows.

## 2026-10-31 — Named schedule proof catalog

Updated the sealed test-member-list canonical catalog to include both reviewed migration-296 attendance tables while preserving predecessor profiles. The catalog and proof unit suites pass; the failed PR database lane requires rerun on the reviewed head.

## 2026-11-01 — Verified public classroom admission

Prepared default-off verified-account admission, an explicit existing-session recovery action, and migration 297 with protected exclusion and growth-stop serialization. Isolated database replay and concurrency tests, representative mocked UI checks, and targeted proof-catalog checks were run; production activation, provider readiness and account-deletion lifecycle remain separate.

## 2026-11-02 — Classroom responsiveness in progress

Approved responsiveness plan; worktree `codex/site-responsiveness` at base ebe91cab. Teacher Test detail/results overlap only after draft succeeds; Classwork surveys prefetch on intent; teacher/student Calendar Tests reads keep in-flight dedup but no settled cache. Controlled synthetic probes: Test editor median 724→531 ms with 200 ms mocked reads (8 samples); Classwork hover teacher 497→117 ms and student 431→88 ms with 400 ms survey delay (4 samples), no idle survey requests. Not production evidence. Focused component tests pass; browser matrix and full checks/review remain in progress. Probe receipts under `/tmp/pika-responsiveness-probe.bGoLmS` and `/tmp/pika-classwork-probe.zesg5l`. Do not prefetch Tests until mutation invalidation races are resolved. Goal tracker remained blocked after approval; app controls resume status.

## 2026-11-02 — Teacher Classwork cold loading

PR1718 merged to main as 0507966c; exact-head CI passed on retry after one unrelated UiGallery timeout. In `codex/classwork-cold-load`, teacher Classwork reuses the classroom class-days provider without blocking its three-list snapshot; the standalone fallback hides another classroom's schedule immediately. Paired synthetic browser probe holding class-days 500ms: median list readiness 545→37ms (5 samples/version), one request per source; no production latency claim. Focused component/context tests pass 105. UI matrix, focused checks and independent review pending. Evidence: `/tmp/pika-classdays-paired.0haTTl`.

## 2026-11-02 Test editor grading notes

Made answer key and sample solution fields grow with their content and container width; moved Add reference beside the test title and removed the enclosing reference panel, and placed test/classroom context above the title, and aligned question number, points and add action in the toolbar. Extended the compact context label to assignment, material and survey editors and moved survey question actions into the toolbar, and placed the shared icon-labelled Write/Markdown control in each editor’s details pane. Aligned editor primary and add actions on the shared primary color. Updated Pattern Lab with shared auto-growing grading notes and assignment/survey settings examples. Shared test reference cards between the editor and Pattern Lab, retaining local-only placeholder behavior. Applied the reviewed read-only total beside question points in the test editor, with immediate valid-draft updates and full-modal visual checks. Reserved the mobile close target above title controls after independent review. Focused component tests and Playwright checks cover the editor.

## 2026-11-02 — Tests list read overlap

PR1719 merged to main as 66e161fc after exact-head full CI. In `codex/tests-list-responsiveness`, the legacy student active/closed Tests reads and legacy teacher Tests/roster reads start concurrently only after authorization; existing error precedence and status ordering remain. Deferred route tests cover authorization, overlap, migration/error precedence and late rejections. Controlled timer-only examples: student 107→62ms for 50ms mocked reads; teacher 203→102ms for 100ms reads. These are not production or database latency measurements; successful requests use the same query count with at most two initial reads in flight. Admitted/shared routes and student exam sessions are unchanged. Exact focused checks, independent security/correctness review and CI pending.

## 2026-11-02 — Reduce Classwork requirement reads

Batch authorized legacy teacher assignment requirements and overlap them with roster and document reads, preserving error precedence. Synthetic timing and request-count checks cover normal, large, and paginated lists; production user-perceived impact remains unmeasured.

## 2026-11-02 — Teacher Tests query overlap

On `codex/teacher-tests-query-overlap`, prepared a legacy teacher Tests list change that overlaps authorized question and attempt reads while preserving question-first errors. A synthetic one-test/one-student probe with 80 ms delays per read measured 168 ms before and 89 ms after, with six table requests in both successful runs; these are mocked timings, not production measurements. Focused route checks cover overlap, authorization, error precedence and late rejections. Production deployment remains pending.

## 2026-11-02 — Teacher Tests intent prefetch

Start a bounded teacher Tests read on navigation intent, share only in-flight work, and invalidate on Test updates before list refresh. Skip speculative work for constrained connections and after Tests mounts; completed snapshots remain uncached for freshness.

## 2026-11-03 — Progressive teacher Tests list

Prepared a legacy teacher Tests summary read that displays draft-overlaid titles and unknown count placeholders while the original full read runs. Shared admission retains its existing read. Synthetic browser fixture holds statistics for 500 ms; four teacher viewport/theme runs showed titles before counts, with two HTTP reads. This is not a production benchmark. Full verification and review remain required.

## 2026-11-03 — Progressive teacher Classwork prototype

Legacy assignment and survey summaries can render before statistics, with explicit
unknown counts and incomplete-list action guards. Shared reads retain their full
owner-scoped contract and cache; cache invalidation and permission failure guards
protect delayed results. Independent review and CI remain pending.

## 2026-11-03 — Classwork progressive read review fixes

Prevent invalidated summary reuse, join in-flight full prefetches, fall back
from non-authorization summary errors, and gate material deep links on complete
authorized classwork. Real-cache and interaction regressions exercise these paths.

## 2026-11-03 — Teacher Tests statistics pagination

On PR 1726's head, page legacy teacher Tests statistics in stable ID order to avoid
PostgREST's row cap silently truncating question, attempt, response, and access
counts. Local disposable PostgREST probe reproduced the 1,000-row cap; API
regressions cover multi-page reads, exact boundaries, and later-page failures.

## 2026-11-03 — Rebase Tests pagination onto main

Rebased PR 1727's pagination-only commit onto main after PR 1726 merged as
7d1c121fb. The rebase preserved the prior source tree and continuity histories;
PR 1727 remains draft pending focused checks and exact-head review.

## 2026-11-03 — Classwork refresh browser fixture

The Classwork continuity fixture now models summary and full reads separately.
Its first refresh fails the summary and then exercises the full-read fallback,
including retained editor, failure, retry, recovery, and controlled navigation.

## 2026-11-03 List order toggle

- Added teacher Classwork and Tests reverse-order views that preserve drag ordering; defaults follow existing position directions. Focused interaction tests and visual menu checks performed; PR verification in progress.

## 2026-11-03 — Student Test submission reassurance

Keep answers visible while submitting and show an immediate confirmed receipt. Reconcile ambiguous responses against the saved submitted attempt without claiming success for different answers; suppress competing session closure during reconciliation. Production promotion remains on hold.

## 2026-11-03 Investigate test contention

Observed production learner and owner busy errors during class tests. Prepared bounded retries for confirmed rolled-back busy transactions and complete learner detail rechecks. Initial 24-student load exposed retry exhaustion; widened bounded retries passed two isolated 30-student bursts with saved-answer verification and concurrent owner reads. Synthetic harness excludes browser, route, and history paths. Updated diff review, CI, and production release remain pending.

## 2026-11-04 — Classwork access recovery

- Restore the existing Classwork loading/error and retry surface when a selected assignment or survey loses access during refresh; preserve selection for a successful retry.
- Teacher-only behavior; reuse the existing work surface and PageState. Student view is unaffected.

## 2026-11-04 Header message loading feedback

- Reused CircularProgress for stable loading feedback and increased message line height to preserve descenders. Pattern Lab includes an isolated example.
- Verification: AppMessage tests and UI/design policy checks passed; Playwright inspected teacher/student, desktop/mobile, light/dark; width stayed constant and reduced motion disabled animation.

## 2026-11-04 — AI provider gate rebase

Rebased PR 1731 onto current main; preserve DeepSeek as the default, optional OpenAI selection and the outbound AI stop. The proposed $50 limit was withdrawn and never activated. Earlier reviewed-head local checks and CI passed; rebase verification and delta review remain. No production settings changed. Risk: async-grading and runtime-platform. Model recommendation: GPT-6.1 Sol high for cross-provider grading, provenance and durable-run integration.

## 2026-11-04 Clarify busy Test errors

Changed confirmed exhausted Test lock contention to “Test is busy. Try again.” while preserving conflict status and retry limits. Reused ConfirmDialog error feedback so teacher access errors are visible above the overlay. Synthetic Playwright teacher/student desktop/mobile light/dark checks preserved student drafts; focused tests and review follow.

## 2026-11-04 Calendar empty lesson text

Removed empty lesson placeholder text from the shared week agenda for teachers and students; preserved the teacher add-lesson control. Component tests and UI/design policy checks pass. Visual verification passed with fixture-enabled Pattern Lab: teacher and student empty cells at 1440 and 390 pixels in light and dark themes; teacher add-lesson control retained. Focused checks passed (1,406 tests, architecture, policies, TypeScript, lint).

## 2026-11-05 Reuse teacher Tests intent summaries

Retain the legacy teacher Tests intent summary briefly within the current
teacher/classroom view, retry failed or expired intent reads, and discard the
provisional list on authorization denial. The shared-admission full read remains
unchanged. Synthetic browser evidence and focused review/CI are tracked with the PR;
no production timing or deployment is implied.

## 2026-11-05 — Reverse order display preferences

- Persist teacher Classwork and Tests reverse-order preferences in browser storage; preserve defaults and drag ordering.
- Focused checks passed (1,387 tests, architecture, UI/design policy, TypeScript and lint); browser reload and teacher desktop/mobile light plus mobile dark menus checked. Full visual matrix and independent review remain before PR.

- 2026-11-06: Removed compact gradebook header 0 wt label; focused checks passed. Pattern Lab header inspected; authenticated visual matrix and PR remain pending.

## 2026-11-06 Gradebook student PDF export continuation

- Continued draft PR #1741 on current main. Owner clarified Email 2 is guardian email and only Pika’s single guardian is the intended recipient. Teacher labels updated; read-only checks of two open classes found matching populated addresses and missing-address exceptions reported privately. TeachAssist email uses Trillium recipients and attaches its own report; no Pika-PDF upload observed. Board Outlook is accessible only in Chrome; no messages sent.
- Local implementation adds a PDF/guardian pairing CSV, fail-closed roster matching, unrounded returned-work calculations and a multilingual tagged-text PDF prototype. Synthetic privacy/extraction tests and selected/all local browser ZIP pass; teacher desktop/mobile light/dark visual checks run. Focused gate 1758 tests and static checks pass; production build passes with PDF-library dynamic-import warnings and a 13.5 MB compressed CJK chunk. Independent review and exact-head CI remain. Account weekly ordinary usage exhausted; pr-review requires a human checkpoint before reviewer launch. No PR ready, merge or release.

## 2026-11-06 Gradebook PDF review continuation

- Owner explicitly authorized continuing independent review despite the exhausted weekly allowance; other review budgets and release gates remain. Review of c96921bd against 6dc7c349 used two Sol-high reviewers (effective configuration and elapsed/token telemetry unavailable). Privacy/calculation review found no confirmed defect; PDF review identified one P2 grapheme-splitting defect in long complex-script text.
- Rebased onto main b91b3dc3, preserving both continuity histories. One remediation batch adds grapheme-safe wrapping and regression coverage for Devanagari vowel marks and conjuncts. Targeted tests/typecheck and synthetic multilingual PDF inspection pass; focused checks and independent delta review follow. No email or production deployment authorized.
