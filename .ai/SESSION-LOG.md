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

## 2026-09-22 — Test grading calibrated against adjudicated work

Continuation of the earlier entry today; that one stopped before the second rule and the
harness landed. Shipped after it: PR1321 (request timeout 25s to 60s), PR1324 (retry at
reduced reasoning effort instead of failing when both token budgets truncate, plus
`reasoningEffortUsed` in assignment and test provenance), PR1330 (score itemized rubrics as
a checklist) and PR1331 (the calibration harness itself).

PR1330 came from adjudicating real responses with the teacher. On a ten-criterion key worth
ten marks, submissions satisfying six and seven criteria scored four; the teacher set both
at 6-8 and 7-8. Failures were being charged more than once. Measured on a fixed benchmark —
all 48 ten-point responses, five with verified targets — both adjudicated cases moved from
4 into band (8 and 7), cell harshness fell from 36/48 to 21/44, and weak submissions held
their low scores rather than floating up, which was the specific failure mode worth checking.
Generalisation was then measured by re-running the same 80 responses from the earlier seed-7
run: overall agreement 42 to 47, mean absolute disagreement 0.145 to 0.132, with the 10-point
cell improving on a different draw than the rule was derived from.

I dismissed this finding once before. A sweep of a second ten-point question graded
accurately and read as a refutation, but those submissions failed on concepts rather than
transcription and had fewer satisfied criteria, so the effect had little room to show. Two
non-comparable questions treated as if one disproved the other; it cost several rounds and
only resurfaced once PR1319 removed the masking noise.

Reasoning effort was tested and ruled out as the cause of 10-point harshness: low and medium
are harsh at an identical 36/48, and medium is marginally less harsh and more accurate for
1.5x the tokens. Keep medium; stop looking there.

OPEN, and the reason to keep the benchmark. The 9-point cell drifted more lenient under
PR1330 (+0.239 to +0.248). This was predicted before the run — a floor rule raises scores by
construction and that cell was already the most lenient — and it is NOT resolved. It cannot
be resolved by another run: that cell is scored against the marks with the strongest evidence
of being wrong, including the response recorded 2/9 which the teacher adjudicated at 8/9. It
needs a human to adjudicate a handful of 9-point cases. Also open: peak output reached 16,386
tokens after PR1330, so the 60s timeout binds again on the heaviest responses; four of 48 and
one of 80 responses failed on timeout or invalid output in the last two runs.

The benchmark is repeatable: `pnpm calibrate:test-grading --max-points 10 --all` over the 48
ten-point responses, with verified targets for student-21 (6-8), student-16 (7-8), student-20
(~10), student-12 (8-9) and student-06 (9). De-identified snapshots for both archived
classrooms sit gitignored in the repo root.

Process: this session again worked in the hub checkout rather than a feature worktree, and
pushed twice to ready PRs, which PR Gate correctly rejected both times. Risk profile:
async-grading.

## 2026-09-22 — Assignment AI metering canary gate

- Owner `codex/assignment-ai-metering-canary`; risk profiles async-grading and runtime-platform. Production and local ledgers were verified at migrations001–205. The production classroom-creation cutover remains disabled with181 accounts unclassified, Assignment metering has zero reservations, service-only privileges are intact, and migration205 has no malformed student Grades settings.
- Assignment AI metering now requires both the exact-`true` server master switch and the authenticated teacher's exact account ID in a bounded comma-separated cohort. Every Assignment request uses the existing durable coordinator: missing, malformed, oversized or unmatched cohorts create unmetered version0 runs, while exact matches create metered version1 runs. Persisted version1 runs remain resumable independently of later gate changes. No flag, cohort, entitlement, quota or active production rollout changed.
- Targeted Assignment usage/run/API coverage passes91 tests plus TypeScript. The focused gate passes309 tests across24 files plus architecture, UI/design policy, TypeScript and lint; Pika audit is clean. Model recommendation: GPT-6 — financial-usage admission and resumable async grading rollout boundary.
- Independent security and architecture review found that a single-student retry could leave the durable path after a teacher was removed from the cohort, bypassing an active version1 reservation. A standalone active-run check still had a creation race, so remediation removes the split entirely: all Assignment AI requests now enter the atomic durable coordinator, where matching work resumes and conflicting work remains blocked. The metered Gradex smoke also requires its stable teacher ID in the cohort and verifies a version1 run with exactly one settled `grading.ai` reservation.

## 2026-09-22 — Daily Log PR final merge window

- PR1329 reviewed head1d8a9d11 passed all required CI lanes, but main advanced to d09b8ec4 during the browser run, so strict up-to-date rules prevented merge. User paused other main merges for a quiet window. The Assignment AI metering commit merged into this branch without conflict or Daily Log source edits; refreshed checks, exact-head review and CI precede the normal squash merge. No admin bypass or persistent database migration.

## 2026-09-23 — Future classroom retention roadmap

- Owner `codex/classroom-retention-roadmap`; risk profile none. Documented a proposed, plan-independent archived-classroom retention sequence and advance notices in the lifecycle roadmap, with a pointer from the product roadmap. It remains future work; no email, timer, automatic cold transition, deletion worker, database migration, or rollout gate was enabled.

## 2026-09-23 — Dormant account plan foundation

