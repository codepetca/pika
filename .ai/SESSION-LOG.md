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

## 2026-10-22 — Announcement calendar post dates

Owner expanded post-date editing to published announcements in PR1663. Reuse
material native date field and shared civil-date schema; extend announcement
card/locked owner patch, refresh mounted teacher calendar, reuse publication
calendar readers. Guide/reuse/matrix: docs/guidance/announcement-post-date.md.
Risk none; no new dependency/shared UI pattern. Student editing n/a; student
saved-date reading verified desktop/mobile light/dark. New browser4/4 and old
feedback2/2 PASS; captures inspected, composite checklist reviewed. Migration290
keeps289 unchanged; Sol/high worker owned SQL/seals/proofs, coordinator app/API.
Effective model, tokens and active time unknown; weekly99% remaining at start.
Owner approved brief Docker restart only for disposable verification:001–290
material/announcement and attendance proofs plus Data API normal/absent-default
ACL replays PASS. Source schema/history unchanged, owned clones cleaned, Docker
stopped again. Evidence /tmp/pika-material-post-date.NSbkTw and
/tmp/pika-attendance-membership.R8Oq4m. No shared local/production migration or
release. Final focused gate and new-scope independent delta review pending.

## 2026-10-22 — PR1663 CI registry repair

Owner authorized fixing CI and merging1663 after all checks pass. Announcement
469773050 focused5406 and complete independent delta review passed; CI Test &
Build passed but all seven Supabase setups and an isolated retry hit GHCR
toomanyrequests before replay. Select public.ecr.aws before setup-cli; upstream
action preserves the override and both pinned Postgres/metadata OCI indexes are
byte-identical across registries. Bounded Sol/high read-only worker verified
upstream behavior/manifests; coordinator owns all edits. Local runner now imports
only the literal reviewed workflow registry, refuses job/step overrides, retains
historical no-env plans and all existing isolation/inventory/cleanup guards.
Regression7 RED then329 affected workflow tests GREEN. Runtime-platform standard
risk; CI-only delta review and final focused/CI gates pending. No UI, versions,
dependencies, image contents, shared database or production changes. Docker stays
stopped. Review budget: one targeted Sol/high wave, one CI fix batch, within60min;
prior feature review coverage reused, no extra full review wave.

## 2026-10-22 — Production post-date release completed

Owner authorized production289/290, then main promotion after checks. Single
apply39862570602 returned applied-verified001–290, matching preview39862341945
and fullCI39836337744 at reviewed main48cee7969. Read-only exact owner bodies,
metadata/service-only ACLs, unchanged table RLS/constraints/triggers and Toronto
midnight checks PASS. PR1664 journal-only merge resolution580cea537 retained all
parent entries; two cumulative Sol/high reviews and one targeted pass found no
blocker. Focused12,583/559 and all ten CI39864745315 checks PASS after download-only
ECR retries. Normal production mergea1b7c2a77 matches reviewed tree. Vercel
dpl_A895Cc9p4Af36TatCkh37tz3EaxP READY at exact SHA; production alias and four public
GET checks PASS. Receipt: docs/guidance/production-release-2026-10-22.md. No apply
retry, fixture/post mutation, flag/account/provider/billing change or Docker
restart. Attributable tokens/active time unknown. Final receipt docs review/CI
remains; production promotion worktree retired, shared env target preserved.

## 2026-10-22 — Approved four-editor implementation verification

Actual Assignment/Material/Test/Survey now match the approved compact prototype:
Markdown source, shared mode/close/status header, question navigation and green
Plus FAB, Image beside Link, protected classroom uploads capped at2MB. Preserve
legacy Material until content edit; source-only changes regenerate readers.
Source/API checks cover publication timing, legacy submitted-Test access and
literal protected URLs. Migration291 is prepared, NOT APPLIED; reference ledger,
transactional save attachment, archive/snapshot pins and narrow1h unclaimed
retention support sequential Survey move/swap/Undo. Generic cleanup unchanged.
Final migration SHA256016ae0051081bf1c16aa985c168f75db4aae273b41c870949f06255ba994bbf3.
Blueprint private-image portability is unsupported: reject incoming portable
assets before copying/applying; preserve existing classroom source.

