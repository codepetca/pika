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

## 2026-09-19 — Dormant contextual learner assignment-open route

- Owner `codex/contextual-assignment-route`, based on merged transactional-open PR1294. Added an independent, off-by-default exact user/assignment gate to `GET /api/assignment-docs/[id]`. A matched teacher- or student-valued active member opens only their own document through migration182; the transaction remains the membership/visibility authority and a foreign `student_id` teacher projection is rejected.
- Contextual mode binds RPC assignment/document evidence plus feedback, requirements, artifacts and optional GitHub identity before returning, sanitizes the member document and preserves immediate Pal delivery after a transaction-created document. Disabled and unmatched requests retain the legacy route. Autosave, submission and artifact mutations remain legacy, so no cohort may be activated yet. No UI, migration, production configuration or database state changed in this slice.
- Initial security review found strict requirement/artifact loaders still normalized missing-schema errors to empty evidence, and downstream evidence failure could skip immediate Pal delivery after the transaction committed creation. Batch1 makes missing schema fail closed only in strict mode while preserving legacy compatibility, and moves immediate delivery directly after the successful create result with global- and classroom-Pal failure-path regressions. Targeted re-review follows.

## 2026-09-19 — Dormant contextual learner assignment save

- Owner `codex/contextual-assignment-save`, based on merged assignment-open route PR1295. Migration184 adds a service-only transaction that rechecks live assignment/classroom state and exact enrollment under membership-removal fences before delegating revision, idempotency, history and metric behavior to the established atomic save.
- Added an independent off-by-default exact user/assignment PATCH gate. A matched teacher- or student-valued active member saves only their own document; bounded preflight and RPC evidence are strictly rebound to the authenticated actor and assignment. Disabled and unmatched requests retain the legacy student-only route, and missing schema never falls back after admission.
- With exact local authorization, migration184 SHA256 `5a761230159d7ad1b795426eac2b290d58e75da508124bb389e4a90a080edc5d` applied locally. Rollback-only behavior and multi-connection removal/archive/draft/save/duplicate-save contracts pass, generated types match local history001–184, and the GET/PATCH gates remain off. Submission, unsubmit, history/restore and artifact mutations remain legacy, so no cohort may be activated.
- Initial security review found that migration184 could hold classroom/member fences while an existing submit, unsubmit, restore or legacy save held its document fence, making ordinary overlap deadlock or surface raw contention. Batch1 adds migration185's fixed submission→editor-save→classroom/member ordering, maps guarded assignment/classroom contention to safe 409 retry responses, and expands real two-connection coverage to both save/submit and contextual/legacy-save orderings, unsubmit-first, and save-first draft/archive retries. With exact local authorization, migration185 SHA256 `833b009433c95d288bccb241b6a360234186b6b5ae143be717950e67a3febd88` applied locally; all 12 race cases pass and randomized fixtures are removed.

## 2026-09-20 — Dormant contextual learner assignment submit/unsubmit

- Owner `codex/contextual-assignment-submit`, based on merged assignment-save PR1297. Migration186 adds service-only submit and unsubmit transactions that recheck live assignment/classroom state and exact enrollment under the established submission→editor→classroom/member lock order before delegating to the legacy atomic operations.
- Added one independent off-by-default exact user/assignment gate shared by the submit and unsubmit routes. Matched teacher- or student-valued active members mutate only their own document; strict adapter and preflight evidence binding fail closed without legacy fallback. Disabled and unmatched requests retain the legacy student-only path.
- With exact local-only authorization, migration186 SHA256 `a06d0915a0df1930ef35e3acf459e271f93d6a7d579d52b23afe48cb5047959f` applied after local history001–185. Warning-level schema lint, generated-type parity, rollback-only behavior checks and all 18 removal/save/submit/unsubmit concurrency contracts pass; randomized fixtures are removed. Production remains001–180 and every contextual assignment gate remains off. History/restore and artifact mutations still block cohort activation.
- PR1298 initial Sol/Terra review found attachment-race errors collapsed to503, service-role preflight evidence returned before membership authorization, and a post-transaction authenticity write outside the member boundary. Remediation batch1 preserves both attachment outcomes, moves all contextual preflight evidence into migration187's service-only locked transaction, and removes the contextual authenticity write. Under the user's standing local-migration authorization, migration187 SHA256 `5f84d7f11c37807b525dda31e8015906accdcc1a93490322d023c4aa7c3d636d` applied locally; local history001–187, removed-member denial, type parity, lint, both rollback harnesses and all18 concurrency cases pass. Targeted re-review follows; production/gates remain unchanged.

## 2026-09-20 — Dormant contextual assignment history/restore