- Owner `codex/account-plan-foundation`. Migration206 adds service-only, revisioned account plans and an audited writer that derives the `classrooms.create` snapshot from Free0, Basic2, Plus5 or Pro10 in one transaction. No caller-supplied quota, existing-account backfill, strict-cutover activation, billing, AI allowance, production configuration or UI change is included. Future signups acquire Free only after the existing strict cutover is activated.
- With exact authorization, migration206 SHA256 `bc29eefb4b074c4bbad5f43f9755edb5b80c0f91ff157e009784c742d35bd4b8` applied to the local Pika database only; local history is001–206, production remains001–205. The rollback-only contract passes plan mapping, post-cutover Free signup, operation replay/conflict, stale revisions, browser-role isolation and existing-class preservation on downgrade. Generated types match the local schema. The focused gate passes94 tests plus architecture, TypeScript and lint. Local advisors report no new account-plan warnings; hosted application and production data remain unchanged.
- Rebased onto `f6716e39` after the retention-roadmap merge. The only conflict was an archive-batch marker for identical session-history content; retained main's marker. Migration 206 stayed sequential and unchanged. Fresh local checks and exact-head review/CI are required before this PR is ready again.

## 2026-09-23 — Gradebook zero assessment weight

- Owner `codex/gradebook-zero-assessment-weight`; risk profile none. Gradebook assessment weights now accept 0–999 across teacher controls, APIs, blueprints, and stored constraints. Zero is preserved on reload and excluded from final-grade math; all-zero categories remain ungraded. Migration207 is prepared but not applied to any database.
- Focused checks passed 733 tests plus architecture, UI/design policy, TypeScript, and lint. Pattern Lab teacher Gradebook verified at desktop light/dark and mobile; a zero entry displayed 0% course weight. Local type check is blocked because migration207 has not been applied to the shared local database; final database replay remains a CI gate. Model recommendation: GPT-6 Sol — multi-layer gradebook contract and migration change.
- Independent review found two follow-ups: dropping assignment/test defaults would change generated Insert types, and returned zero-weight work would still appear counted in student views. The remediation uses a -1 insert-only default sentinel that the existing before-insert trigger resolves to the category default, and labels zero-weight assignment, test, and standalone marks as not counted. Route and server regressions cover those projections; final checks and targeted re-review follow.

## 2026-09-23 — Bulk test grading execution fix and provenance hotfix

- Owner `claude/fix-bulk-grading-limits` (PR1340, draft); risk profile async-grading. #1324 added `reasoningEffortUsed` to stored AI grading provenance, but migrations 101–104 whitelist provenance keys exactly, so every AI grade save failed. PR1342 (merged to main as `e31dcfc5`) removes the key from storage and adds `tests/lib/grading/provenance-db-contract.test.ts`, which reads the whitelists from the migrations. Anything new in stored provenance now needs a migration first. Production still runs the broken code until draft PR1344 (`claude/promote-grading-hotfix`: #1336, #1338, #1342; excludes #1339) merges; it must first take production after Codex's PR1343 lands.
- PR1340 makes "Grade all" for tests safe at any batch size without changing grades: attempts are recorded before each provider call, items whose attempts were all interrupted fail instead of restarting (previously an unbounded billed loop), no call starts unless it can finish and save inside a 270s tick budget, tick `maxDuration` 300s, request timeout 60s, lease 240s. Batch output budget grows with the call and caps batches at 4, which is production's size. The DeepSeek adapter captures cache and reasoning tokens in memory only; the stored schema strips them. Focused gate: 513 tests plus architecture, UI/design policy, TypeScript and lint; the contract test fails when a cost field is added to the stored schema.
- Next: independent review of PR1340, then ready and merge on a green PR Gate with owner approval. Then PR 2, a comparison harness in `scripts/calibrate-test-grading.ts`: batch size 1, 2 or 4 chunked like production, a shuffled-order seed, manual or bulk profile, per-answer latency and cost, scored against the verified targets; align its `MAX_BATCH_SIZE` of 20 with the cap of 4. Independent calls are a hypothesis until that harness measures them. Teacher calibration decisions and de-identified snapshots stay outside the repo (public): snapshots gitignored in the hub root, adjudication notes in the owner's local handoff folder. Open and unowned: the sanitizer turns common-word names into initials, DeepSeek errors reach teachers untranslated, and the middleware logs 25s timeouts.

## 2026-09-24 — Bulk test grading independent review

- Resumed PR #1340 after the Claude handoff. Initial Sol/Terra review found uncached reference generation ran before durable attempt accounting and missing-question recovery could exceed the attempt cap. One correction batch places preparation inside the counted microbatch attempt, checks the deadline again afterward, and caps missing-question recovery. Four new regressions fail before the correction and pass after it; runner suite passes 20 tests. No migration or grading-strategy change. Focused verification, targeted re-review, and owner merge approval remain required.
- Owner approved a final bounded review, merge on green PR Gate, and production promotion. Final review found database writes or lease renewals could consume the admission window after its check; recheck immediately before reference preparation and single/batch provider calls. Four additional regressions failed before this correction and pass afterward; runner suite now passes 24 tests. Final focused verification and independent confirmation remain required before ready.

## 2026-09-24 — Practice test local server

- Started Docker and Pika on port 3000 from `codex/practice-test-local`, based on main at `94bf3d37`, using the local-dev launcher and existing local Supabase data.
- Environment verification passed; Next.js reported Ready. Server retained for the user's practice test work.

## 2026-09-24 — Responsive teacher test preview

- Fixed embedded preview inheriting the editor's inactive background. Reused ModalLayer for top-layer focus, inertness, scroll locking, and return to the still-mounted editor; reused PageState so maximize/close survive pending reads. Student test-taking and fullscreen requirement unchanged.
- UI brief: teacher preview; reference DESIGN overlay contract and Pattern Lab dialog; reuse ModalLayer/PageState, extend preview composition. Teacher desktop/mobile (1440/390), light/dark, loading/ready/maximize/close/focus; student n/a (teacher-only component). Primary signal remains maximize action/Preview Mode; no new pattern or promotion. Composite keyboard/semantics checklist covered. Risk: workspace-state, exam-mode (teacher preview only). Model recommendation: current Codex for implementation; GPT-5.6 Terra high for one standard-risk independent review.
- Two new regressions failed before and passed after; 11 preview tests and focused gate (159 tests, architecture, UI/design policy, types, lint) pass. Playwright delayed-read/maximize/close/focus matrix passes; screenshots inspected at /tmp/pika-preview-visual; reproducible runner /tmp/pika-preview-verify.cjs. Existing async test-id/request guards retained. Pattern Lab shared modal reference inspected. No shared-component extraction needed.