Actual-source browser16teacher+4student matrix and existing8authoring contracts
PASS; desktop/mobile light/dark captures inspected. Durable receipts/provenance:
/Users/stew/.codex/visualizations/2026/10/22/01a163d1-8db0-7481-b96e-7f538d0e90a8/actual-editors-v1.
Targeted1802 then222 portability/retention and11 retention/seal cases PASS; final
canonical one-worker gate PASS:10162tests/500files,8skipped; architecture,
UI/design policies, TypeScript and lint PASS. Explicit Data API migration policy
PASS. Audit PASS66changedTSfiles; composite mode,
menu, dialog, keyboard/focus checklist covered. Native291 proof prepared only;
generated types and native ACL/schema/behavior receipts pending exact local
permission. No Docker restart, shared migration or production action. Owned
Next3036 stopped; owner prototype9026 retained. Current independent-review
coverage ends94bd0b389;9historical launches consumed, approval for up to3new
launches pending. PR1662 stays draft. Bounded implementation workers assisted;
not independent review. Inherited effective models/tokens unknown; serial local
verification limits honored after correcting an initial unflagged focused run.

## 2026-10-22 — Local291 preflight and independent review

Owner approved local291 and3additional reviews. Supabase local target verified
Pika/54322; history001–243, explicit dryrun proposes244–291. STOP: no non-dry-run
application attempted; asked expanded exact244–291 authority, pending. Existing
244–290 bytes match reviewed main61bc7e89a. Isolated001–291 replay and4rollback
proofs PASS; shared schema unchanged. Harness final type equality differs only
new2914-column ledger/2FKs; generated metadata pending official local generation.
Data API historical/absent-default ACL replay PASS. Native receipts:
/tmp/pika-material-post-date.bgGFy2 and /tmp/pika-authoring291-data-api-native.log.
Owned clones removed, local DB and Docker stopped again.

Independent fresh-context Sol/high launches10/11 completed on d5bd64337: storage
and UI/compatibility, no editor-state/auth blocker;2uniqueP2archive blockers
(stale compatibility images and absolute URLs). One correction batch uses SQL's
canonical source precedence and remaps protected URLs to new relative identity.
Canonical one-worker gate10168testsPASS; architecture/UI/design/TypeScript/lint
PASS. FinalIPv6 URL variant landed during run; subsequent exact-source5archive
suites71PASS. No UI delta; existing visual hashes retained. Launch12
reserved for correction/integration after metadata/native gates; no further
launch approved beyond12. Requested model/effort recorded; effective config,
per-turn tokens and exact reviewer seconds unavailable. Current PR remains draft.

## 2026-10-22 — Production post-date promotion preparation

Owner authorized one production application of289/290 followed by main promotion.
Preview39862341945 and single apply39862570602 bind reviewed48cee7969 and full
CI39836337744; applied-verified001–290. Read-only exact function bodies, metadata,
service-only ACLs, unchanged table RLS/constraints/triggers and Toronto midnight
checks PASS. Two Sol/high cumulative production→main reviews passed with no
findings. PR1664 encountered only journal conflict; union preserves both parent
histories and trim restores chronology. Application/Supabase trees stay identical
to main. One journal-resolution batch and targeted review/final CI pending; no
production retry, fixture write, flag, account or provider change.

## 2026-10-23 — Markdown editor CI correction batch

PR1662 returned to draft after391a CI: Test & Build passed; ECR throttled3setup jobs;
dark PatternLab and publication catalog checks exposed real fixture/proof issues.
Reuse shared prototype X clearance; update obsolete header/mode assertions and
hydration readiness.28affected browser cases and83unit/source checks pass;
visual matrix inspected (teacher desktop/mobile light/dark, student n/a for these
experimental prototype controls). Fix nested catalog p-alias shadowing without
changing capability checks or migration291. READ ONLY nested catalog passes.
Native isolated publication verification follows on a clean committed checkpoint;
final receipts/CI/review status live on PR1662. No merge or production authority.

## 2026-10-23 — Local244–291 authorized application and final verification

Owner explicitly authorized exact local244–291, checks/final review and Docker
shutdown. Fresh target Pika54322/source243,48-file preview and manifest hashes
matched. Source schema byte-identical to prior native baseline; no main drift.
One supabase db push --local --yes succeeded; history291rows/max291. No reset,
seed, history repair, production change or rollout activation. Apply receipt:
/tmp/pika-authoring244-291-apply.log. Read-only exact291catalog PASS. Official
db:types:generate/check PASS; only36-line new ledger metadata, byte-identical to
prior isolated expected output. Final isolated001–291 replay, all4rollback
proofs, generated-type equality and unchanged shared schema PASS:
/tmp/pika-material-post-date.r5fxEg. Data API static PASS; historical/absent-default
ACL proof reused unchanged source. Exact-source archive71tests PASS from prior
correction; no UI delta, prior16teacher+4student+8existing browser evidence reused.
Final full one-worker check and reserved cumulative review12 pending. Native
clones cleaned; Docker will stop again before completion. No merge authorized.

## 2026-10-23 — Final editor/image review candidate