- Owner `codex/contextual-assignment-history`, based on merged submit/unsubmit PR1298. Migration188 adds service-only role-neutral owner/member history reads and exact member restore. Both boundaries take submission/editor fences before classroom/member locks; restore independently rechecks live visibility, current enrollment, document revision and exact history ownership before delegating to the established atomic save.
- Added one independent off-by-default exact user/assignment gate shared by history and restore. Matched owners can read one current enrollee's existing history; matched teacher- or student-valued members can read and restore only their own live-assignment history. Disabled and unmatched requests retain legacy auth/role behavior. Artifact mutations remain legacy, so every contextual assignment gate stays off.
- Under standing local-migration authorization, migration188 SHA256 `4b08bfdcb80a8e655355ad16afe9e01bbedfd62de15bd24635ab8c663e170b9f` applied locally. Local history001–188, generated types, warning-level DB lint, rollback behavior, all22 save/submit/restore races,55 targeted tests,238 focused tests, architecture/UI/design/type/lint checks and Pika audit pass. Production remains001–180; no cohort, deployment or production migration changed.
- PR1299 initial Terra compatibility review was clean. Sol security review found restore accepted caller content after checking only target ownership. Remediation migration189 (`ba7ffe7e44d39ccb3be6e7abef14e8805a3aa6de04ff3c07bbe49a6d2d99c2f7`) reconstructs the locked snapshot/patch chain in PostgreSQL, rejects mismatched content atomically, and derives restore snapshot/counts from the selected row. Under standing local authorization it is applied through local history001–189; clean DB lint,239 focused tests, the tamper rollback contract and all22 patch-target removal/save races pass. Production and gates remain unchanged; targeted and final reviews follow.
- Sol targeted review signed off remediation head `ca4de8f8`; Terra final integration also signed off, with one non-blocking operability gap: the shared concurrency harness required188 but not189. Batch2 adds the exact migration189 preflight plus regression; all22 races,239 focused tests and audit pass. Final bounded re-review follows; production/gates remain unchanged.

## 2026-09-20 — Dormant contextual assignment artifacts

- Owner `codex/contextual-assignment-artifacts`, based on merged history/restore PR1299. Migration190 adds service-only prepare, upsert and delete boundaries for one active member's exact assignment requirement/document/artifact. All mutations share submission→editor→classroom/member ordering, recheck live visibility and current enrollment, reject submitted documents, bind managed images to database-derived classroom/subject/document ownership, and save optional GitHub identity in the same actor-bound transaction.
- Added one independent off-by-default exact user/assignment gate to link/repository attachment, image upload/attachment and artifact deletion. Matched teacher- or student-valued members use the contextual RPCs; disabled and unmatched requests retain the legacy student-only path. Post-upload authorization failure queues managed bytes for cleanup rather than attaching them.
- Under standing local-migration authorization, migration190 applied locally after a clean dry run. Local history001–190, warning-level DB lint, generated types, rollback-only artifact behavior and all26 shared save/submit/restore/artifact concurrency cases pass; synthetic fixtures roll back or are removed. Production remains001–180 and every contextual assignment gate remains off. Focused verification and independent review follow.

## 2026-09-20 — Dormant contextual Assignment owner mutations

- Owner `codex/contextual-assignment-owner-mutations`, based on merged artifact PR1300. Migration191 adds service-only actor-bound edit, release, delete and pristine-draft-discard boundaries for an existing Assignment. The shared helper acquires assignment-submission then Classroom-operation fences, locks both authorization parents, and rechecks exact current owner, binding and archive state transactionally.
- Added one independent off-by-default exact user/assignment gate across the four existing owner routes. Matched teacher- or student-valued owners use migration191; disabled and unmatched requests preserve the legacy teacher-only path. Creation, bulk/reorder, grading, return, UI and rollout activation remain out of scope.
- Under standing local-migration authorization, migration191 applied locally after correcting a failed, rolled-back composite-row definition. Generated types match local history001–191. The rollback behavior contract and ownership-transfer/archive two-connection races pass; production remains001–180 and all contextual gates remain off. Focused verification and independent review follow.

## 2026-09-20 — Dormant contextual Assignment creation

- Owner `codex/contextual-assignment-creation`, based on merged owner-mutation PR1301. Migration192 adds one service-only actor-bound transaction that rechecks exact current Classroom ownership and archive state, allocates a mixed-classwork position, and inserts an Assignment plus initial requirements atomically.
- Added an independent off-by-default exact user/Classroom gate to Assignment POST. Matched teacher- or student-valued owners use migration192; disabled and unmatched requests preserve the legacy teacher-only path, including authentication before request validation. Bulk/reorder, grading, return, UI and activation remain out of scope.
- Under standing local-migration authorization, migration192 applied after a clean dry run. Generated types match local history001–192; warning-level DB lint, rollback behavior and ownership-transfer/two-creation concurrency contracts pass. Production remains001–180 and every contextual gate remains off. Focused verification and independent review follow.
- Initial compatibility review found strict request validation changed dormant legacy teacher behavior and contextual creation could race legacy material/survey writers for a mixed-classwork position. Batch1 confines strict validation to exact-pair contextual requests, restores legacy parsing/messages, and records a tested hard activation blocker until every mixed-classwork writer shares the position fence.

## 2026-09-20 — Shared contextual classwork creation fence