## 2026-09-24 — Reusable classroom test-authoring guidance

- Owner `codex/test-authoring-guidance`; documentation-only, risk profile `none`. Added a general assessment-authoring guide and routed it from AI instructions, the docs index, and the markdown schema. Covers prompt/rubric/sample alignment, observable credit, diagrams, difficulty, preservation of existing tests, and content readiness versus measured AI grading consistency.
- Course-specific coding and Karel preferences belong in the companion ICS3U guide. This change does not modify assessment content, grading behavior, publication state, or production data.

## 2026-09-24 — Student test question scrolling

- Owner `codex/student-test-scroll`; risk `exam-mode` (layout only). Bound the existing student question section to its split pane height so long tests scroll to the final questions and Submit. No assessment, attempt, or focus-tracking changes.
- Reuse ExamDocumentWorkspace/WorkspaceSplitPane; extend StudentTestsTab with the same bounded scroller used by TeacherTestPreviewPage. Student desktop/mobile light/dark wheel-scroll and reference/answer retention checked; teacher n/a (student-only change), no new pattern or promotion. Existing divider keyboard resizing checked.
- Validation: 43 component tests, four mocked browser matrix checks, focused checks (186 tests, architecture, UI/design policies, types, lint). Local screenshots under `test-results/experience-matrix-student--3e2c4--final-questions-and-submit-*`; fixture avoids live student attempts. Production deployment remains separate.

## 2026-09-24 — PNG/JPEG test references

- Owner `codex/test-reference-images`; user approved PNG/JPEG implementation and orchestration in this task, with SVG deferred. Extend private managed uploads with bounded image header/dimension validation and migration208's bucket MIME additions. Existing authorization and cleanup remain in use; no dependencies or public storage added.
- Reuse the document workspace and canonical controls for a shared teacher/student image viewer with fit, zoom, loading/error/retry and a white transparent-image canvas. Upload dialog accepts images and displays validation errors inside the modal. Preserve question input and exam activity tracking. UI brief and rollout ledger: docs/plans/test-reference-images.md.
- Bounded implementation and browser workers delivered API regressions and teacher/student desktop/mobile light/dark scenarios. Coordinator fixed cached-image hydration and narrow-screen pane height based on browser evidence. Final focused gate and visual matrix results recorded in the plan.
- Initial independent review found ambiguous image filename detection and a failed duplicate finalization/cancellation race. One correction batch uses a server-created image path segment and retains failed image reservations for existing one-hour expiry/manual cleanup; verified retries skip reads. Regression tests reproduced both failures before correction.
- Targeted review caught the managed classroom/blueprint copy path dropping the image marker. Second batch preserves the namespace from source MIME; round-trip PNG/JPEG and misleading-PDF cases plus copied-viewer regressions cover it.
- Approved continuation: unchanged implementation e05267b9 passes910tests/70files plus architecture/UI/design/types/lint. Targeted review launch4 clear. Migration208 applied once to local Supabase; all208 history entries and generated types match, private bucket/25MB limit preserved. Real PNG/JPEG upload, finalization/retry, persistence, teacher/student delivery and anonymous denial passed; temporary local test removed. Final cumulative review and ready CI follow; no production action or merge.

- Final cumulative review found archive restore lost image controls when rewriting attachment paths. Third correction preserves a test-image namespace from verified archive MIME;4 regressions failed before and35 affected tests passed after. All test-upload producers audited (direct upload, blueprint copy, archive restore); targeted closure and ready CI follow.
- Restore canary independently calculated extensionless paths; updated its bucket-scoped PNG/JPEG projection and compared it against the actual verified restore plan. Two regressions fail before and24 canary tests pass after. Existing non-image and other-bucket paths remain unchanged.
- Final targeted closure is clear at412b591b; full1024tests/77files and local Storage smoke passed. Synced unrelated main documentation after an archive-marker-only conflict; application source unchanged. Ready CI follows.

## 2026-09-24 — Account-plan rollout runbook

- Owner `codex/account-plan-rollout-runbook`; documentation-only, risk profile `none`. Added a plan-specific operator sequence for read-only account inventory, explicit owner decisions, audited per-account assignments, and a separately approved strict cutover. Marked the earlier Access-pilot cutover as historical for plan classification.
- No account, entitlement, migration, database switch, app behavior, or production data changed. Live account inventory remains unverified while hosted access is unavailable. Model recommendation: GPT-6 Sol — bounded rollout documentation tied to existing migration contracts.
- Independent documentation review found that audited-missing grants fail closed even before strict activation and that ownership-transfer canaries were omitted. The runbook now calls out both conditions and their stop/repair behavior; targeted re-review and final CI remain pending.

## 2026-09-24 — Teacher assessment title editing