Native244–291/localhistory/types/catalog/replay PASS; Docker Desktop stopped
and no backend remains. Durable native receipts beside actual-editor captures:
/Users/stew/.codex/visualizations/2026/10/22/01a163d1-8db0-7481-b96e-7f538d0e90a8/native-verification-2026-10-23.
Full one-worker selection on00ae6b071:10168PASS/1FAIL, only startup context
17058>17000. Compact CURRENT to16965, retaining local/rollout facts; no budget
change. Correct archive fixture to real rich_instructions field. All160affected
startup/UI-guidance/archive tests across7suites PASS; architecture1303modules,
UI148controls, design698values, TypeScript and lint PASS. Runtime/schema/config
remain identical to full-checked00ae6b071; closing docs/test-only delta.
Fresh Sol/high reviewer12 completed behavioral scope: both priorP2archive
findings resolved, no new blocker; exact-head receipt follows in PR1662. Requested
model/effort recorded, effective configuration/tokens/seconds not exposed.
Owner-approved12launch limit exhausted; no additional reviewer launch allowed.
Ready-PR CI follows stable exact-head verdict; no merge or production action.

## 2026-10-23 Authenticated CI Supabase registry repair

PR1662's four remaining lanes failed before tests with the anonymous ECR data
transfer cap, including one failed-only retry. Returned the PR to draft before
repair. All seven Supabase jobs now select the official GHCR mirror with the
existing ephemeral workflow token and job-scoped packages:read. CLI2.103.0 and
image versions, proof commands, selectors and PR Gate remain unchanged; all17
pinned mirror manifest indexes/platform descriptors matched byte-for-byte.
The Node-only helper publishes private RUNNER_TEMP Docker-config ownership
before login, sends the token on stdin, suppresses diagnostics and always removes
only its own marked directory after stack cleanup. Local CI validates these exact
credential slots and skips them without importing secrets; historical ECR/no-env
plans remain supported. 360 focused helper/workflow/parser tests pass, including
failed startup and rejection cases. Broader focused gate and two independent
credential/parser reviews precede final stable-SHA CI. Existing human review-limit
waiver covers this repair; prior13review receipts and7fix batches retained.
No local Docker operation, migration, dependency or application/UI change in this
batch. Another chat's bounded local verification hold remains active.

## 2026-10-23 CI registry review corrections

Independent Sol/high launches14/15 completed a39a13d05's credential/security and
workflow/compatibility assignments. One unique P2 credential issue: empty auths
allows Docker's platform helper discovery, which can store tokens outside the
private directory. Seed the fixed GHCR entry to suppress discovery; its regression
failed before the correction. A daemon-free Docker CLI probe with an isolated
config and fake helper confirmed empty auths invokes the helper while the seeded
entry does not; no token, actual credential store or daemon operation. The other
P2 was the broad focused gate's canonical workflow inventory omission. Register
both new registry suites in check:workflow; preserve every existing test. Initial
full selection:10205PASS/8skip, only inventory failure. Both fixes batched together,
then required focused/static checks and one targeted independent correction review
before final stable-SHA CI. Human review-limit waiver retained (15launches,9batches).

## 2026-10-23 Native inventory compatibility with CI registry credentials

Reviewed500720348 passed10206focused tests/8skip and all static gates. RealCI
39971332075 proved all7GHCR logins and image-download/startup paths, then reached
previously blocked owner-list/draft-GET/reorder proofs. Their native environment
checks rejected DOCKER_CONFIG before endpoint/resource discovery. PR returned to
draft; obsolete run cancelled before any correction push. One shared assertion
now permits only exactGHA/GHCR job-owned private config with marker, owned0600
single-link regular bounded16KB file and onlyauths.ghcr.io.auth. Other Docker/
proxy selectors, config keys and sidefiles remain forbidden. All3direct guards
use it; context/TLS/local Unix socket identity, resource discovery and outer/inner
actual-config propagation remain unchanged. Regression matrix covers credential
isolation plus real offline native/PATCH transport protocols. No daemon restart,
application/schema change or migration. Batch10 and two new independent guard
reviews retain the existing human budget waiver. Normal reviewed1662main merge
now explicitly authorized by direct human reply in classroom-home coordinator;
verified with read_thread. No production/deploy/provider/rollout authority added.

Guard reviews17/18 completed0af438c68. One P2 accepted: collector still read the
ignored HOME Docker config after admitting the private override. Read the effective
config instead; real-file tests cover ambient headers/malformed JSON and preserve
default-config rejection without DOCKER_CONFIG. All207 affected helper/inventory
cases PASS. The superseded0af full gate was deliberately cancelled before this
source edit; new exact-source gate and targeted review19 precede CI. No timeout,
assertion, endpoint, resource or permission control was weakened. Batch11; human
review-limit waiver remains active.

## 2026-10-23 Derived image ledger and modal keyboard CI integration

