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

## 2026-11-06 — Protect authoring progress

- Added close confirmations for changed assignment and survey editors, plus tab-scoped recovery and save/discard choices for material editing. Focused checks and teacher desktop/mobile light/dark visual verification passed. Independent review and CI recorded in PR #1752.

## 2026-11-06 — RepoLight sync after gradebook PDF

Rebased RepoLight work onto main f69f729e7. Retained main's gradebook PDF sources and dependency/lockfile changes; feature files and migrations 298–300 are byte-identical to the prior branch. Reconciled archive/session entries without loss. Offline RepoLight and gradebook model checks pass. New PDF dependencies were not installed and PDF/native/full CI checks remain pending. No DB, migration, provider, push or release action.

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

## 2026-11-06 Gradebook student PDF export continuation

- Continued draft PR #1741 on current main. Owner clarified Email 2 is guardian email and only Pika’s single guardian is the intended recipient. Teacher labels updated; read-only checks of two open classes found matching populated addresses and missing-address exceptions reported privately. TeachAssist email uses Trillium recipients and attaches its own report; no Pika-PDF upload observed. Board Outlook is accessible only in Chrome; no messages sent.
- Local implementation adds a PDF/guardian pairing CSV, fail-closed roster matching, unrounded returned-work calculations and a multilingual tagged-text PDF prototype. Synthetic privacy/extraction tests and selected/all local browser ZIP pass; teacher desktop/mobile light/dark visual checks run. Focused gate 1758 tests and static checks pass; production build passes with PDF-library dynamic-import warnings and a 13.5 MB compressed CJK chunk. Independent review and exact-head CI remain. Account weekly ordinary usage exhausted; pr-review requires a human checkpoint before reviewer launch. No PR ready, merge or release.

## 2026-11-06 Gradebook PDF review continuation

- Owner explicitly authorized continuing independent review despite the exhausted weekly allowance; other review budgets and release gates remain. Review of c96921bd against 6dc7c349 used two Sol-high reviewers (effective configuration and elapsed/token telemetry unavailable). Privacy/calculation review found no confirmed defect; PDF review identified one P2 grapheme-splitting defect in long complex-script text.
- Rebased onto main b91b3dc3, preserving both continuity histories. One remediation batch adds grapheme-safe wrapping and regression coverage for Devanagari vowel marks and conjuncts. Targeted tests/typecheck and synthetic multilingual PDF inspection pass; focused checks and independent delta review follow. No email or production deployment authorized.

## 2026-11-06 — Scoped Test native 300 witnesses

Added a fixed sealed300-only complete-row witness for RepoLight, Stripe, plans and billing plus four trigger and two function definitions/ACLs to learner, grading, recovery, deletion and unpublication snapshots and contention comparisons. Isolated setup verifies dormant state and trigger bindings; historical source profiles retain their original snapshot SQL. Source guards admit exact300 or historic ≤297 and reject partial, changed or unknown tails. Offline plan, negative and historical tests pass. No DB access or migration; SQL/native behavior, preservation, target caps, CI and independent review remain pending.

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

## 2026-11-06 — Sealed 300 member and attendance profiles

Member-list and full-graph hot-lifecycle source guards admit the exact sealed300 chain while retaining historical profiles and rejecting partial/changed/future tails. Member-list accepts explicit historical canonical catalogs and fingerprints every target table; hot fixture checks dormant RepoLight state before synthetic writes. The learner test helper validates the full300 chain before copying only historical257/258. Attendance clone accepts audited application-only source versions through300 and exact sealed297/300 target profiles. Offline tests passed; no database access or migration. Native 300 replay, metadata equality, cleanup, race evidence and independent review remain pending; separately scoped Test runners remain closed.

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

## 2026-11-06 — RepoLight reorder preservation profile

Extended only the Test reorder proof to the exact sealed 300 chain; historical through 297 remains accepted and partial 298/299 or unknown/tampered tails fail closed. Shared quota catalog fingerprints new managed/control/outbox rows and affected billing/plan/settings; canonical metadata tracks four triggers and both function definitions/ACLs. Isolated fixture checks dormant settings, control epoch, empty managed/outbox and trigger bindings. Offline tests and typecheck pass. No DB execution or migration; isolated 300 native behavior and preservation, other native profiles, full focused checks and independent review remain pending.

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

## 2026-11-06 — Home replay source profile after RepoLight sync

Home proof source manifest accepts exact historical 297 or sealed 300 inventory and rejects partial, changed or future tails. The 298–300 migrations contain no Auth/Storage references; source version cap covers these application-only changes under the existing platform-schema assumption. Offline manifest/source boundary tests pass; this does not establish live-source bytes or native 300 replay. Other native proofs and preservation catalogs remain closed at 297 pending explicit table, singleton and trigger coverage; no DB, migration or PR operation.

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

## 2026-11-06 — RepoLight sync after gradebook update