- Owner `codex/contextual-classwork-position-fence`, based on merged Assignment creation PR1303. Migration193 moves Assignment, material and survey creation behind one private position allocator and the existing Classroom-operation fence. It rechecks exact current ownership and active state transactionally, and exposes service-only actor-bound material/survey creation RPCs while replacing the migration192 Assignment creator with the shared allocator.
- Replaced the Assignment-only exact user/Classroom gate with one off-by-default classwork creation gate across all three POST routes. Exact teacher- or student-valued current owners use strict schemas and contextual transactions; disabled and unmatched requests preserve each legacy teacher-only path. The former mixed-writer activation blocker is resolved, but bulk/reorder, grading, return, survey reads/edits and the wider owner experience remain incomplete, so no cohort may be activated.
- Under standing local-migration authorization, migration193 applied locally after a clean dry run. Generated types match local history001–193; warning-level DB lint, rollback behavior, and material→survey plus survey→Assignment multi-session races pass with distinct sequential positions. Production remains001–180 and all contextual gates remain off. Focused verification and independent review follow.
- PR1304 initial security review signed off exact head `78692b4a`. Compatibility review found one non-blocking guide error claiming every classwork identity was allocated before locking; remediation batch1 now distinguishes Assignment pre-allocation from material/survey insert-time IDs. No functional, compatibility or CI-wiring blocker was found; targeted and final cumulative review follow.

## 2026-09-20 — Dormant contextual manual Assignment grading

- Owner `codex/contextual-owner-next-slice`, based on merged classwork-creation PR1304. Migration194 adds a service-only manual-grading wrapper that takes the established grading fence, then the Classroom-operation fence, locks Assignment/Classroom parents, rechecks stable binding, exact current ownership and active lifecycle, and delegates to the existing atomic grade save in the same transaction.
- Added one independent off-by-default exact user/Assignment gate shared by the single-student and selected-students grade routes. Matched teacher- or student-valued current owners use migration194 with exact returned Assignment/student binding; disabled and unmatched requests preserve the legacy teacher-only path. Feedback return, AI grading/repository review, bulk/reorder, UI and activation remain out of scope.
- Under standing local-migration authorization, migration194 applied locally after a ledger/dry-run showing only194. Generated types and warning-level DB lint are clean; rollback behavior and archive-first/grade-first multi-connection contracts pass. Production remains001–180 and all contextual gates remain off. Focused verification and independent review follow.
- PR1305 initial compatibility review signed off exact head `ba617df6`. Security review found a reverse-order deadlock with individual-student purge and an overbroad `55000` archive mapping. Remediation migration195 acquires each target learner's purge subject/pair fences nonblocking after Classroom admission, making a started purge return deterministic retry instead of deadlocking; the server now reserves403 for the exact archive sentinel and maps other lifecycle contention to409. A real purge-subject/grade race joins the archive races; targeted and final cumulative review follow.

## 2026-09-20 — Dormant contextual Assignment feedback return

- Owner `codex/contextual-assignment-feedback-return`, based on merged manual-grading PR1305. Migration196 adds service-only actor-bound wrappers for one feedback-only return and one selected-student full return. Both take the established Assignment return fence, then the Classroom-operation and target learner purge fences, lock authorization parents, recheck stable binding, exact current ownership and active lifecycle, and delegate to the established atomic return operations in the same transaction.
- Added one independent off-by-default exact user/Assignment gate shared by both return routes. Matched teacher- or student-valued current owners use migration196 with strict returned document, feedback-entry, actor and batch-partition binding; disabled and unmatched requests preserve the legacy teacher-only path. AI grading/repository review, bulk/reorder, UI and activation remain out of scope.
- Under standing local-migration authorization, migration196 is applied locally. Generated types match local history001–196; error-level DB lint, rollback behavior and purge-first/archive-first/return-first multi-connection contracts pass. Production remains001–180 and every contextual gate remains off. Focused verification and independent review follow.
- PR1307 initial compatibility review signed off exact head `02b384ca`. Security review found uppercase learner UUIDs could commit then fail response binding, feedback entry/document bodies were not cross-checked, and duplicate created-student evidence could satisfy the batch counts. Remediation batch1 canonicalizes request UUIDs before deduplication/RPC and requires exact feedback-body and created-subpartition evidence, with route and adapter regressions; targeted security re-review follows.
- Security targeted review signed off batch1 head `ee8bc935`. Final compatibility review found shared-parser UUID canonicalization changed disabled/unmatched legacy behavior for case-variant UUIDs. Batch2 restores byte-for-byte legacy parsing and canonicalizes/deduplicates only inside the contextual adapters, with disabled, unmatched-teacher and exact-contextual route coverage; final re-review follows.

## 2026-09-20 — Dormant contextual classwork reorder

- Owner `codex/contextual-classwork-reorder`, based on merged feedback-return PR1307. Migration197 adds service-only actor-bound wrappers for Assignment-only and mixed Assignment/material/survey ordering. Both take the shared Classroom-operation fence, lock the current Classroom, recheck exact ownership and active lifecycle, delegate to the established migration068 ordering functions, and return actor/Classroom binding evidence.
- Added one independent off-by-default exact user/Classroom gate shared by both reorder routes. Matched teacher- or student-valued current owners use migration197; disabled and unmatched requests preserve the legacy teacher-only path. Bulk Assignment operations, AI grading, repository review, UI and activation remain out of scope.
- Under standing local-migration authorization, migration197 applied after a clean dry run showing only197. Generated types match local history001–197; rollback behavior and archive-first/reorder-first/creation-first multi-connection contracts pass. Production remains001–180 and every contextual gate remains off. Focused verification and independent review follow.