CI39977192319 proves all seven authenticated Supabase starts and the previously
blocked native GET/list/reorder guards pass. Test & Build passes21,522 cases,
TypeScript, lint and production build. The final lifecycle audit exposed the
291 image-reference ledger missing from the classroom graph declaration. Declare
its exact classroom FK non-owning, following the trigger-rebuilt storage ledger
contract; archive source rows and remapped managed objects rebuild references.
Keep it outside portable resources, purge adapters and Gradex. Regression starts
RED against the observed FK/composite key, then62affected archive cases PASS;
missing-FK and unexpected-resource guards remain strict. No SQL changes.
Browser CI exposed stale keyboard order after the shared corner Close and the
removed mobile heading trigger. Update contracts to assert accessible Close in
the tab cycle and the compact Format menu, retaining all focus, retirement,
Escape, no-write and confirmed-write checks. Four-project native fixture checks,
required focused gate and targeted review are recorded in retained receipts.
Human waived review limits; normal reviewed1662-to-main merge is explicitly
authorized after all checks. No production operation or additional DB change.

## 2026-10-23 Compaction image rehearsal correction

Independent targeted review20 accepted the ledger/browser correction but found
an image lifecycle interaction: compaction stages real-restore URLs containing
fresh identities before those objects are reserved. Preserve original authoring
image identities only in rollback rehearsal via the verified plan's inverse ID
map; real restore retains fresh identities, paths and reservation protocol.
Reuse one protected URL grammar for Markdown and nested JSON. Regression RED
reproduced the unreserved staged URL;68affected archive cases PASS. Native local
291 source-delete/reinsert proof rejects fresh unreserved IDs, rebuilds the ledger
for original IDs, preserves exact managed state, and rolls every fixture back.
Actual classroom schema audit passes284FKs; canonical migration history291 and
zero fixture users/objects verified afterward. No SQL migration changed. Docker
DB-only window is closed after proof; full focused gate and review21 tracked in
retained receipts. Superseded7bbc gate deliberately terminated before edits.

## 2026-10-23 Editor production migration and release correction

Owner approved exact production291 and normal editor release. Preview40003769768
matched only291 from reviewed61d9265/fullCI39995508676. Single apply40004531458
is applied-verified001–291; exact installed bodies/ACL/RLS/constraints/triggers
and private bucket read-only checks PASS. No production fixtures or flags changed.
Two cumulative release reviews found one source UUID casing blocker. Correction
f316bf7da matches UUID identity only, preserving literal route/key/full identity
and publication/member guards. Regression6fail→43affectedPASS; focused1012/75,
static/audit and independent targeted review PASS. Main1668 and promotion1667
each require final exact-head CI; no production app release claimed yet.
Promotion keeps both journal histories and reviewed correction bytes. Home292,
provider, billing and shared-local schema remain outside this release.

## 2026-10-23 Editor production release verified

Owner-approved production291 single apply40004531458 is applied-verified001–291;
exact body/ACL/RLS/constraint/trigger/privatebucket read-only checks PASS. Four
release review turns resolved one UUID casing source blocker; normal main1668
merged b03198a9 after1012local/21534CI tests and allselectedgates. Production1667
merged cd7179e64 after all10exact3208858CI40006108276checksPASS. Vercel
dpl_8GRTVHmoMdx9mdETNWAUx2dcgsZa READY15:31Toronto; exactGitSHA andpublicalias
verified. PublicGETsmoke5/5PASS, including newimage401. No productionfixtures,
292, flags, provider, account/billing or cleanup activation. Receipt imports both
production/main journal histories; application/test/schema/config unchanged.

## 2026-10-23 — Prepare live relationship home

Implement the approved Teaching/Joined composition under exact home plus shared
admission, preserving legacy users/session roles and the owner lifecycle manager.
Private current-enrollment preferences persist personal hide/unhide; stale rejoin
requests fail. Managed creation hints retain atomic quotas/idempotent replay;
code joins preserve exact lookup/limiter/roster rules and membership-only Pal.
Disposable replay, rollback and real two-session contention passed; shared source
ID/version/schema preserved, generated RPC types matched and owned resources absent.
UI fixture matrix8 and wizard matrix8 passed,64screenshots; not signed-in persistence
evidence. Initial browser failure was a selector matching Next's route announcer;
its failed evidence retained. Source tests/TypeScript/lint/audit pass; required focused
gate and independent review still pending. Creation capability refresh regression
failed before its fix. Two Sol6.1/high bounded implementers, effective config/tokens
unknown; prior review424/fix39 counters retained. Editor owns locally applied291;
owner authorized coordination and reviewed1662 merge to main only. Home numbering
must follow upstream before readiness. No shared migration, production, provider,
account/plan/billing/cohort/cutover or goal-state action. See live-classroom-home.md.

