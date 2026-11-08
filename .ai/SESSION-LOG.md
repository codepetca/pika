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

## 2026-11-08 — Universal RepoLight tier benefit

Prepared forward migration 301 for the owner's clarified additive RepoLight benefit across otherwise valid Pro and Max purchases, including historical offering versions without the feature marker. Historical purchased terms and provider/sandbox holds stay unchanged; active trial, exact expiry, paid binding, receipt and revision checks remain. Offline 001–301 replay and access/contention contracts passed. Three isolated runners also passed against a separately owned source at version 301, with the shared schema unchanged; hosted migration and live billing remain unapproved and disabled.

## 2026-11-08 — Customer billing and renewal recovery

Prepared the sandbox teacher billing page, portal invoices and payment methods,
verified upgrade confirmation and customer-safe purchased terms. Forward
migrations 302–303 cover pending renewal recovery, undo-cancellation after a
verified prorated upgrade, and advisory account actions. RepoLight's migration
301 tier rule and exact cutoff stay in place. See the billing foundation
checkpoint for the remaining provider, scheduling, classroom and production gates.

## 2026-11-08 — Billing worker recovery

Prepared a separate follow-up that keeps admitted checkout and upgrade work
recoverable when new admissions close. Migration 304 isolates conflicting
expiry rows so a limited batch still processes healthy accounts. Offline
001–304 replay, billing/RepoLight contracts and contention passed. Live mode
and scheduled changes remain open.

## 2026-11-08 — Scheduled Max-to-Pro sandbox checkpoint

Prepared exact renewal quote, confirmation, leased Stripe schedule installation
and target invoice reconciliation. Disposable 001–306 replay verified stale
lease rejection, preservation of the paid Max term, Max grace after Pro payment
failure, and atomic Pro access after capture. Flags remain off. Provider
rehearsal, closeout, replacement, customer UI and profile admission are pending.

## 2026-11-08 — Scheduled Max-to-Pro sandbox checkpoint

Prepared exact renewal quote, confirmation, leased Stripe schedule installation
and target invoice reconciliation. Disposable 001–306 replay verified stale
lease rejection, preservation of the paid Max term, Max grace after Pro payment
failure, and atomic Pro access after capture. Flags remain off. Provider
rehearsal, replacement, customer UI and profile admission are pending. Replay
through 307 also verified scheduled-aware closeout ownership, a captured Pro
invoice winning the cutoff race, and an unpaid closeout preserving Free and
the original Max receipt.

The isolated Stripe rehearsal verified hosted Pro and Max checkout, signed
webhooks, trial and RepoLight access, the restricted portal, actual Max grace
and Pro payment recovery, and unpaid closeout. Accepted the observed scheduled
update invoice only with exact fresh phase proof, and the observed retained
balance on an independently verified void. See the billing foundation receipt.

## 2026-11-08 — Scheduled renewal recovery review fixes

Draft PR 1768 review found delayed first-payment recovery and due-closeout
lease gaps. The batch permits exact verified late settlement, reserves due
closeout work in the ordinary queue and claim, and derives the target cycle
in SQL. It scopes admissions and installation listing to the worker account,
keeps expiry and closeout running when optional recovery fails, and requires
fresh terminal schedule proof for detached delinquent subscriptions.
The sealed disposable 001–307 replay and 186 focused tests passed.

## 2026-11-08 — Scheduled renewal recovery review fixes

Draft PR 1768 review found delayed first-payment recovery and due-closeout
lease gaps. The batch permits exact verified late settlement, reserves due
closeout work in the ordinary queue and claim, and derives the target cycle
in SQL. It scopes admissions and installation listing to the worker account,
keeps expiry and closeout running when optional recovery fails, and requires
fresh terminal schedule proof for detached delinquent subscriptions. The
follow-up preserves ordinary cancellation after settlement and keeps terminal
markers out of authorization once Stripe proves the exact canceled phase.
The sealed disposable 001–307 replay passed.

## 2026-11-08 — Scheduled renewal recovery review fixes