## 2026-09-20 — Dormant contextual Assignment bulk editing

- Owner `codex/contextual-assignment-bulk`, based on merged classwork-reorder PR1308. Migration198 adds one service-only actor-bound transaction for the markdown Assignment bulk editor. It takes canonically ordered Assignment submission fences before the shared Classroom-operation fence, locks and rebinds every parent, validates the complete batch, preserves material/survey slots, and commits creates, updates, releases and positions atomically.
- Added an independent off-by-default exact user/Classroom gate. Matched teacher- or student-valued current owners use migration198; disabled and unmatched requests preserve the legacy teacher-only path. AI grading, repository review, UI and activation remain out of scope.
- Under standing local-migration authorization, migration198 applied after the dry run showed only198. Generated types match local history001–198; rollback behavior and archive-first/bulk-first/overlapping reversed-order multi-connection contracts pass. Production remains001–180 and every contextual gate remains off. Focused verification and independent review follow.
- Initial security review found request-supplied foreign Assignment IDs could acquire another tenant's advisory/row locks before the missing-ID result. Compatibility review also found malformed timestamps surfaced as503. Remediation migration199 moves the original implementation private, preflights scope before supplied locks, rechecks and locks only rows still bound to the Classroom, and revokes direct service-role execution; the adapter maps PostgreSQL22007 to400. Cross-Classroom contention and malformed-date rollback regressions join the harnesses; targeted re-review follows.

## 2026-09-20 — Dormant contextual Assignment repository-target selection

- Owner `codex/contextual-assignment-repo-target`, based on merged Assignment bulk PR1309. Migration200 adds a service-only owner-bound save/reset transaction for one enrolled learner's repository target under Assignment, Classroom-operation and learner-purge fences.
- Added an independent off-by-default exact user/Assignment gate. Matched teacher- or student-valued current owners retain the existing read-only preflight before external GitHub validation, then recheck ownership, lifecycle and enrollment transactionally; disabled and unmatched requests preserve the legacy teacher-only path. Repository analysis, AI grading, UI and activation remain out of scope.
- Under standing local-migration authorization, migration200 is applied locally. Generated types match local history001–200; error-level DB lint, rollback behavior and purge/archive multi-connection contracts pass. Production remains001–180 and all twelve contextual Assignment gates remain off. Focused verification and independent review follow.

## 2026-09-20 — Preserve grading comment focus during autosave

- Owner `codex/grading-comment-focus-main`, based on `origin/main@cbb80e93`. The assignment grading comment textarea now remains enabled while its background grade autosave is in flight, so the browser keeps keyboard focus; comment sending and conflicting grade actions remain disabled until the save completes.
- Added a regression that holds the grade request open and proves the editor remains enabled and focused while Send comment is disabled. Targeted 30 tests and the focused application-browser gate (14 files/225 tests plus architecture, UI/design policy, TypeScript and lint) pass.
- Playwright verified the live teacher grading editor retains focus after autosave on desktop/mobile in light/dark themes; the student baseline is unaffected. Composite checklist reviewed: native textbox keyboard behavior and tested focus/disabled semantics pass, no manual follow-up. Risk profile: none. Model recommendation: GPT-6 — bounded focus-state bug with browser verification.

## 2026-09-21 — Dormant metered paid-operation reservations

- Product decision: AI grading and repository review are metered paid owner tools; joining a Classroom and completing assigned student work remain free. Prices, plan allowances, billing periods, trials and grace behavior are still deferred.
- Migration201 adds a service-only `grading.ai` reservation ledger with assignment-grading, Test-grading and repository-review operation kinds. Reserve, settle and release are idempotent, bind one effective-entitlement revision, expire pending work, and serialize concurrent quota checks without holding locks across provider calls.
- Under standing local-migration authorization, migration201 is applied locally. Generated types, error-level DB lint, rollback behavior and the concurrent quota race pass. No route uses the ledger, no grant or billing state changed, and production remains001–180.

## 2026-09-21 — Preserve assignment work around unfinished image uploads

- Owner `codex/fix-assignment-viewer-upload-placeholder`, based on `origin/main@3424be87`. Read-only Tiptap surfaces now register a noninteractive `imageUpload` compatibility node, preventing an autosaved unfinished upload from invalidating and blanking the rest of a student's document.
- The compatibility node renders a semantic note, “Image upload was not completed,” while preserving all surrounding work. Pattern Lab now carries the persisted-node case in both teacher and student history previews.
- Regression coverage proves text before and after the placeholder remains visible, read-only editors expose no uploader or image paste/drop side effects, editable editors retain upload behavior, and a live editable editor rebuilds with the inert node when entering history preview. A separate renderability predicate lets teacher panels and modals show current or historical image/upload-only work without changing text counts or submission semantics; the compatibility node also supplies an explicit plain-text serialization. Targeted tests, TypeScript, lint, Pika audit and the focused full gate (161 files/2110 tests plus architecture and UI/design policy) pass. Playwright verified teacher/student desktop/mobile light mode and teacher desktop dark mode, including the exact read-only editor configuration with uploads enabled. Composite checklist reviewed: the read-only node is noninteractive, semantic state is covered by role-based testing, keyboard behavior is not applicable, and no manual follow-up remains. Risk profile: none. Model recommendation: GPT-5 — small compatibility fix with UI verification.