## 2026-10-23 — Correct complete live-home reads

Initial independent reviews425/426 completed: compatibility/UI clean, security
found a partial-list risk at REST1,000rows. Batch40 adds bounded ordered pagination
with exact-count/page/identity validation, reused by SSR and admitted owned-list
refresh. Legacy paths unchanged. Regressions first failed, then118 focused checks,
TypeScript and affected ESLint passed. Previous schema/native/64PNG matrix retained;
no visual or SQL change. Targeted review427 and editor1662→home292 sequencing remain
before readiness. Production/provider/shared-schema/account/cohort holds unchanged.

## 2026-10-23 — Reconcile home with merged editor291

Verified editor1662 merge61d9265b7, rebased home1666 preserving upstream source and
historical receipts. Images291 remains fixed; visibility renamed292 with SQL hash
3d5d47…f349d unchanged. Exact source profiles extend292 and reject293; no historical
seal rebound. Initial profile run found the omitted offline-helper allowance;
corrected1500/4PASS. Full001–292 isolated replay, rollback, real two-session locks,
generated types and canonical291/schema preservation PASS. Launcher PATH failure
preceded clone setup and remains failed evidence; corrected fresh proof passed.
Fresh16UIcases/64PNG PASS40.425s; root inspected current captures, 48unchanged PNGs
match prior bytes. Native/browser resources settled, envlink restored, Dockerwindow
released; editor stopped exactsourceDB/Desktop preserving volumes. Final focused
4486/143PASS; static completion and cumulative review428 tracked privately before
ready/CI. No shared migration, production/provider/account/cohort/goal action.

## 2026-10-23 — Reconcile authoring-image role boundaries

Cumulative review428 accepted the rebase/native/visual evidence but found new
upstream image endpoints still globally role-bound. Batch42 adapts existing
reserve/finalize/cancel and delivery only within exact home/shared admission;
actual owner/creator/object checks, current-member publication, archived denial,
retained-owner previews and nonadmitted legacy behavior remain. Twelve RED API
regressions reproduced the mismatch before the fix;79 focused checks then passed.
No SQL, UI, provider execution or shared database change. Native292/16-case UI
evidence remains unchanged; final focused checks and targeted review429 required.
All deployment/provider/account/cohort/cutover holds stay in place.

## 2026-10-23 — Correct current-chain native verification pins

Exact b945 CI40004265801 exposed stale291 source/target pins in attendance and
material native harnesses;21,759 CPU checks passed, one preflight unit failed.
Returned1666 to draft before one batched correction. RED5/31 reproduced boundary
and actual-command failures;1519/3 then passed with both sealed preflights and
future293/malformed rejection. Fresh offline attendance/material292 proofs passed
full replay, rollback behavior, actual attendance contention, generated types and
unchanged canonical001–291/schema; owned containers removed. Evidence retained
privately. Two launcher failures used pnpm9 before clone setup, retained as failed
evidence; corrected pinned10.25.0 invocation passed. No product SQL/UI change;
accepted visual and home-native evidence reused. Final focused gate and targeted
review430 precede new ready-event CI; editor release-order interlock remains.
Production, providers, shared applications, account and activation holds remain.

## 2026-10-23 — Reconcile home proof with pinned CI image

Review430 and full4544/145+static passed07cceb; normal draft push then one ready
event started40007133291. CI passed corrected attendance292 native proof, then
home preflight rejected the CI image before scratch creation. Returned1666 to
draft before batch44. Tagged upstream CLI2.103.0 manifest specifies17.6.1.132;
local accepted stack uses17.6.1.044. Add only exact official aliases for132,
retaining044 and cached/running ID equality. Actual shell regressions RED2/18
reproduced the mismatch; future/custom/latest/malformed references and mismatched
IDs remain rejected. No SQL/UI/database/provider change or new dependency.
Targeted review and final CI remain required; unchanged native/visual evidence
is reused. Editor1668 main correction is close; wait for actual merged SHA to
combine compatibility reconciliation before another CI. Release interlock and
all production/provider/shared application/account/activation holds persist.

Editor1668 actually mergedb03198a9 at19:12:33Z; rebase onto that exact main
completed without conflicts. All six feature patches remain equivalent; image
helper's UUID-case-only change and tests are the only upstream delta. Migration
291/292 hashes unchanged, no renumbering/application or new stash. Combine this
interaction and image-pin batch44 in targeted431 after affected checks; final
focused gate/CI still required. Editor1667 release interlock remains held.

## 2026-10-23 — Final home base reconciliation after editor release