Draft PR 1768 review found delayed first-payment recovery and due-closeout
lease gaps. The batch permits exact verified late settlement, reserves due
closeout work in the ordinary queue and claim, and derives the target cycle
in SQL. It scopes admissions and installation listing to the worker account,
keeps expiry and closeout running when optional recovery fails, and requires
fresh terminal schedule proof for detached delinquent subscriptions. The
follow-up preserves ordinary cancellation after settlement and keeps terminal
markers out of authorization once Stripe proves the exact canceled phase.
The sealed disposable 001–307 replay passed.
fresh terminal schedule proof for detached delinquent subscriptions.
The sealed disposable 001–307 replay and 186 focused tests passed.

## 2026-11-08 — Classroom Test cutoff checkpoint

Prepared the default-off billing fence for new Test attempts and publication.
Disposable 001–308 replay verified the legacy and contextual publication
rollbacks, exact trial cutoff before the expiry worker, existing attempt
resume/save/submit, and a blocked Start crossing cutoff while waiting on the
account lock. Generated public types and shared schema matched their baselines.
The flag remains off pending assignment release, per-classroom restrictions,
and the complete reviewed rollout.

## 2026-11-08 — Classroom capacity restriction checkpoint

Prepared a private subscription restriction history, deterministic activity
fallback, explicit downgrade selection and capacity-checked restore. The
001–309 disposable replay verified trial expiry and paid re-entry, including
cross-owner denial and the last available seat. A separate fixture exercised
Max grace, verified Pro retry, payment winning a closeout and unpaid closeout
with seven classrooms. The existing classroom archive state, shared schema
and generated public type baseline were checked. The rollout flag is off;
assignment release and the customer-facing selection and restore remain open.

## 2026-11-08 — Assignment publication cutoff

Prepared the default-off publication fence shared by legacy and contextual
assignment writers. Disposable 001–310 replay verified draft preservation,
continued editing and student submission of already released work, and both
Classroom-lock and paid-access cutoff races. Native generated types and the
shared schema matched. The existing future schedules need conversion and a
durable release worker before enabling the cutoff.
Independent review identified gaps in paid re-entry, ordinary terminal
retirement, legacy bulk publication and the 307 source replay profile. The
remediation preserves cutoff history and sends publish-capable bulk requests
through the shared atomic writer. Legacy bulk retains Blueprint-retired rows
and treats newly created rows as drafts. Both RPCs preflight classroom ownership
and assignment binding before taking caller-supplied locks.

## 2026-11-08 — Dormant live billing target

Added a default-off operator check for the exact production app and Supabase
target and the private Stripe account pin. The 001–311 offline replay verified
the service-only read, sandbox exclusion, retained test evidence denial,
unchanged shared schema and generated types. The check leaves all live
operations closed.

## 2026-11-08 — Scheduled assignment release worker

Prepared durable draft-backed schedules through the assignment Release route
and the authenticated billing worker. The isolated replay proved eligible
release, exact-once processing, pristine draft preservation and suppression
when a later paid term starts retroactively across the missed due time. The
same draft can be explicitly released after access returns. Migration 312 adds
owner-only list and detail schedule state. Rescheduling and cancellation check
the observed generation under the worker's locks. A stale request refreshes the
editor. Verified teacher and student browser checks on desktop and mobile in
light and dark mode. The sealed replay covers 311 and 312, including both
worker and owner lock orders. Existing-schedule conversion, notice delivery and
final CI still gate activation.

## 2026-11-08 — Live trial lifecycle source

Prepared default-off production trial status, admission and a Stripe-free
expiry worker against the exact pinned target. The owned 001–313 replay proved
admission-off recovery, paid checkout exclusion, the exact RepoLight cutoff,
and retained learner work. Type generation and targeted route tests passed.
Billing now supports trial-only status and admission with no checkout requests.
The teacher browser matrix passed on desktop and mobile in both themes. The
canonical sealed replay and CI admit 313. The production worker caller and
existing-schedule conversion require verification before activation. Live
payment handling remains a separate source slice.

## 2026-11-08 Live Pro trial review fixes