## 2026-09-21 — Hide unreturned grading status from students

- Added a student-specific Assignment status projection that ignores internal `graded_at` state until work is returned. Student Classwork now retains its submission status before return and shows `Returned` only after the existing return boundary; teacher-facing `Graded` behavior is unchanged.
- Added utility, API, and integration coverage. Focused checks pass with 76 files and 1,017 tests plus architecture, UI/design policy, TypeScript and lint. Visual verification covered the student Classwork summary at desktop/mobile in light/dark, including the exact unreturned-graded fixture; teacher reference captures showed no surface change.

## 2026-09-21 — Prevent incomplete student image uploads

- Owner `codex/prevent-incomplete-image-uploads`, based on merged PR1313. The Assignment editor now opens the native picker before changing content, keeps progress/failure state outside Tiptap JSON, and inserts only completed managed images. Canceling leaves the response unchanged; failures expose Retry/Remove; paste/drop use the same transient path.
- Student submission is disabled and guarded imperatively while an image is uploading or awaiting recovery. Legacy saved `imageUpload` nodes remain readable through the inert compatibility note and can no longer be created by the toolbar/shortcut.
- Focused gate passes 45 files/699 tests plus architecture, UI/design policy, TypeScript and lint. Playwright verified default, uploading and failure recovery on student desktop/mobile in light/dark; teacher is n/a because this follow-up changes only editable student state. Composite checklist passed with a labeled native picker, polite live progress, alert recovery and keyboard-reachable actions. Risk profile: none. Model recommendation: GPT-5 — bounded editor state transition with autosave and submit coordination.
- Initial independent review found two non-blocking recovery gaps: paste/drop could replace a visible failed upload without an explicit student choice, and a finalized image could be orphaned if the editor became read-only before insertion. Remediation batch 1 preserves the failed item until Retry/Remove and requests reference-safe managed-storage cleanup for finalized-but-uninserted images; focused regressions and API coverage pass.
- Targeted review found a blocking commit-to-passive-effect race where read-only or document-identity changes could occur just before upload completion. Remediation batch 2 makes completion validate render-current editability and document identity synchronously, with layout-phase unmount invalidation and both transition regressions.

## 2026-09-21 — Classroom Grades page patterns

- Owner `codex/classroom-grades-patterns`, based on `origin/main@ed6e6ca1`. Pattern Lab now places a default-off “Show grades to students” switch at the top of the teacher Gradebook page pattern and adds a student Classroom Grades tab showing a returned-work-only 84% fixture with counted and excluded examples.
- The paired Student Grades visibility pattern reuses the same teacher control and student card, while retaining the standalone returned-marks comparison. These development-only fixtures do not alter production navigation, persistence, authorization, or grade APIs.
- Focused verification passes with 15 files and 147 tests plus architecture, UI/design policy, TypeScript and lint. Visual verification covered teacher and student desktop/mobile in light/dark, both teacher switch states, the enabled student Grades view, and zero horizontal page overflow. Risk profile: none.

## 2026-09-22 — Test grading repaired and calibrated against archived work

Goal was to improve AI grading of open-response test questions the way assignment grading
was improved in `b0557ac3`. Reaching that goal required fixing three defects the DeepSeek
migration left on the test path; the assignment path had been migrated thoroughly and the
test path had not.

Shipped: PR1316 raised test output budgets from 220/420 (and 600/900 batch) to 6000/8000.
DeepSeek counts reasoning against `max_tokens` and effort had been raised to `medium`
(provider tier `high`), so every open-response test grade truncated twice and threw —
broken in production, reachable from the teacher AI-suggest route, not only from tooling.
Values measured, not guessed: 12 real responses spent 71-4509 output tokens. PR1312 fixed
the gold-set harness, which gated on `OPENAI_API_KEY` and ran bare `tsx` with no
`--env-file`. PR1319 added transcription-tolerance guidance to both prompt profiles; policy
to v3, both prompt versions to v2.

PR1319 came from adjudicating real archived work with the teacher, not from inspection.
Codex exported two archived classrooms (684 teacher-scored responses, all coding,
de-identified via `sanitizeAiText`; retained as JSONB in
`classroom_retired_assessment_records`, no timed purge). A new `pnpm calibrate:test-grading`
samples balanced across classroom and point scale and ranks disagreements for human
adjudication, explicitly treating recorded marks as a second opinion rather than ground
truth — the teacher had stated their own marking may contain errors, and that proved
correct in both directions. Eight cases adjudicated. Finding: the grader reads concepts
accurately (it caught backwards inheritance and an integer-division bug) but over-penalised
transcription, costing a submission that matched the sample solution 3 of 10 marks for a
stray period and a missing parenthesis. The defect was inconsistent application of its own
leniency rule, not harshness. Post-fix run on the same seed: target cell improved from
-0.254 to -0.185, agreement 1/13 to 4/13.