Editor release/receipt complete: actual finalmain24c294b1, interlock explicitly
released by its owner. Rebased home onto docs-only1669, preserving CURRENT and
exact production receipt. Conflicts only in history journals; keep both histories
and markers, remove one merge-reinserted historical duplicate only after byte
equality with its preserved earlier entry. All application/test/script/dependency/
configuration/SQL bytes match reviewed4772;291/292digests unchanged. No shared
migration/provider/activation action. Reused4557/145+static/source review431 and
accepted native/UI evidence; final docs verification/review432 and exact-head CI
precede normal1666mainmerge. This task's production/provider/account/plan/cohort
holds remain; tool goal and DeepSeek stay paused.

## 2026-10-23 — Include home preference in closed Test proof catalogs

CI40015415856 passed build, bothSDKs/lifecycle and home132 full replay/rollback/
contention/types/source-preservation, then an older member-list canonical-before
check rejected292's unlisted private home table before fixture allocation. Return
1666 to draft before batch46. RED2/156 reproduced the missing whole fingerprint;
include the sealed292 table centrally and preserve exact291 source compatibility.
Test missing/drifted fingerprints for create/publication/discard restoration,
tampered source and unknown catalogs;1645/3+ESLint/TSC PASS. No app/SQL/role/quota/
provider behavior changed. Unchanged accepted native/UI evidence reused; full
focused, independent433 and fresh exact-head member-list/cleanup CI remain gates.
Prior failed CI is not acceptance. All deployment/provider/shared-application/
account/activation holds remain unchanged.

## 2026-10-23 — Align reorder CPU graphs with complete292 preservation

Review433 covered the complete shared-catalog delta and accepted one P2: two
stale reorder CPU graphs omitted the correctly required home-table fingerprint.
Full gate20failed/4545passed; no product/SQL defect or timeout relaxation.
Batch47 updates only those two test graphs and explicit missing-home denial;
all original deadline/action/restoration corruption cases remain. Affected387/4
plus ESLint/TSC PASS. Full focused gate and targeted434 precede any push/ready;
real member-list/cleanup finalCI remains required. Production/provider/shared
applications/accounts/activation holds remain; no native or Docker action.

## 2026-10-23 — CI runner completion and capacity

Owner requests all-heavy self-hosted CI, smaller artifacts and a public hold until
quota acceptance. All eight heavy lanes and final PR Gate now select the runner;
classification stays hosted and classification failure retains hosted gate refusal.
Success artifacts removed; four failure sites cap256KiB/eight files with1day retention.
Mac4vCPU/12GiB admission reserves6GiB host memory and checks pressure/load/swap/storage;
current24GiB Mac refuses safely. Observed238heavy hours/week exceeds one serial slot.
Dedicated64GiB/1TBNVMe Linux/Tailscale setup, three-slot pilot and public hold documented
in docs/guidance/ci-runner-capacity-and-rollout.md. No machine exists yet; automatic
routing, live runner acceptance and post-activation quota week remain pending.
Local quota audit requires complete post-activation evidence and<=1000min/month,
<=250MB artifacts. No visibility, plan, production or database changes. Focused
workflow/policy/type/lint checks and bounded independent review recorded in PR.

First exact-head CI passed every heavy lane except light browsers: clearing the
remounted Pattern Lab question editor left Publish enabled. All assertions remain;
the test now uses native Select All/Backspace and checks the editor is empty before
parent validation. Local baseline passes did not reproduce the hosted failure.
Owner approved one bounded correction/review continuation. Rebased onto reviewed
main45fd19251, preserving its new classroom-home database proof and local aliases.
Application source, visibility and runner opt-in remain unchanged. Final focused,
browser matrix, targeted review and exact-head CI evidence is recorded in PR1670.

## 2026-10-23 — Editor overlay motion consistency

- Reused teacher Markdown authoring and student document-editor Pattern Lab owners. Two Tiptap wrapper styles now use semantic fast opacity entry, with no translation/zoom and an explicit reduced-motion animation-none path.
- Kept closed animation none: installed Radix presence would otherwise retain live commands and delay editor-owned unmount focus callbacks. No JavaScript, focus ownership, content parsing or saved-draft behavior changed.
- Existing 40 editor tests and eight teacher/student Markdown-authoring browser cases pass, including focus return, keyboard navigation, draft preservation and target sizes. Motion/visual measurements, canonical gates, independent review and exact-head CI/PR Gate are tracked in the PR and retained private receipts.
- The local Supabase stack exposed only DB status, so the normal launcher refused; used the existing Playwright fixture-server configuration with an in-process session secret and unreachable loopback API placeholders. No backend changes, dependencies, migrations, API writes or production promotion. Broader experience work remains incomplete.

## 2026-10-23 — Contextual owner manual-attendance authorization