- Owner: `codex/assessment-title-edit`, coordinated in the existing task. Approved outcome: tapping the selected Test or Assignment action-bar title opens its existing editor. Implementation worker owns the two teacher views and their component tests; coordinator owns browser verification, guidance, and PR lifecycle.
- UI brief: reuse the selected Test context-bar layout, Pattern Lab ghost Button, existing edit handlers/dialogs, and `TeacherWorkSurfaceContextBar`; no shared extraction. Teacher desktop/mobile, light/dark, default/hover/focus/disabled/modal-open and long titles. Student n/a (teacher-only consumers). Primary signal: subtle button hover and visible focus; no new icon or decorative chrome. No new composite widget; check keyboard activation and modal focus return. Risk profile `none`.
- Implementation complete: both title buttons reuse their existing editor handlers. Read-only buttons remain disabled; assignment loading uses guarded aria-disabled semantics so shared modal focus return survives the refresh. Long titles truncate within the context column without clipping focus.
- Evidence: 130 component tests pass; Playwright covers both surfaces at desktop/mobile in light/dark (8 cases: default/hover/focus/open, keyboard/touch activation, Escape and focus return), plus 4 long-title cases. Screenshots/scripts/results: `output/playwright/title-edit/` (local, ignored). Student n/a because only teacher consumers changed. Composite accessibility checklist reviewed; keyboard and semantic-state checks covered; no manual follow-up. Next: focused checks, draft PR, one standard-risk independent review, and stable-SHA CI; no merge or production rollout authorized in this task.

## 2026-09-24 — Test publication in the student-table action bar

- Owner: `codex/test-publish-action-bar`. Moved draft-only Publish from the test editor into the selected test's student-table action bar; reused saved-draft validation and confirmation, and removed obsolete dialog publication props/state.
- Verification: 225 focused tests plus architecture/UI/design/TypeScript/lint checks and Pika audit pass. Local Playwright fixtures cover teacher desktop/mobile, light/dark, draft focus, editor, confirmation, and published states; screenshots under `output/playwright/`. Compared with Pattern Lab teacher controls. Student UI is unchanged. No new shared component or experimental pattern.

## 2026-09-25 — Assessment title PR merge preparation

- User authorized merging PR1358. Original reviewed head `4f99bcf7` passed Test & Build, Browser Experience Matrix and PR Gate. Main advanced via PR1355; rebase conflict was only a duplicate session-archive batch marker. Preserved main’s marker and both sessions; title implementation and its tests are unchanged.
- PR returned to draft before rebasing. Next: focused checks and targeted rebase review, then stable-SHA CI and authorized squash merge to main.

## 2026-09-25 — Publish tests from either teacher surface

- Updated `codex/test-publish-action-bar` / PR1357 to retain Publish in the edit modal as well as the student-table action bar, per revised request. Restored the modal's save-before-publish flow and inline validation errors; both controls remain draft-only.
- All226 focused tests, architecture/UI/design/type/lint checks and Pika audit pass. Playwright verified both publication entry points and both controls disappearing after publication across teacher desktop/mobile light/dark (eight flows). Student UI unchanged. Independent updated-SHA review follows.

## 2026-09-25 — Production Test split-pane authoring

- Owner: `codex/test-split-pane-real`. Applied the approved Pattern Lab Test editor to real New/Edit Test authoring: headerless desktop split panes, left Title/Settings/Reference Docs/Markdown and bottom Preview/Publish, right selected question with centered navigation, compact Points and consolidated Question actions. Reused CreationModalShell, real reference-document workflows, Markdown import/export, draft autosave, publication and maximized whole-Test preview. No student form, API, schema, or dependency changes.
- MC options support automatic trailing blank creation, remove, pointer/keyboard rearrangement and correct-answer preservation. Open response keeps answer key/sample solution and the separate Code response menu choice. Navigation/preview/publish/close flush local edits and reject invalid options/points rather than silently dropping them; wording-only editing protections remain in force.
- Focused checks pass 17 files / 281 tests plus architecture, UI/design policy, TypeScript and lint. Audit clean. Composite-widget checklist reviewed: keyboard behavior covered (existing menu/dialog plus option reorder); semantic state tested; final visual verification and independent review follow. Teacher-only authoring means student view is n/a; existing full-test preview is reused unchanged.

## 2026-09-25 — Disable student actions for unpublished tests

- Owner: `codex/disable-draft-test-student-actions`. Draft test student tables now disable selection, batch grading/return/unsubmit/delete, access controls, and row unsubmit; row activation cannot open the grading inspector. Publish remains available from the action bar and editor. Publishing restores student selection and actions.
- Reused the existing teacher test action bar, student table, and status controls; Pattern Lab teacher operational controls were the visual reference. No student-facing surface changed. Teacher desktop/mobile light/dark fixture verification passed for draft and published states; screenshots under ignored `output/playwright/`.
- Component coverage includes stale submitted/open draft rows and confirms controls remain disabled; 77 direct component tests passed. Pika audit passed. Composite-widget accessibility checklist reviewed: keyboard behavior yes, semantic disabled state tested yes, manual follow-up none. Focused checks and PR review follow.
- Independent review found direct draft grading/deletion API access despite UI gating. One remediation batch adds draft rejection to AI grading/suggestion, manual grade/save/clear, and single/bulk work deletion routes, with no-mutation API regressions. Exit-alert activation is also disabled for drafts; draft student tables do not start exit polling. Affected tests: 126 passed; focused gate: 269 passed plus architecture/UI/design/types/lint; audit clean. Targeted re-review and stable-SHA CI follow.
- Targeted re-review found queued AI grading runs could still tick for draft tests. Second correction rejects draft ticks server-side and stops client polling for draft runs; API and component regressions pass (81 targeted tests). Final targeted review and ready-SHA CI follow.

## 2026-09-25 — Draft test selection guidance