Open and unresolved. The rule was validated on the same 80 responses it was derived from,
so generalisation is untested; a different seed on unseen work is the honest check. Only
1 of 13 nine-point cases was adjudicated, so that cell's apparent regression is read as a
yardstick artifact rather than demonstrated. PR1321 (request timeout 25s to 60s) is
deliberately draft until a full run is observed completing at the shipped value; the
evidence so far came from a temporary local override, and the timeout only began biting
because PR1316 let grading think longer. Branch `claude/test-grading-calibrator` holds the
calibrator, token/effort tracking and provenance stamping, unpushed with no PR; it carries
a production change (optional `reasoningEffort` override, production default unchanged) and
wants real review. Assignment and repo-review paths still carry the same 25s timeout,
untouched for lack of evidence. DeepSeek retention remains account-level only, confirmed
against `docs/guidance/ai-grading-egress.md` but not settled with the owner.

Process note: this session worked in the hub checkout rather than a feature worktree, and
opened its first two PRs ready instead of draft, which PR Gate correctly rejected. Both
violate `.ai/START-HERE.md`. Risk profile: async-grading.

## 2026-09-22 — Assignment AI grading lease-fencing prerequisite

- Owner `codex/meter-ai-grading`, based on merged metered-reservation PR1318. Migration202 adds a versioned worker contract plus service-only run/item patch and provenance-finalization boundaries. Existing and rolling-deploy runs remain legacy version0; future metered runs opt into version1, requiring the exact current, unexpired lease across DeepSeek and Gradex work while legacy finalizers/direct service-role updates are rejected.
- Under standing local-migration authorization, migration202 is applied locally. Generated types match local history001–202; the real takeover harness proves expired/stale run and item patches, stale finalization, legacy finalization and direct service-role DML cannot bypass a version1 replacement lease. This slice does not create version1 runs, call the usage ledger or activate metering; production remains001–180.

## 2026-09-22 — Accept required Assignment links without GitHub identity

- Standard link requirements now send only their URL instead of an irrelevant blank GitHub login; repository-link requirements retain the existing GitHub fields.
- The Assignment artifact request boundary normalizes a blank optional GitHub login to absent for compatibility with older clients. Component and API regressions cover both paths; the focused gate passes 60 files/664 tests plus architecture, UI/design policy, TypeScript and lint. Risk profile: none.
- Pattern Lab visual verification covers the student attachment checklist on desktop/mobile in light/dark; the existing layout and states are unchanged. Teacher is n/a because no teacher surface or data contract changed.
- Composite-widget checklist reviewed: no roles, keyboard behavior, focus handling or semantic state changed; remaining manual follow-up: none. Model recommendation: GPT-5 — bounded submission validation fix.

## 2026-09-22 — Dormant Assignment AI usage accounting

- Owner `codex/meter-assignment-ai-usage`, based on merged lease-fencing PR1323. Migration203 adds a service-only Assignment admission/finalization boundary: a version1 run reserves one shared `grading.ai` unit per queued student item, skipped missing/empty items reserve zero, successful grade/provenance finalization settles atomically, and terminal item/run failure releases atomically. Retry admission is idempotent and every operation revalidates the exact current lease and Assignment/Classroom/student/document binding.
- Migration203 also hardens shared quota accounting to refresh time after blocking locks and count reserved/settled usage across entitlement revisions, preventing metadata revisions from minting capacity. Expired Assignment operations fail closed and require a fresh run/item after terminal release.
- Under standing local-migration authorization, migration203 is applied locally. Generated types match local history001–203; warning-level DB lint is clean and the real database harness proves per-item reservation, replay safety, archive and malformed-count rejection, zero-cost skipped completion, atomic settlement rollback, terminal release, cross-revision quota enforcement, failed-admission rollback and the unchanged unmetered version0 path. No application route calls the new boundary, no grant or billing state changed, and production remains001–180.

## 2026-09-22 — Default-off Assignment metering application integration