Signed-in home verification identified the Daily manual-attendance fallback still
requiring a global teacher role before classroom ownership. Owner approved the
narrow app fix and a new frozen verification revision. GET/PUT/POST reuse existing
shared attendance actor admission; unmatched accounts retain the original teacher
gate. Actual classroom ownership, archived read/mutation distinction and unchanged
SQL roster/day/revision guards remain authoritative. Red route regressions reproduced
26 failures before the fix; affected API/store/hook/migration tests pass afterward.
Full local checks, independent auth/compatibility review and exact-head CI precede
main merge. No schema, cohort, provider, account or production changes; existing
failed rehearsal evidence is retained and does not establish workflow acceptance.

## 2026-10-23 — Contextual member notification reads

Owner approved the signed-in mixed-role notification gap after an actual route
regression reproduced403. Admitted current nonowner members now use compact,
bounded classroom-root reads for the unchanged four notification counters;
every payload and terminal page binds active class, actor, owner and enrollment
generation. Publication/own-resource checks, repeated snapshot validation and a
final relationship guard reject observed drift without claiming a transaction
snapshot. Absent/unadmitted behavior retains the original student-role path.
Focused legacy/contextual/route-standard tests, TSC, lint and architecture checks
pass; final independent review/full focused checks remain coordinator-owned.
No migration, dependency, account, cohort, provider or production changes.

## 2026-10-23 — Prepare activation-off Home foundation release

Owner explicitly approved292 locally and in production, then reviewed-main
release with activation off. Local sole292 push and production apply40059138246
both verified contiguous001–292; production preview40059060682 matched only292.
Read-only checks match both installed function bodies, private RLS/ACLs and
validated enrollment PK/FKcascade. No reset, seed, retry or production fixtures.
Release1673 batches reviewed main3c1be2d39; full focused4738tests/151suites and
static gates pass. Independent security464/compatibility465 complete clean.
Reconciled only journal merge history with productioncd7179, retaining both
parents and unchanged application/SQL/config/dependency bytes. Final delta
review and exact-head CI precede merge. Home/admission/page settings remain
absent; existing provider/control metadata unchanged. Live-provider, activation,
account/plan/billing holds remain; this is not pilot or overall cutover acceptance.

## 2026-10-24 — Release inactive classroom Home foundation

Owner explicitly approved sole292 locally/production and reviewed-main release
with activation off. Local pinned CLI and production apply40059138246 both
verified001–292; read-only bodies/grants/RLS/PK/FK checks pass. Release1673
independently reviewed464–466, local4738/151+1022/73 and exact-head CI40059627420
all10jobs/PRGate PASS. Protected merge4778514b0 has exact reviewed tree; Vercel
dpl_DHbxckpbMDrojHGw6uD5ZePPpS54 and public alias READY00:28Toronto. Six public
unauthenticated GET checks pass, including exact root307→login200; initial
root200 expectation was a smoke-assumption error, not an app change. Five
activation settings absent;24provider/controlmetadata records unchanged. No
retry/reset/seed/production fixture/provider/account/plan/billing/activation
change. Detailed receipt records recovery/pilot/canary gaps; cutover not complete.

## 2026-10-24 — Assignment image submission recovery

Owner requested both image bug fixes and safe A4 submission for affected learners. Current task owns codex/a4-image-submission-recovery. Extended ManagedImage clipboard metadata, added scoped authorized save/submit recovery for already-open drafts and null optional identities, and restricted repaired-metadata equality to submission acknowledgement. No migrations, flags, deadlines, grading or production data writes. Focused checks2463pass,8skip; four added helper cases also pass. Real local atomic save/submit rollback proof and Playwright role/viewport/theme matrix pass with synthetic data. Independent draft-first review and production promotion remain pending. Guidance/evidence and review budget: docs/guidance/assignment-image-submission-recovery-2026-10-24.md.

## 2026-10-24 — Prepare classroom Home recovery and pilot

Prepared a rollback-only creation freeze/getter-permission fault/restoration
contract in the existing sealed offline owned-clone verifier, plus actual-route,
adapter and server-page CPU composition tests for both account-role labels.
The layered evidence intentionally does not claim real PostgREST/browser outage
or deployed recovery. Pilot packet records compatible477/schema292 floor,
retained-admission growth stop, canaries, zero-tolerance stop conditions and
unset operator/cohort/activation authority. Root verified84focused cases and
TypeScript. Reviews468–470 cover source and corrections; bounded
Sol6.1/high workers supplied read-only design (~8min) and SQL implementation
(351s), effective model/tokens unknown. No runtime, migration, dependency,
production, real-account, provider or activation change. Cutover remains open.
First isolated attempt stopped on a legacy plain-text work fixture in JSONB
content; no product defect. Source schema preservation and exact-owned cleanup
passed; failed evidence retained. Red/green regression now parses the fixture's
actual JSON document; independent delta review precedes a fresh attempt.
Fresh reviewed a3ae3d947 offline run passed17.2s:001–292 replay, real service-role
fault/recovery, strict118-byte rollback verdict, whole table/catalog preservation,
unchanged lock contention, generated types and canonical schema/source equality.
Exact owned resources absent; full failure/success evidence retained privately.
Final receipt review/CI/main merge pending; production477 and activation/provider
holds unchanged. Pilot still requires selected operator/cohort and authorization.