- Updated PR1361 on `codex/disable-draft-test-student-actions`: disabled draft student header/row checkboxes and the Student actions menu now show concise Publish-first tooltips on hover and keyboard focus. The shared `TableSelectionCheckbox` has an optional `disabledTooltip` prop; Pattern Lab documents it with a deterministic teacher example. No student UI changed.
- Reused canonical Tooltip and existing teacher table/menu owners; no new visual pattern. Teacher draft/published states passed Playwright at 1440/390 widths, light/dark; Pattern Lab teacher example passed the same matrix. Screenshots under ignored `output/playwright/`. Composite widget checklist: relationships retained; focusable disabled guidance and semantics tested; no manual follow-up. Focused gate passed 1820 tests plus architecture/UI/design/type/lint checks; audit clean. Independent review and stable-SHA CI follow.
- User approved resuming the time-limited independent reviews. Both reviewers confirmed two blockers: Turkish/German case variants could evade name masking, and unknown batch-grading provider refs could reach durable Test-run errors. Batched fixes add folded matching with original grapheme-offset substitution and fixed unknown/duplicate-ref errors, preserving existing retry/classification behavior. Also corrected UTF-16-only initials for astral names.
- Added regressions for Turkish-I, sharp-S in both directions, Greek sigma, unchanged surrounding text/context, astral initials, and actual batch-adapter errors through saved Test-run items. Targeted tests pass 4 files / 75 tests. Focused gate, targeted privacy re-review and final cumulative integration review remain required before ready/CI. No migration, dependency, production setting or deployment change.

## 2026-09-25 — Remove Test split-pane prototype header

- Removed the visible full-width Edit Test header and made the experimental modal flush to its pane edges. Saved status now sits beside the Title label and Settings icon; the accessible Close control remains at the top-right without overlapping the mobile controls. Production Test editing and other creation modals are unchanged.
- Extended the shared modal shell with an optional panel class hook, used only by this prototype. The focused gate passes 21 files / 276 tests plus architecture, UI/design policy, TypeScript, and lint. Pattern Lab interaction and visual verification pass for teacher desktop/mobile in light/dark; student is n/a because Test authoring is teacher-only.
- Centered the Test question number/previous-next selector at the top of the right pane and consolidated Points, open-response Code, Duplicate, and Delete into its action bar. Removed the redundant question-reorder arrows and the right-pane Questions heading. On mobile, Close now lives in the scrolling Title row rather than floating over Publish. Four teacher Pattern Lab browser variants and the refreshed 276-test focused gate pass; production Test editing remains unchanged.
- Removed the full-width header from both the Pattern Lab assignment edit prototype and the production Assignment edit modal while preserving the create modal's visible header. The edit Title line now contains autosave status and the accessible Close control, leaving the editor toolbar unobstructed; the split panes begin at the dialog edge. Focused checks pass 21 files / 277 tests plus architecture, UI/design policy, TypeScript, and lint. Eight assignment/Test Pattern Lab browser variants pass; live teacher edit was visually inspected desktop/mobile in light/dark. Student is n/a for teacher editing.
- Consolidated the Test prototype's question selector, type, compact in-field Points label, Add question, and overflow options into one top action bar. Open-response Code response, Duplicate, and Delete now use the accessible overflow menu; the close control stays beside Title at all widths. Four teacher desktop/mobile, light/dark interaction and visual checks pass. Production Test editing remains unchanged.
- Replaced the separate Add and overflow triggers in the experimental Test edit action bar with one blue `ListPlus` Question actions menu. It offers add multiple-choice/open-response, open-only Code response, Duplicate, and destructive Delete, with semantic checked state and focus restoration. Desktop/mobile, light/dark Pattern Lab checks and open-menu screenshots pass; production Test editing remains unchanged.
- Replaced the Test prototype's selected-question Preview dialog with the existing full-screen teacher Test Preview/StudentTestForm composition, fed by its unsaved in-memory draft and reference list without API writes. The editor dialog suspends while previewing and restores focus on Close; browser full-screen/maximize behavior matches the saved-test preview. MC answer options and correct choices are now stored per question so a full-test preview reflects each draft independently. Unit and four teacher Pattern Lab desktop/mobile light/dark interaction and visual checks pass; production saved-test preview behavior remains unchanged.
- Made New Assignment use the existing headerless split-pane AssignmentForm in both production and its Pattern Lab example, matching Edit Assignment without changing create/draft behavior. Teacher desktop/mobile light/dark screenshots and interactions pass; focused checks pass 23 files / 292 tests plus architecture, UI/design policy, TypeScript, and lint. Student is n/a for teacher authoring.
- Pulled main `f4c6e3ff` into the uncommitted prototype worktree. Resolved the sole stash-restore conflict in the continuity archive, retaining main and prototype history; product code auto-merged. The refreshed focused gate passes 23 files / 305 tests plus architecture, UI/design policy, TypeScript, and lint, and eight Assignment/Test Pattern Lab desktop/mobile light/dark checks pass. No migration was applied by this sync.
- Brought the Pattern Lab split Test Text reference in line with production authoring: its add/edit dialog now captures a required title and up to 20,000 characters of Markdown, supports cancel/validation, and feeds actual content into the full-test preview. The prototype's Reference Docs row opens the editor; no API writes or production Test editor changes. Focused checks pass 23 files / 305 tests plus architecture/UI/design policy, TypeScript and lint; four teacher desktop/mobile light/dark add/edit/preview flows and screenshots pass. Student authoring is n/a; teacher preview uses the student-facing reference renderer.
- Synced main `513aeaa0` before the split-pane PR; the only restore conflict was the shared archive, preserving both histories. Added a Title/Close accessibility regression test and passed the pre-commit audit plus refreshed focused gate (23 files / 306 tests, architecture, UI/design policy, TypeScript and lint). The 12-case Pattern Lab split Assignment/Test and Markdown-reference browser matrix passed across teacher desktop/mobile light/dark; an initial mobile-dark 404 was traced to two local servers sharing one checkout, then rerun successfully on a single server. Production Test editing remains unchanged; draft PR, independent review and stable-head CI follow.
- Draft PR1362 independent review found five prototype edge cases: whole-Test Markdown rejected Text reference headings, preview Close left browser fullscreen, sample PDF opened unavailable/blank, Publish ignored errors on other questions, and reference/option drag handles lacked a keyboard path. One remediation batch preserves headings and field-like Text content in the existing Test Markdown parser; makes the sample reference a visibly rendered Text doc and labels new PDFs as pending prototype uploads; owns/exits preview fullscreen; validates all questions; and adds arrow-key reordering with focus and browser/component coverage. The focused gate passes 49 files / 774 tests plus architecture, UI/design policy, TypeScript, and lint; audit passes; 12 teacher desktop/mobile light/dark Pattern Lab browser checks pass. Targeted review, final integration review and ready-PR CI follow.
- Targeted re-review at `ddd5e498` found two residual edges: a literal `### Document N` heading still collided with whole-Test Markdown delimiters, and fullscreen entered through the preview's retry button was not released. Batch2 adds reversible escaping for reserved structural headings in prompt/reference Markdown, preserves literal backslashes, and exits fullscreen if preview began outside fullscreen regardless of which preview control entered it. Link rows join PDF rows as clearly labeled unbound Pattern Lab placeholders rather than fake student references. Parser round-trip regressions, a desktop fullscreen-retry browser case, all 12 teacher desktop/mobile light/dark Pattern Lab cases, focused checks (49 files / 774 tests), and audit pass. Final integration review and ready-PR CI remain.