Independent review found that admission could replace separately granted classroom access and that a failed assignment queue read could skip the RepoLight outbox. Admission now checks the audited legacy Free grant under the feature lock. The worker reports the assignment failure and continues the RepoLight attempt. Regression coverage includes manual, school and independently rewritten plan grants plus both assignment list failure paths. Offline migration replay through 313 and the focused regression tests passed.

## 2026-11-08 — Scoped live Stripe evidence

Added explicit account and mode checks for Checkout and verified invoice
reconciliation. Live session creation verifies the active product, price and
remaining write window. Paused writes preserve recovery for known sessions.
Signed live snapshots require a dedicated account endpoint and live evidence.
The sandbox store rejects live receipts. Synthetic provider and service tests
passed. The live SQL store, runtime and operator rollout still need work.

## 2026-11-08 Live Stripe receipt intake

Added a dedicated default-off live snapshot webhook with the official Stripe signature verifier and a target-bound database writer. Migration 314 separates payment recovery, admission and provider-write flags. First activation records a durable target identity and keeps the classroom cutoff in force. The inbox deduplicates by account, mode and event ID and rejects conflicting bytes. The sealed 001–314 replay passed both trial/payment activation orders and receipt persistence, with matching generated types and preserved shared schema. Live checkout persistence, subscription binding and paid entitlement writes are still pending.

## 2026-11-08 Live checkout catalog and persistence

Migrations 315 and 316 add the exact Pro and Max catalog, scoped checkout attempts and leases, and live subscription binding. They preserve an existing checkout across catalog retirement and a pause in Stripe writes. New Stripe creates require renewed database authorization under the lease. The owned 001–316 replay passed all eight catalog terms, stale claims, receipt adoption, trial expiry and independent grants, with generated types matching and the shared schema preserved. Targeted service, store and provider checks passed. Paid entitlement reconciliation is required before enabling the live checkout entry points.

## 2026-11-08 Live paid reconciliation and access

Added scoped reconciliation leases, verified invoice effects, paid status, expiry and RepoLight checks for the pinned live account. The isolated 001–319 replay verified first payment, renewal and grace, replay, trial conversion, paid Pro and Max access and denial at the Max cutoff before materialization. Expiry applied Free once on a financially retired binding. Generated types matched and the shared schema was preserved. Targeted worker and provider checks passed. Customer entry points, paid closeout, safe handling of legacy future assignments and operational rollout checks remain.

## 2026-11-08 Live billing entry points

UI brief. Reuse the teacher Billing cards and plan selector from the sandbox Billing rehearsal and the anonymous Pattern Lab Billing fixture. Verify Free with Pro and Max offers, checkout recovery, and paid status with its portal action on desktop and mobile in light and dark. Student access remains excluded and its redirect will be checked. The primary signals are the verified plan status and existing actions. Composite widget review is unnecessary because the native Select contract stays in place.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Paid plan and recovery | BillingPage and AppShell | reuse | Existing state, cards and navigation cover the same billing flow |
| Live portal action | BillingPage portal button | extend | The same action now also opens term-end cancellation |
| Synthetic visual case | Anonymous Billing Pattern Lab fixture | extend | The production Billing component can render the live plan and recovery states with fixed responses |

The signed webhook and separate paid worker credential now gate live checkout admission. The exact pinned closeout lane closes unpaid renewal invoices after grace or records payment if it wins the race. Existing legacy future releases hold new admission and remain intact. The live portal allows invoice history, payment methods and term-end cancellation. Sealed 001–321 replay passed with generated types matching and the shared schema preserved. Browser verification used the existing Billing component with synthetic checkout and portal responses across both viewports and themes. A real synthetic student session redirected away from Billing.

## 2026-11-08 Live scheduled Max-to-Pro settlement

Migrations 322–323 pin live schedule confirmation and installation to the verified Max payment, then use the ordinary live financial writer under an exact schedule lease to adopt Pro. The isolated settlement fixture held Max and RepoLight during Pro payment failure, denied RepoLight at the grace cutoff, applied Free, and adopted a later verified Pro payment without rewriting the original checkout. A scoped live Stripe adapter verifies the installed target phase and mode for both update and cycle invoice labels. The live scheduling flags default off. Customer cancellation, scheduled unpaid closeout, and worker wiring are required before admission.