## 2026-10-24 — Assessment diagnostic privacy cleanup

Owner approved orchestration; journal-derived product feedback stays unchanged.
Three disjoint GPT-6.1 Sol/high implementation workers migrated Assignment/Test
API and document/helper diagnostics; coordinator owns shared allowlist, guard,
integration and review. Replaced140 raw server error logs plus one fixed Test
publication log; browser history warning no longer carries an entry ID. Cleanup
retry records use fixed stage descriptions instead of provider/database messages.
Synthetic red/green coverage:35 Assignment boundaries,26 Test assertions and47
helper cases. Scoped regressions pass242/288/127 tests respectively. Source
comparison finds no unexpected logic deltas; durable diagnostic changes and
literal operation branches reviewed separately. No UI/schema/dependency/query/
authorization changes, production actions or historical log deletion. Remaining
logging inventory/vendor controls stay open. Focused gate, independent review and
stable-SHA CI follow; evidence in private log-privacy-assessment-cleanup handoff.
Storage healthy256GB; weekly65% remaining at start; DeepSeek pause honoured.
Worker token/effective-model and coordinator active-time telemetry unavailable.
PR1678 initial full gate passed13,195 tests/8skipped plus architecture, policies,
TypeScript and lint. Independent privacy review found an immediate JSON-patch
helper still emitting document trees; compatibility review found no regressions.
One remediation batch replaces both patch-helper logs with browser-safe fixed
warnings and strengthens aggregate reconstruction diagnostics tests/guard.
Targeted review and exact-head CI remain required before readiness/merge.

## 2026-10-24 — Three-account Home pilot acceptance reconciliation

Recorded exact production1da699/schema292 and the retained dedicated three-account
Home admission. Actual owner-assisted browser canaries passed reciprocal creation,
code join, Teaching/Joined, persisted hide/unhide and outsider UI denial. Final
scoped state matched one owned/one joined per reciprocal account, no Control
membership and unchanged plans/providers. Corrected stale current-state and
preparation-only wording; private identities/codes/content stay outside Git.
Kept production replay, classwork/manual-return and direct API negatives distinct
from accepted isolated domain/lifecycle/recovery proofs. No new runtime/schema/
provider/cohort change or epic exit; live-provider/expansion holds remain.
Docs-only focused checks and independent review precede normal main merge.

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

## 2026-10-24 — Promote assignment image recovery with production ancestry

Feature1675 merged72870cab6 after complete independent review and exact-head CI40086394324:21994 tests, full build, database contracts and all browser matrices pass. Draft promotion1676 reconciles only journal ancestry against production4778514b0. Main already retains the archive conflict's substantive entries; preserve that archive, omit duplicate old classroom release entry and retain the production-only October23 Home release preparation entry. Application, SQL, dependencies and configuration remain exact reviewed main. Targeted cumulative re-review and new exact-head CI precede protected production merge; no migration, activation, provider action or direct student data rewrite.

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

## 2026-10-25 — Prepare manual-grader reader compatible release

Owner approved this exact grader-label fix after review and CI, retaining only
the existing three-account cohort, plans, schema and provider holds. PR1682
merged7c2756906 after final CI40158570083 passed all ten checks. Draft promotion
1683 reconciles only journal ancestry with production1da699fdc, preserving both
histories and all non-history bytes from reviewed main. Independent cumulative
compatibility review and exact-head CI precede protected production merge. No
new provider call, migration, cohort expansion or account change is authorized.
Both owner and learner sessions remain signed in; Return/feedback wait for the
compatible READY deployment and fresh readback.

## 2026-10-25 — Approved Return inspector compatible release

Prepare production promotion of reviewed main19b5/PR1684 after the owner approved this exact compatible fix. Only runtime change is selected-inspector refresh after acknowledged Return; existing revision/dirty/write fences remain. Reconcile the two history files while preserving both parents; reuse accepted source/component/browser review477 and complete cumulative promotion review before ready CI. Keep exactly three pilot accounts, schema292, plans and live-provider/expansion holds unchanged. Signed-in no-reload Return/comment canary follows actual READY/source/control verification.