Rebased the RepoLight branch onto main b91b3dc3d. The gradebook source and test match main exactly; RepoLight migration SQL 298–300 is byte-identical to the prior branch. Reconciled archive history without dropping main or branch entries. Gradebook and RepoLight source-boundary checks pass. No database, provider, push or release action; fresh database replay, type verification and cross-service evidence remain pending.

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

## 2026-11-06 — RepoLight replay source boundary

Review found the 001–300 replay harness rejected local source versions 296/297. Audited their sealed SQL: neither references or modifies platform Auth/Storage; 296 dynamic statements target public application tables. Admit 296/297 under the existing platform-schema source assumption, while retaining the exact 297 source seal preflight and 298+ refusal. This is not an attestation of live migration bytes. Corrected replay labels; 39 offline boundary/profile tests pass. No database access or migration; fresh replay/types and independent review remain pending.

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

## 2026-11-06 — RepoLight main sync and migration resequence

Rebased PR1715 onto main 6dc7c349e. Preserved main 296/297; moved RepoLight source migrations to 298–300 without changing SQL bytes or hashes. Exact source guards and offline tests preserve main's reviewed 297 native catalog boundary and reject the RepoLight tail. No database, provider, flag, push or release operation. Full 001–300 isolated replay, generated-type verification, cross-service E2E and independent rebase-delta review remain pending.

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

## 2026-11-06 — RepoLight managed pilot scope

Added explicit off/scoped/full managed provisioning scope with one-teacher cron claims, manual connection continuity, and exact pending rotation recovery for saved locators. Verification is recorded in the implementation handoff. No hosted changes or migrations.

## 2026-11-06 Parent gradebook report refinement

- Redesigned the individual student PDF for parent readability, retaining returned-work filtering and guardian pairing. User confirmed unreleased marks should remain hidden; the sample's two missing marks are not returned.
- Verified test-classroom export and inspected short, empty, multilingual and multi-page PDFs. Focused local checks passed; independent PR review remains pending.

## 2026-11-06 — Term calendar List and Grid

Implemented the approved full-term List/Grid calendar, compact controls, Today centering, sticky headings and subtle month/week boundaries. Teacher/student browser interaction and role/theme/viewport captures were exercised; focused checks and independent review remain in progress on `codex/calendar-term-list-grid`.

## 2026-11-06 — Survey authoring CI timeout

Raised the survey authoring browser test budget to 120 seconds after repeated CI runs exhausted the default 30 seconds. Updated the close flow for the new confirmation, covering both choices. The isolated desktop-light scenario passed with font-readiness waiting disabled after cold navigation and font waits blocked earlier runs; CI remains required.

## 2026-11-06 — Dark browser CI partitions

Partitioned the dark experience matrix into four fresh-server runs with an exact discovered-inventory check and unchanged project coverage. Playwright discovery validates the partition; hosted CI must verify memory and duration.

## 2026-11-06 — Gradebook PDF test timeout

Raised only the long multilingual pagination test timeout to 15 seconds after CI exceeded the default five seconds; fixtures and assertions are unchanged.

## 2026-11-06 — Parent report score alignment

Aligned each assessment's title and percentage above its category and raw score in the parent PDF, moved the current grade to the header, added the Toronto report date, removed explanatory subtitles, and compacted rows to fit 15 typical assessments on one page. Returned-only eligibility and multilingual-safe wrapping remain. Rendered sample and focused tests verified; updated PR requires review and checks.

## 2026-11-07 — Calendar label and scrolling review

Removed the redundant action-bar month label, retaining the sticky list month header. Constrained the teacher and student calendar workspace to a single edge-aligned scroll area, with keyboard access and a short-viewport fallback for crowded warnings. Verified list and grid layouts across roles, sizes and themes; focused checks and review are tracked with the PR.

## 2026-11-07 — Calendar list day selection

Centered date labels in compact calendar list rows and made non-interactive row space open the existing day view, retaining item actions and an accessible teacher edit control. Increased month-band contrast in list and grid. Aligned weekday and day numbers, added row hover, and preserved direct lesson editing with top-aligned dates during edits. Verified teacher and student roles across viewports and themes, plus focused interactions; browser CI checks hover-revealed editing after scrolling the row clear of the sticky month header.

## 2026-11-08 — Calendar sticky focus

Added scroll padding to keep keyboard-focused calendar controls below sticky headings. Verified teacher and student list navigation at desktop and narrow widths and checked calendar layouts across roles, themes, and viewports.

## 2026-11-08 — Restore navigation for calendars without complete dates

Restored compact month navigation for teacher and student calendars with an incomplete classroom date range, keeping fetched and displayed months aligned and Today current across month rollover. Complete terms retain the scrolling term views. Focused component and responsive browser checks cover both roles. Follow-up review fixed partially visible student months, announced the selected month to assistive technology, and corrected the complete-term Pattern Lab fixture.