## 2026-11-09 — Sync billing launch with main

Merged the latest main into the sandbox billing launch candidate. Preserved the session entries from both branches. The incoming source changes cover teacher roster navigation, Course Guide reads and local loopback sign-in.
rehearsal, replacement, customer UI and profile admission are pending. Replay
through 307 also verified scheduled-aware closeout ownership, a captured Pro
invoice winning the cutoff race, and an unpaid closeout preserving Free and
the original Max receipt.

The isolated Stripe rehearsal verified hosted Pro and Max checkout, signed
webhooks, trial and RepoLight access, the restricted portal, actual Max grace
and Pro payment recovery, and unpaid closeout. Accepted the observed scheduled
update invoice only with exact fresh phase proof, and the observed retained
balance on an independently verified void. See the billing foundation receipt.
fresh terminal schedule proof for detached delinquent subscriptions. The
follow-up preserves ordinary cancellation after settlement and keeps terminal
markers out of authorization once Stripe proves the exact canceled phase.
The sealed disposable 001–307 replay passed.

## 2026-11-09 — Sync billing launch with main

Merged the latest main into the sandbox billing launch candidate. Preserved the session entries from both branches. The incoming source changes cover teacher roster navigation, Course Guide reads and local loopback sign-in.

## 2026-11-09 — Combined assignment copy action

Consolidated teacher bulk grade and comment copying into one menu item and dialog. Grade is selected when available; teachers can choose the comment separately, and each unchecked field hides its preview and stays unchanged. Reused the existing atomic request for grade only, comment only, or both. Verified the three request shapes in component tests and the teacher workspace in desktop and mobile light and dark browser runs.

Independent review prompted three follow-ups: dismiss the dialog if its source or recipients change, retain keyboard access to the preview while copying, and show a failed save in the dialog. Added regressions for source and recipient changes and the failed save.

## 2026-11-09 — Classroom cutoff rebase

Rebased the reviewed classroom cutoff patch onto main after the scheduled billing renewal PR landed. Preserved the billing and main continuity records and kept migrations 308–310 byte-for-byte identical.

## 2026-11-09 — Test lifecycle proof catalog for the billing cutoff

Hosted CI exposed exact trigger inventory checks that predated migration 308. The reorder, creation, pristine discard and publication proofs now require the Test publication cutoff trigger and its reviewed definition where the billing cutoff column exists. The original reorder check failed on the disposable schema at 310, and the corrected check passed at 307 and 310. Dropping or disabling the trigger, altering its predicate, or granting additional execution failed the corrected check. The change is limited to proof tooling.

## 2026-11-09 — Seal the Test publication cutoff proof

Independent review identified the reachable billing helper outside the trigger proof. Bound each catalog to the reviewed source profile, verify the dormant cutoff column and setting, and pin both routines and the trigger predicate. Native catalog blocks pass at 310, historical capability checks pass at 307, mismatched profiles fail, and nine mutations to the catalog or setting fail closed.

## 2026-11-09 — Sync the classroom cutoff proof with main

Merged main after the assignment grade and comment copy change. Preserved both continuity histories and verified the reviewed cutoff patch against the new base.

## 2026-11-09 — Show all classroom Calendar Grid entries

Removed the three-line lesson preview cap and showed each weekend event in its own chip. Grid weeks grow with their contents; long chip titles still use horizontal ellipsis. Retained inline teacher editing and covered busy cells and read-only student previews in the browser matrix.

## 2026-11-09 — Fade horizontally clipped display text

Recorded the shared fade in Design and added a Pattern Lab example for plain text and chip labels. Existing truncation uses the fade only where text overflows. Calendar keeps every lesson line and entry, and forced colours retains native ellipsis. Test evidence is tracked with the draft PR.

## 2026-11-09 — Calendar and text fade review

