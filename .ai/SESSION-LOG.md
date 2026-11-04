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