## 2026-09-25 — Platform administration design proposal

- Coordinator task `01a0d8f5-aa5b-7643-8357-40883f4193cc`, active persistent goal; branch `codex/platform-administration-design`, main base `74648fd8`. Proposed phased plan/threat model in `docs/guidance/platform-administration.md`; owner review pending before implementation.
- Source and independent session inventory confirm service-only plan206 foundation, 180-day base sessions, and missing privileged elevation/MFA contract. Recommend capability membership independent of classroom roles/plans, read-only inventory first, scoped transactional plan writes and separate production gates.
- Live Supabase connector returned USER_NOT_LOGGED_IN; production plan assignments, migration206 and strict setting remain unverified. No code, migrations, grants, plan changes, PR, merge or deployment performed. Next: owner review of phase sequence, session policy and first authorization slice.

## 2026-09-25 — Fictional platform-admin prototype

- User requested admin prototype screens. Added a development-only Pattern Lab route with fixed fictional inventory, account detail, activity and plan-preview screens. Confirm action remains disabled; no live account API or admin authority was added. Design brief and reuse decisions are recorded in `docs/guidance/platform-administration.md`.
- Browser-verified desktop/mobile and light/dark list/detail/preview/activity. Mobile inventory changed from horizontal table to cards with visible View actions; no page overflow or console errors. Focused checks pass (11 files, 93 tests, architecture, UI/design policy, TypeScript, lint).
- Design approval, real authorization and plan operations, production target verification, and all production enablement remain pending.

## 2026-09-25 — Admin prototype classroom shell revision

- User clarified the prototype should follow the regular classroom layout. Reused `AppShell`, `ThreePanelShell`, `LeftSidebar`, and `MainContent`; added fixture-only Overview, Accounts, Activity, and Plans sections in the classroom-style collapsible rail/mobile drawer. Account detail and disabled plan preview stay under Accounts. The prototype remains fictional and development-only.
- Extended the shared app-header sidebar trigger with an optional accessible label for admin navigation. Focused component coverage now checks section selection, mobile drawer closure, heading focus, and disabled confirmation. Playwright reviewed desktop/mobile, light/dark, expanded/collapsed rail, mobile drawer, and preview; no horizontal overflow or browser errors. UI brief and evidence are in `docs/guidance/platform-administration.md`. Teacher/student checks are n/a because no role session is involved. Risk profile: none. Model recommendation: GPT-6 Sol — scoped UI shell integration and review.
- Independent review found the shared sidebar cookie leaked a prototype-only collapse into real classroom preferences. The provider now supports non-persistent sidebar state for this fixture; component and browser checks confirm `pika_left_sidebar` stays unchanged.
- Final integration review found the unclassified account preview labeled a missing creation grant as zero. The preview now shows `—`; targeted component and browser checks cover the unknown value.

## 2026-09-25 — Read-only admin operations prototype

- Owner: codex/platform-administration-design, PR #1360. Product direction now assumes all tier and entitlement changes are automated. Replaced the prototype's Plans and plan-preview screens with Exceptions and exception detail, leaving tier as read-only account context; Overview, Accounts, and Activity now explain automated outcomes.
- Reused the classroom shell and governed UI controls. Fictional example.invalid fixtures only; no live reads or writes. Playwright reviewed desktop/mobile, light/dark, account and exception details, activity, and drawer. The mobile exception title now wraps, navigation resets scroll, and browser checks show no horizontal overflow or errors. Teacher/student roles are n/a for this session-free fixture. Risk profile: none. Model recommendation: GPT-6 Sol — scoped prototype and product-scope revision.
- The platform-administration proposal now describes a narrow read-only operations console. Live authorization, data scope, deployment, and any manual recovery action remain separate future decisions.
- Focused check passed 28 files / 248 tests plus architecture, UI/design, TypeScript and lint. Pika audit passed. The shared drawer passed an Escape/focus-return browser check; composite-widget checklist has no remaining prototype follow-up.
- Final independent integration review found the prototype theme button persisted a shared app preference. Removed the button so browsing this fixture cannot change the regular app's theme; light/dark verification uses isolated Playwright browser settings.
- A regression test confirms prototype navigation leaves the shared theme preference unchanged and exposes no theme control. Final focused check passed 28 files / 249 tests plus architecture, UI/design, TypeScript, and lint; audit passed. Removed five duplicated historical archive entries introduced by the trim after rebasing, retaining their earlier copies and the unique subsequent entry.