- Owner `codex/assignment-ai-metering-integration`; risk profiles async-grading and workspace-state. Exact-true server flag admits all Assignment requests through version1 while flag-off single DeepSeek and new version0 runs retain legacy behavior. Persisted version1 controls per-item DeepSeek/Gradex admission, atomic settlement, retry retention, skip release and terminal release after flag rollback; quota/unavailable responses remain content-free.
- The rendered classroom AI Grade action continues to hand accepted durable runs to the existing `TeacherClassroomView` polling flow; the unused assignment-local controller remains unchanged. Reused all current busy, feedback and error owners; no new visual components or Pattern Lab contracts. Joining/student work and entitlement/plan state are unchanged; no flags enabled.
- `pnpm check:focused -- --base origin/main` passed 442 tests/31 files plus architecture, UI/design policy, TypeScript and lint; pre-commit audit is clean. Browser evidence uses the seeded local classroom and simulated AI responses (no provider work): teacher desktop/mobile, light/dark, default/loading/completion/quota/unavailable; student shared-route regression. Captures are local under `output/playwright/assignment-ai-metering/`.
- Independent DB review confirmed the expiry cleanup edge. Forward migration204 (201/203 unchanged), authorized/applied locally, preserves already-expired Assignment release evidence during terminal cleanup, renews only live lease-fenced reservations for 24 hours, and adds `internal_failure` cleanup classification. Real DB expiry/renewal/conflict/privilege cases, warning lint and generated-type check pass; dedicated concurrent expiry-vs-renewal stress remains a follow-up to the deterministic serialized harness. Model recommendation: GPT-6 — durable provider lifecycle and transactional accounting boundaries. Epic remains open and rollout disabled.
- Draft-review remediation keeps migration204 default-off while adding an exact service-only capability sentinel, complete per-item source fingerprints (Assignment, document, structured artifacts and workflow history), Assignment-only `internal_failure`, and lease-fenced durable Gradex run/item correlation. Admission and settlement now reject artifact deletion/replacement races; Gradex polling admits and fetches only live local items, survives pseudonym-salt rotation, and waits for all sibling terminal persistence before surfacing a failure. Validation used a disposable full migration replay because the earlier M204 shape was already applied to the normal local database; no local data was reset.

## 2026-09-22 — Daily Log attendance-save reliability

- Student Today now sends the first nonblank Daily Log immediately, retains per-student/classroom/Toronto-date device drafts, retries an unsent prior-day draft under its original date, and offers an explicit conflict choice when a saved log already exists. No separate check-in action was added; later edits retain throttled autosave, and page exit makes a best-effort save without treating it as confirmed.
- Client saves are serialized; the PATCH route accepts duplicate content idempotently, rejects a missing or stale entry identity, and uses version-conditional updates to prevent stale overwrites. Log-derived attendance remains tied to the entry's class date; QR attendance is unchanged. No migration or production database change.
- Focused checks pass 244 tests/16 files plus architecture, UI/design policy, TypeScript and lint; pre-commit audit passes. Student recovery reviewed on desktop/mobile light/dark and teacher Daily on desktop/mobile dark. Composite-widget checklist reviewed: existing buttons retain keyboard behavior, status and conflicts have textual labels, and component tests assert accessible status/actions; no manual follow-up identified. PR review pending.
- Independent review remediation: remove unscoped legacy session draft restore, clear pending saves after Reload latest, preserve blank edits to an existing log, keep old-day recovery from delaying today's save, and carry first post-midnight typing into a new-date draft rather than dropping it. Empty old-day drafts with no known entry are skipped; attendance itself already requires nonblank text. Focused checks now pass 249 tests/16 files plus the same policy/type/lint gates. Targeted re-review pending.
- Targeted review found a same-date classroom-switch queue collision and a lost-response/blank-clear recovery gap. Second batch binds queued saves to student/classroom/date and rereads that exact draft after switching, while blank older drafts first reconcile against server state before clearing or discarding. Regression tests cover both; focused checks pass 251 tests/16 files plus architecture, UI/design policy, TypeScript and lint. Final integration review pending.
- Final integration review found no blocker but identified storage-unavailable loss on stale-tab date rollover. Third batch retains the new-date keystroke in scoped memory when device storage rejects it, keeps the warning visible, and schedules a server save after the new-date load even if loading state was batched. Storage-failure regression added; focused checks pass 252 tests/16 files plus all policy/type/lint gates. Exact-head re-review and CI pending.
- User-approved fourth review batch addresses the remaining P1: later edits now supersede or clear the rollover-only memory draft, so a load cannot prefer first-typed A over newer durable AB. A deferred-first-save/reload regression covers the exact sequence. Focused checks pass 253 tests/16 files plus architecture, UI/design policy, TypeScript and lint; pre-commit audit passes. Current student Today and teacher Daily Playwright captures loaded and inspected at mobile/desktop; prior light/dark recovery-state captures remain valid because no visual treatment changed. Exact-head targeted review and CI pending.
- Cumulative review found a storage-failure rollover conflict gap: an in-memory draft could auto-save over a new-day log from another device. Fifth batch treats in-memory and durable drafts equally for conflict detection and waits for the fresh entry read before auto-saving a cached restore. A blocked-storage/existing-log regression confirms visible conflict and no PATCH. Focused checks pass 254 tests/16 files plus policy/type/lint gates; pre-commit audit passes. Final exact-head review and CI pending.

## 2026-09-22 — Production student Grades