Completed the independent review of PR #1786 after the owner authorized proceeding. The local focused run found two deterministic failures. Updated the browser inventory for the eight new Pattern Lab cases and kept Gradebook score colour on the text span while the wrapper owns the unreturned background.

Hosted coverage identified more Gradebook tests coupled to the score wrapper and a repeat timeout in the teacher gallery contract. Pointed the assertions at the score text and narrowed gallery lookups to their own controls and example.

## 2026-11-09 — Open Calendar Grid near today

Calendar Grid opens with the preceding week directly below the sticky headings when it fits above today in the upper half of the scroller. For a tall preceding week, today's week starts below the headings. Today uses the same placement. List keeps its centered target and late initial data respects manual scroll. Verified the Grid opening and Today action with teacher and student Playwright captures at desktop and mobile widths in both themes.

## 2026-11-09 — Guarded assignment release rebase

Preserved the reviewed assignment release and live target preflight changes while carrying forward the classroom cutoff proof corrections. Migrations 311–312 retain their reviewed bytes.

## 2026-11-09 — Rebase the live Pro trial

Carried the reviewed cardless Pro trial, RepoLight and learner-work cutoff patch onto main after the guarded assignment-release change. Preserved both continuity histories and the exact migration 313 source.

## 2026-11-09 — Verify the live trial billing trigger in the reorder proof

The isolated Test reorder fixture now selects the exact RepoLight billing trigger columns for the reviewed migration profile. A disposable PostgreSQL catalog accepted both source definitions with their corresponding witnesses and rejected crossed profiles and a missing watched column. Application code and migrations are unchanged.

## 2026-11-09 — Sync the reviewed live trial with main

The live trial passed all required CI at 535e6542b. Main then advanced with the Calendar and text overflow changes. Retained both Pattern Lab test additions and reconciled the browser case inventory to count their combined desktop and mobile coverage.

## 2026-11-09 — Rebase reviewed live checkout after the trial merge

Carried the reviewed checkout patch onto main after the live trial squash merge. Preserved both continuity histories and the exact migration 314–316 source. The isolated Test reorder proof now uses the shared RepoLight witness for the checkout profiles, which retain the trial trigger columns.

## 2026-11-09 — Rebase live paid reconciliation after checkout

Carried the reviewed paid reconciliation and access cutoff patch onto main after the checkout squash merge. Preserved both continuity histories and the exact migration 317–319 source. The shared Test reorder proof now requires the exact RepoLight billing trigger for migration 319. A disposable PostgreSQL catalog accepted the three reviewed trigger definitions with their corresponding witnesses and rejected crossed profiles and a disabled trigger.

## 2026-11-09 — Rebase reviewed live billing routing and closeout

Carried the reviewed activation routes, unpaid renewal closeout, and migration 320–321 source onto main after the paid reconciliation squash merge. Preserved both continuity histories. The Test reorder fixture uses the shared migration 319 RepoLight trigger proof for the two additional closed profiles.

## 2026-11-09 — Rebase reviewed Max-to-Pro renewal settlement

Carried the reviewed scheduled renewal settlement and verified Max retry onto main after the activation squash merge. Preserved both continuity histories and the exact migration 322–323 source. The isolated Test reorder proof uses the shared migration 319 RepoLight trigger witness for both additional profiles.

## 2026-11-09 — Sync scheduled renewal settlement with main

The scheduled Max-to-Pro renewal PR passed all required CI at 448956e9. Synced with the retired Blueprint draft scheduling compatibility change before merge. The billing patch and migration source match the reviewed candidate.
## 2026-11-08 Live scheduled renewal closeout

Migration 324 gives exact scheduled renewal grace the same live closeout lease as ordinary renewal while keeping old worker calls compatible. The owned 001–324 replay verified both outcomes, rejection of mismatched schedule or stale lease, rollback after a lease expired during a provisional terminal transition, retained classroom restriction, and ordinary fallback. The same sandbox account separately proved that a source-only Stripe schedule can preserve Max through cancellation or restore the target phase on undo. Customer cancellation and installation invocation still require their rollout gate.