## 2026-09-25 — Subscription policy source of truth

- Owner: `codex/platform-administration-design`, PR #1360. Added `docs/guidance/subscription-policy.md` for automated tier assignment, verified payment/account mapping, immediate same-interval upgrade proration, unchanged renewal dates, clear quotes, and existing-class protection. Linked it from the AI router, decision log, access roadmap, plan foundation, and operations proposal.
- Explicitly separated agreed rules from proposed cancellation/grace/downgrade defaults and open provider, pricing, refund, grant-precedence, and AI-metering decisions. Billing is not implemented or activated by this documentation. Risk profile: none (documentation only). Model recommendation: GPT-6 Sol — bounded policy documentation.

## 2026-09-25 — Strict creation activation readiness

- User delegated final production checks and activation if gates pass. Subagent refreshed 182 classified accounts (180 Free, 1 Plus, 1 Pro), zero plan/grant/dual-audit mismatches, reviewed live database functions/triggers, and prepared guarded activation privately. Strict creation and automatic Free signup remain OFF; no hosted writes occurred.
- Parent verified production alias at app SHA `213b2787`, authenticated owner classroom/Daily attendance/Classwork/Gradebook read access, 69 focused tests, and local rollback-only plan database contracts. Production student join/submission and remaining synthetic/write-flow canaries need completion using a designated disposable classroom and student session; user clarification pending. Private evidence stays outside Git. Existing work and account assignments unchanged.

## 2026-09-26 — Disposable tier activation fixtures

- User authorized creating the production test classroom and Free student fixture. Created a clearly labeled disposable classroom through the authenticated owner UI and one isolated student record with an audited Free plan/zero creation limit. Private identities and execution records remain outside Git. No WorkOS identity, verified-email flag, or fabricated session was added.
- Subagent production rollback canaries passed creation/replay, Free/at-capacity Blueprint denial, restore, transfer, and downgrade preservation; independent before/after counts and row hashes prove no synthetic data persisted. Strict creation/automatic Free signup remain OFF. Actual student sign-in/join/submission require a user-controlled test mailbox for WorkOS verification; requested without passwords. No billing/admin enablement, migration, deploy, or real-class edits.

## 2026-09-26 — Strict creation and automatic Free signup activated

- Owner `codex/platform-administration-design`, PR #1360. Under the user's scoped activation authorization, the subagent executed the reviewed guarded production activation RPC once at 11:54:17 UTC. Migrations 181/206 verified; strict creation and default-Free provisioning now ON. Readback: 183 accounts (181 Free, one Plus, one Pro), complete plan/grant/paired-audit parity, original nine classrooms' ownership/archive states preserved. Identity-level records and exact operation evidence remain private outside Git.
- Normal user-controlled magic sign-in, Free student roster join, link/richtext submission, final grading and returned grade visibility passed in the disposable classroom. Teacher/student attendance views render expected non-class-day states; no fresh QR/check-in or attendance-write round trip claimed. After activation student returned work and teacher Gradebook remain accessible.
- Postactivation rollback-only synthetic account probe passed atomic Free provisioning, disabled quota0 creation, paired system audits, and missing-grant denial. Independent before/after counts, full class hash, plans/grants/audits and settings prove no synthetic probe records persisted. No migration, app deploy, billing/admin enablement, role rewrite or real-class teaching edit. Test fixtures remain available; no destructive cleanup performed.
- Updated current context, rollout status and administration proposal to distinguish active creation/default-Free behavior from unimplemented billing/admin. Synced latest main into the feature branch; resolved archive conflict by retaining existing unique history rather than reintroducing duplicated entries. Required documentation/prototype checks and stable-SHA review follow; no merge authorized.

## 2026-09-26 — Activation status-note CI correction

- PR #1360 CI passed the browser matrix but failed one of 8,088 tests because the compact production migration note no longer matched the established `Prod DB 001–NNN` format. Restored that format and removed a redundant undated health shorthand to retain the startup size limit. Runtime activation facts and application code are unchanged.
- Returned the PR to draft before correction. Verify the attendance rollout-note contract together with startup guidance and the focused gate, then independently review the fixed commit before requesting CI again. No production changes or merge performed. Risk profile: none; model recommendation: GPT-6 Sol for this documentation correction.

## 2026-09-26 — Stripe provider decision

- Owner selected Stripe for paid subscriptions. Added SUB-06 to the canonical subscription policy, recorded the decision, and removed provider selection from open decisions. Tier caps remain Free0/Basic2/Plus5/Pro10; paid prices and AI quantities remain undecided. This records provider selection only, without billing implementation or live charges.
- Corrected the plan-foundation status to point to the verified production strict/default-Free rollout. No runtime behavior changed. Risk profile: none; model recommendation: GPT-6 Sol for policy documentation. Validate focused checks and independent documentation review before marking the updated PR ready.

## 2026-09-26 — Versioned paid offerings policy

- Owner approved documenting future payment-model changes and existing-subscriber protection. Extended the existing canonical subscription policy with SUB-07/SUB-08: preserved offering versions before paid launch, exact purchase/entitlement binding, explicit grandfathering/renewal/optional migrations, annual paid-term protection, and audited idempotent transition/recovery. No universal grandfathering promise or new price, usage quantity or lifecycle default is assumed.
- Linked the decision and current fixed-writer limitation from the decision log and plan foundation. No implementation, account or production changes. Risk profile: none; model recommendation: GPT-6 Sol for bounded policy documentation. Focused verification and independent documentation review precede updated ready-PR CI.