- Owner `codex/student-grades-production`, based on merged Classroom Grades patterns. Added a default-off `student_grades` classroom preference, a teacher Gradebook visibility switch, and a student Classroom Grades tab backed by a private no-store server projection.
- The student projection includes only fully graded, returned work from currently visible Classwork/Test sources, honors per-assessment overrides, keeps excluded or non-contributing returned items visible as `Not counted`, and calculates the current grade with the teacher Gradebook category/assessment-weight rules. Final-grade overrides remain teacher-only.
- Migration202 is authored with default-off backfill, shape enforcement, and the latest cold-archive restore adapters, but was not applied to any database. Focused full verification passes 160 files/1,816 tests plus architecture, UI/design policy, TypeScript and lint; Pika audit passes. Playwright verified teacher/student desktop/mobile in light/dark, default-off/visible states, and the local classroom was restored to off. Composite checklist reviewed: native switch and links have keyboard coverage, checked/active state is semantic, and no manual follow-up remains. Independent PR review follows.
- PR1320 security review found migration202 would have replaced the top-level archive normalizer and bypassed the wrappers added by migrations147/150/164. Remediation batch1 now renames and delegates to the current adapter before adding only `student_grades`, preserves service-role-only execution, and ratchets the chain in a focused migration test; the full 161-file/1,823-test gate remains green.
- Cumulative review cleared the archive correction but found fractional scores were rounded before aggregate calculation, causing teacher/student current-grade drift. Remediation batch2 preserves raw earned/possible values through `calculateCategorizedFinalPercent`, rounds only the public response fields, adds a fractional rubric regression, and removes stale prototype copy.
- Final integration review found the teacher aggregate still consumed rounded assignment display cells. Remediation batch3 now carries raw rubric-earned values into both legacy and categorized teacher calculations while retaining rounded display fields, with an API regression asserting teacher/student parity at 3.33%.
- User-authorized extended review found returned assessment overrides were omitted from student Grades when underlying rubric/responses were incomplete. Remediation batch4 now evaluates assignment/test overrides before base-score completeness, preserves omission for incomplete work without overrides, and covers zero assignment and response-free closed-test overrides.
- Teacher Gradebook visibility refinement moves the control from a standalone settings card into the existing action bar immediately before More actions. The slightly enlarged settings-style switch is neutral and icon-free when hidden; when shown, its track is solid green and its right thumb contains the Lucide Users icon. The optimistic checked treatment now remains visible while the background save disables the switch, with failure rollback covered. Concise “Show grades to students” / “Hide grades from students” tooltips remain, and save errors stay in the Gradebook feedback area. Targeted component and Pattern Lab tests, TypeScript, UI/design policy checks, and desktop/mobile light/dark visual verification pass; the student Grades surface is unchanged.

## 2026-09-22 — Persistent students icon in Gradebook visibility switch

- The teacher Gradebook switch now shows a neutral Users icon at the right end of its track while off; when on, the icon moves with the thumb and the track remains green. The shared switch gained an optional off-state icon without changing switches that omit it. The full focused gate passes 166 files/1,904 tests plus architecture, TypeScript, lint and UI/design policy; Pika audit passes. Playwright confirms off/on at teacher desktop/mobile in light/dark, the live teacher off state, and the unchanged student Grades view at desktop/mobile. Risk profile: none. Model recommendation: GPT-6 — narrow shared-control styling change with role and state verification.

## 2026-09-22 — Student Grades merge preparation

- PR1320 was rebased onto current main after an AI-log archive conflict was resolved without dropping either existing archived entry. Main now owns migrations202–204, so the unapplied student Grades migration was resequenced to205 and its private archive-adapter name and regression updated. The first exact-head CI replay applied205 in its ephemeral database, then found the generated types lacked the new private adapter; the checked-in types were synchronized to CI's exact generated diff. The user requested merge; final CI and merge gates follow. No migration was applied to a persistent environment.
- The next exact-head CI passed build and database contracts but exposed two stale Pattern Lab selectors after production-component reuse and four outdated icon-catalog screenshots following the new student Grades navigation item. Browser tests now target the production switch name and `student-grades-view`; Linux screenshots come from the failed CI artifacts and Mac screenshots were regenerated locally. Targeted teacher/student desktop/mobile light/dark browser checks pass (12/12), as do the full focused gate (166 files/1,905 tests), TypeScript, lint, architecture, and UI/design policy. The normal local dev server was restored at port3001. PR1320 remains draft pending a fresh exact-head CI and merge.

## 2026-09-22 — Daily Log PR main synchronization

- PR1329 was brought up to date with main after its exact-head CI passed. The sole textual conflict was in the AI archive; both batch markers and all distinct history were retained. Classroom page and test changes merged automatically without altering the Daily Log implementation. Combined-tree focused checks pass 166 files/1,922 tests plus architecture, UI/design policy, TypeScript and lint. PR remains draft for the updated-head gate; no merge to main was performed.

## 2026-09-22 — Daily Log PR final review and up-to-date gate

- User authorized additional review. An exact-head integration review of 14d6f387 found no blocker, with 112 targeted tests passing. Ready CI run35803112343 passed Test & Build, browser, database and PR Gate on that head. The squash merge was rejected solely because main advanced during CI and the branch-up-to-date rule applies; no admin override was used.
- Main's two new commits affect only test-grading calibration and rubric scoring, with no Daily Log path overlap. They merged into the feature branch without a textual conflict. Fresh integration review and exact-head CI are required before the merge retry; no persistent database migration was applied.
- Exact-head 722c9e9e targeted re-review found no blocker (142 tests), and CI run35804835394 passed all lanes. During that run main advanced again via a session-log-only PR. The strict up-to-date gate requires another branch sync; the archive batch-marker conflict retains both markers and unique history, with duplicate rolling-log entries omitted. No Daily Log source changed.

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