## 2026-09-26 — Stripe test-mode foundation prepared

- Owner `codex/stripe-billing-foundation`, based on the unmerged admin/policy branch at `85138d24`; risk `runtime-platform`. Astra architecture review and two bounded Terra workers prepared immutable offering versions, trusted bindings, durable event intake, fenced payment synchronization and bounded reconciliation. Coordinator integrated local-only gates, provider decoding, transport adapters and handler boundaries.
- Migration 209 and rollback-only contracts are prepared but unapplied. Local dry run includes only 209. Test fixtures establish neither real Stripe connectivity nor deployed billing. No live or hosted changes; no HTTP route/runtime activation yet.
- Local unit/static checks pass; exact verification and remaining gates live in `docs/guidance/stripe-billing-foundation.md`. Awaiting explicit approval for `stripe@22.6.2` and one-time application of migration 209 to local. Next: SDK/runtime wiring, authorized local DB application, generated types and database proof, draft PR and independent fixed-SHA review.

## 2026-09-26 — Approved local Stripe integration verification

- Owner approved exact `stripe@22.6.2` and one-time local migration 209. Both completed; migration approval consumed. Generated database types match; Stripe and existing account-plan rollback harnesses pass, including forced partial failure rollback and lease takeover. Billing sandbox setting remains false. The older classroom harness correctly refuses the post-cutover local setting; CI runs it against fresh replay.
- Added real SDK signature verification and local-only webhook/operator-worker routes, with pinned API version, bounded requests and shared database origin/redirect checks. New database harnesses are wired into CI. Credentials are absent, so no real Stripe payment rehearsal or live activation is claimed.
- Proceeding with focused checks, draft publication and bounded independent fixed-SHA security/compatibility review. No merge or production authority implied.

## 2026-09-26 — Stripe billing review remediation prepared

- Draft PR #1366 is stacked on #1360. Initial fixed-SHA Sol/Terra review found financial-adjustment and retry-fairness blockers; architecture review found no separate blocker. Batched fixes verify immutable product/amount and exact unadjusted card payment, preserve signed event timestamps, and add migration210 for fair due selection, bounded transient retries, durable attention and audited operator requeue. Existing209 is unchanged and its local application permission is consumed.
- Focused checks pass342 tests plus TypeScript, lint and architecture/UI/design policies; Pika audit passes. Migration210 remains unapplied pending exact local authorization, including clearing unrecoverable legacy provider-created timestamps. Its rollback database contracts and regenerated types remain pending; no real Stripe round trip, live enablement or merge is claimed. Targeted correction review follows before the application checkpoint.

- Targeted Sol review found a missing nullable-schedule alteration, non-isolated retry fixtures, and early-event adoption compatibility. Batch2 fixes all three in unapplied210 and its harness, adding explicit claimed-state assertions and an early-event binding regression. No further schema application is authorized yet.

## 2026-09-26 — Consolidated billing209 and rebuilt local database

- User explicitly approved combining unreleased209/210, erasing/resetting local and reseeding. Consolidated the reviewed final functions and table definitions into209; removed210 and its upgrade-only backfill. Verified local target/history; one `supabase db reset --local --no-seed` replayed001–209 successfully. Reseeded via local runtime credentials with shared hosted env excluded. Local fixtures: three users and one classroom; billing sandbox off and no billing inbox records. Reset restores migration defaults, including local creation/Free-provisioning gates; production is unchanged.
- Generated types match the rebuilt schema. Billing recovery/payment, account-plan and classroom-creation rollback harnesses pass. Corrected SQL harness evaluation ordering by capturing the mutation result before inspecting persisted state. Focused checks pass342 tests plus TypeScript/lint/policy checks; final integration review and CI remain pending. Earlier209/reset authorization is consumed. No live Stripe payment rehearsal, production change or merge.

## 2026-09-26 — Billing binding/webhook race correction

- Owner approved one extra correction batch and targeted review after the review-budget checkpoint. Added the same transaction advisory lock before subscription identity lookup in bind and record RPCs, and locked an existing binding before adopting its inbox events. Consolidated209 remains the unreleased schema source.
- Added a deterministic multi-session regression for CI's disposable database. No local schema mutation/reset was attempted; the reseeded local database still has the prior209 function bodies. Generated type shapes are unchanged. Focused checks pass343 tests plus type/lint/policy gates; shell syntax and refusal outside CI pass. Targeted Sol review follows before stable-head CI; no live billing or merge authorized.

## 2026-09-26 — Approved subscription launch policy

- This task owns `codex/subscription-launch-policy`, stacked on the unchanged
  Stripe foundation head 9b710884. Recorded final USD/CAD prices, Pro 12, 30-day
  Plus trial, downgrade activity-based archiving and agreed lifecycle/AI rules.
  Updated the access roadmap and durable decisions; distinguished approved
  product terms from provisional AI costs and missing runtime implementation.
- Documentation-only risk profile: none. No database, Stripe account, production
  runtime or existing subscription changed. Next implementation milestone is an
  isolated Stripe test checkout plus lifecycle/access verification.

## 2026-09-26 — Rename launch plans to Basic, Pro and Max

- Owner renamed Plus to Pro and the former Pro to Max. Updated canonical policy,
  launch limits, trial/AI labels and decision log while retaining prices/benefits.
  Documented legacy `plus` → Pro and `pro` → Max to avoid accidental entitlement
  reassignment. Historical runtime/schema keys remain unchanged.
- Continued policy PR1367; documentation-only verification and independent review
  cover the cumulative approved-policy change. No runtime or live billing change.
