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

## 2026-11-09 — Rebase scheduled cancellation and undo

Carried the reviewed cancellation and undo changes onto main after the unpaid scheduled closeout merge. Preserved migration 325 and both continuity histories. The isolated reorder proof uses the shared migration 319 trigger witness at profile 325. The cancellation route now exposes its existing error wrapper directly on both exports while preserving no-store for successes and errors.

## 2026-11-09 — Keep scheduled billing exports on the standard error wrapper

Hosted CI requires the scheduled cancellation and offers exports to call withErrorHandler directly. Added an optional cache-control setting to that handler and used it for the three exports. Existing status codes, error mapping, and private no-store behavior are preserved.

## 2026-11-09 — Include scheduled cancellations in the sealed fixture catalog

The hosted member-list proof rejected the canonical schema because migration 325 adds the private cancellation table. The disposable catalog now fingerprints that table after sealing the exact 325 profile. The proof also preserves the distinct reviewed pre-cancellation catalogs.

## 2026-11-09 — Accept exact Stripe SDK quantities in upgrade invoice evidence

Independent review confirmed Stripe 22.6.2 decodes invoice and preview quantity_decimal into Decimal objects. Shared conversion now feeds the existing exact-one quantity rule for paid invoice, preview and frozen invoice evidence. SDK-shaped quantity regressions cover quote and recovery, and the focused adapter suites passed.

## 2026-11-09 — Preserve legacy scheduling for retired Blueprint drafts

Kept new schedules for Blueprint-retired legacy drafts on the existing publication writer. The database publication and release-intent guards still enforce billing cutoff and intent generation, and explicit rescheduling retains the RPC path. The patch adds route coverage for the legacy write and the two guard errors without changing the migration set.

## 2026-11-10 — Rebase the dormant billing recovery caller

Carried the reviewed worker, configuration, tests and CI fixture wiring onto main after scheduled cancellation merged. Preserved both continuity histories. The Worker and recovery route contracts match the reviewed patch.

## 2026-11-10 — Rebase exclusive Stripe Tax after worker cadence

Preserved the reviewed exclusive-tax and readiness changes and migration 326. The reorder fixture retains the shared migration 319 billing trigger witness at profile 326. The tax-scoped offers remain behind the standard API error wrapper and private no-store.

## 2026-11-10 — Rebase the teacher billing access reminders

Carried the reviewed reminder UI and opt-in status behavior onto main after the Stripe Tax merge. Preserved both continuity histories. The product and test patches match the reviewed version, including the verified keyboard and notice semantics.

## 2026-11-10 — Rebase billing email notices and seal the outbox catalog

Preserved the reviewed email delivery patch and migration 327 after the in-app notices merge. The isolated reorder and member-list proof catalogs now include the exact private email outbox at 327, while the prior cancellation-only catalog remains admitted.

## 2026-11-10 — Rebase exact Stripe Decimal handling after email notices

Carried the independently reviewed amount and invoice quantity normalization onto main after the email notice merge. Preserved both continuity histories and the exact billing patch. The final PR adds no migration.

## 2026-11-10 Production billing schema through 327

Production Supabase applied migrations 322–327 from main `e40f58d6e` in [run 42805516214](https://github.com/codepetca/pika/actions/runs/42805516214). Read-only checks confirmed complete history, three replacement schedule checks and the retained paid-invoice check, row-level security on both new private tables, 14 service-role-only RPCs, both notice triggers, empty new queues, and all 12 billing controls off. The isolated Stripe sandbox verified taxed checkout, paid and failed renewal, recovery, scheduled cancellation and undo, and a full tax-inclusive refund. [Promotion PR 1791](https://github.com/codepetca/pika/pull/1791) records the review and rollout receipts.

## 2026-11-10 Confirmed full-refund access transition

The operator policy retains seven days for first-purchase refund requests and leaves disputes to manual review. The Stripe proof checks the exact canceled subscription, settled invoice, captured gross and successful refund records. Migration 328 adds an idempotent operator transition for the currently bound term, using the existing Free and classroom restriction writers while retaining the original receipt and student work. The owned replay verified the cutoff, a stale paid claim, replay, retained submissions and started Tests, and scheduled cancellation retirement. Hosted preflight found the production Stripe target unpinned and billing controls off. The dormant Cloudflare package passed dry run.

## 2026-11-10 Terra grading default

Set OpenAI GPT-6.1 Terra as the shared grading default for assignments, open responses, and repository reviews. DeepSeek Flash remains the fallback for verified OpenAI hard spend-limit errors. The test reference cache uses the same fallback selection as the router. Existing explicit provider/model settings still take precedence, and archived test calibration retains its prior DeepSeek default. The production AI outbound gate remains independently controlled.

## 2026-11-10 Closed Stripe setup and refund PR sync

Production Pika is pinned to the authorized live Stripe account with classroom cutoff enabled. The individual teacher catalog has eight unavailable versions. Tax, portal, Prices, and the restricted runtime key passed provider reads. The webhook and admission remain closed. Synced the refund branch with main after resolving a duplicate archive marker and verified the refund code and migration diff stayed identical. Production migration 328 remains pending.

## 2026-11-10 Sol assignment and test default

Set the classroom grading default to GPT-6.1 Sol after the owner's model comparison. Assignment and test requests fall back to DeepSeek Flash on OpenAI's exact exhausted-credit code as well as the existing hard spend-limit codes. Repository review routing retains its previous default and fallback scope. Explicit provider/model overrides still apply. Regression coverage includes assignment and test/reference provenance, bounded error classification, and repository compatibility.

## 2026-11-10 Pika recovery alerts Worker

Codepet has zero Cloudflare custom analytics policy quota. A private observer uses the Analytics SQL binding to detect recovery errors and missing expected lane receipts. A Durable Object deduplicates notifications, and the existing Brevo integration sends alerts. An isolated canary reproduced the error and missing-trial signals from Cloudflare logs and delivered one message despite a repeated run. The checked-in deployment is dormant with both heartbeat expectations off.

## 2026-11-10 RepoLight assignment timeline

Added matched student assignment-period timeline with explicit evidence limits; focused tests passed. Visual fixture checked at desktop/mobile light; authenticated report and full theme matrix remain for review.

## 2026-11-11 Closed hosted billing verification

Live Stripe delivered a nonpayment canary event to Pika with HTTP 200 and an unbound live receipt. Hosted trial recovery sent one eligible reminder through the production outbox to the approved canary inbox. The synthetic records were cleaned up and admission stayed closed. Paid recovery rejected the configured Stripe key because it included surrounding whitespace. A private hosted read authenticated to the pinned account after trimming. The runtime now trims the key before strict live-mode validation and still rejects a bearer equal to the normalized key.

## 2026-11-11 RepoLight submission deadline

Extended the shared attestation and submission deadline to 15 seconds for create and reconciliation after a hosted first admission exceeded eight seconds. Other operations retain their eight-second default; explicit overrides remain supported.

## 2026-11-12 Timeline branch base sync

Returned PR #1799 to draft and rebased its unchanged feature patch onto main aa4689bf. Focused checks passed: 97 test files, 1,843 tests, architecture, UI/design policy, TypeScript and lint. Exact-head CI remains required after publication.

## 2026-11-12 Billing recovery due-work check

Migration 329 adds a read-only Supabase check for both recovery lanes. The Cloudflare Worker preserves idle heartbeats, calls Vercel for due work and can fail over shared queues. The RPC uses a dedicated Vault-verified credential and returns lane statuses and shared-work flags. Synthetic PostgREST and rollback-only checks cover authorization, checkout, reconciliation, renewal closeout, trial expiry, assignment releases, interrupted email and scoped RepoLight retries. Coordinate activation with the paid-subscription rollout after migration and credential provisioning.

## 2026-11-12 Billing launch benefits and refund support

Plans and billing explains the seven-day first-purchase refund window, where to email support, and what a confirmed full refund means for paid access and student work. The initial offers are Pro, Max and the Pro trial with classroom capacity and RepoLight. Included AI grading allowances are deferred. Customer checkout, trial admission and provider writes remain closed.

## 2026-11-12 — RepoLight report summary

- Simplified the teacher repository report, retained coverage caveats and detailed evidence, and distinguished feedback availability checks from unavailable imports. Reused the existing report dialog, timeline, metrics and evidence view; no student surface changed. Verification: focused report and work-panel tests passed; broader checks and visual matrix are in progress.

## 2026-11-14 — Proofless room QR

- Worktree `codex/room-qr-when-closed`, base `0a7372f41`: proofless scans clear prior capture and show closed state; teacher continuation uses existing move flow. No schema or production changes.
- UI brief: student closed state and teacher move; reuse room check-in Card/status composition and existing MoveRoom, extend only the room state copy. Desktop/mobile and light/dark are relevant; no composite control changes. Reference: existing room check-in card and shared page-state conventions; no new shared pattern. Pattern Lab comparison remains outstanding.
- Verified room browser fixtures and the student closed and teacher move paths at desktop and mobile widths in light and dark.

## 2026-11-15 — Contextual cold restore actor identity

- Contextual cold restore verifies actor and managed-file subject UUIDs against the exact classroom's cold ledger. Legacy restore and compaction keep role matching. Disposable schema replay and native Storage exercise both owner labels, changed learner label, nonowner denial, and same-key recovery after a request interrupted before SQL and a lost reply after commit. The archive checksum and restored bytes match. Historical Test files whose subject UUID is absent from the ledger retain role-checked recovery.

## 2026-11-15 — Prepare stored classroom deletion preview for classroom roles

- Squash-merged #1815 into `main`. Replaced the account-label count in the stored classroom deletion preview with a note that the student count is unavailable. Reused the existing ContentDialog, confirmation controls, impact cards, and muted detail. Reference: existing dialog and Pattern Lab confirmation. No new composite widget.
- Verified owner confirmation and retry states and learner exclusion on desktop and mobile in light and dark with the cold purge Playwright matrix. Existing purge request and resume tests passed. The API accepts inventories with or without the legacy count. Inventory digests and the operation protocol stay compatible.

## 2026-11-15 — Verify actor UUIDs before archive writer staging

- Squash-merged #1816 after independent review and full CI. Export now checks captured actor IDs against the exact resource references before Storage, and compaction checks the verified IDs before role reads and staging. Existing archive labels and compaction authorization stay compatible.
- The v2 reader accepts archives that predate RepoLight and still rejects partial RepoLight resource families. Disposable export, compaction, managed Storage, and recovery passed with both owner labels through migrations 292 and 329. Existing rollout holds stay in force.

## 2026-11-16 — Account deletion for admitted users

Migration 330 removes live classroom admission when its Pika account is deleted. Batch receipts retain their original counts and digests. Protected exclusions and unresolved classroom ownership still block deletion.

The sealed replay and native service-role deletion checks passed. Local email-code signup with mock delivery, Free classroom admission, invalid and duplicate joins, stale-session rejection, and signup after deletion passed against the disposable database. Production public admission, checkout and trial signup remain closed.

## 2026-11-16 — Align Calendar view toggle with Today

- Reused the shared Calendar action bar and segmented control shown in Pattern Lab. The visible List/Grid and Today borders now align at 26px, with 44px interactive targets. Playwright verified both roles, desktop and mobile, light and dark, both selections, and keyboard focus.

## 2026-11-16 — Label general assessments in Gradebook

Use G-prefixed compact codes for standalone assessments and “Add general assessment” in the Gradebook menu, create dialog and Pattern Lab. The mobile inspector labels the type “General assessment.” Reuse the existing Gradebook toolbar, compact table, mobile student inspector and dialog. Teacher desktop/mobile in light/dark cover compact labels, the open menu and create form. Student Grades displays titles. The API regression test covers numbering of existing general assessments.

## 2026-11-16 — Simplify the Attendance rooms picker

The teacher dialog has a This meeting picker when attendance is open. Choosing a paired room moves that meeting immediately and offers Undo move. The separate Default room picker opens on the saved default or None; Save default applies the selection to future meetings. Reused the Pattern Lab dialog and the Gradebook picker. The browser fixture covers direct moves, undo, and default changes. The component test covers retry after a rejected move.

## 2026-11-16 — Limit WorkOS email code requests

WorkOS signup, sign-in, and resend share limits of five code requests per normalized email and 90 per client per hour. The existing database limiter runs before WorkOS issues a code or Brevo sends it. A disposable PostgreSQL check returned five successful responses followed by HTTP 429, with five WorkOS and five stubbed email calls.

Production public admission, checkout, and trial signup are closed. The launch alert check found no Vercel or Cloudflare monitor for signup delivery or admission failures. Brevo did not return a transactional webhook.

## 2026-11-16 — Prepare classroom launch alerts

Report unexpected signup code issuance, email delivery, and admission registry failures with separate diagnostics and category-only requests to a protected Cloudflare Worker. A Durable Object groups repeats and retries delivery through an independent mail provider.

The Codepet operations inbox is already verified in Cloudflare. Live alert delivery needs a sending domain and a canary. The root domain uses iCloud mail. Public admission, checkout, and trial signup are closed.

## 2026-11-17 Shared attendance room catalog

- Added signed shared-room student poster preview using the existing classroom print composition. Focused transport, authorization and component tests passed; pilot print verification pending.

- Follow-up: require explicit poster check-in confirmation and filter sticker destinations by per-class eligibility; focused tests and TypeScript passed.

- Implemented Pika shared Bara room selection and verified-student poster capture; focused tests and policy checks passed. Mocked Playwright room fixtures passed (6), including shared catalog desktop/mobile; authenticated UI verification unavailable without local test accounts. No publication or database changes.

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

## 2026-11-18 — Consolidate attendance rooms in schedules

Moved the existing room controls into Daily's Attendance schedules flow and removed the separate overflow entry. Reused room/poster owners; kept default and meeting room mutations separate, preserved Undo and unsaved selection through poster preview, and guarded stale responses across date/classroom/open lifetimes. Worktree `/workspace/worktrees/pika-attendance-schedules`, branch `codex/attendance-schedules-rooms`, stacked on open PR1831 at3199cb2. Component and browser verification includes the normal Daily action and desktop/mobile light/dark evidence; detailed final receipts and cloud service limitations are recorded in the PR and `/workspace/README-Bara-Pika.md`. No hosted configuration, migration, deployment, merge or promotion.

## 2026-11-18 — Simplify attendance to one location

Owner requested Attendance Location with one dropdown, and explicitly confirmed it should apply to current and future meetings. Removed visible default/meeting distinction, Save default, room administration and teacher move-sticker QR from this flow. Existing commands update current+future assignment; Undo restores the previous meeting and class location with partial-failure retry. Kept the selected room's student poster, shared catalog/readiness/permissions, request generations and schedule flow. Continuing draft PR1834 on its existing branch; final test/review/visual receipts are in the PR and cloud runbook. No backend, dependency, auth, migration or hosting changes.

## 2026-11-18 — Local attendance schedules completion

- Verified code27203bd9 locally: focused gate2313/2313 plus architecture, UI/design policy, TypeScript and lint; isolated production build and8/8 browser fixture scenarios pass. Bara334 tests/typecheck pass.
- Real loopback Pika/Supabase + Bara/Convex flow with existing synthetic users: Room223 catalog, current/default assignment, poster, persistent display reload, poster check-in, live-QR duplicate, signed callbacks and persisted check-in fact verified. Schema001–330 reused; no migrations.
- WorkOS authentication is emulated. Private launchers isolate local cookie names/origins; hosted pilot/production unchanged. Source code unchanged; private restart/evidence handoff at /private/tmp/bara-pika-local-completion/README.md.

## 2026-11-18 — Correct pending schedule browser check

Production release CI exposed a stale Playwright action that waited for a deliberately disabled modal backdrop. The test now asserts the backdrop is disabled and sends a real outside pointer click while saving; the existing modal-stays-open assertion remains. All four desktop/mobile light/dark projects pass the affected case against the isolated production build. No application behavior, snapshots, database or configuration changed.

## 2026-11-18 — Preserve usable location after legacy room migration

The shared catalog may expose a legacy previous location that cannot be selected again. A successful move from that location now omits an impossible whole-location Undo and explains why; normal reversible moves and uncertain-response recovery remain available. Covered current and absent meetings, a rejected legacy rollback, later valid changes and failed refresh. No backend, auth, schema or dependency changes.

## 2026-11-19 School location picker

Added the attendance school location picker and Custom fallback, retaining room poster and undo behavior. Integration contract coordinated with Bara; verification recorded in the task handoff.

## 2026-11-23 — Calendar announcements use red-orange

Applied the owner-approved red-orange palette to the shared Calendar announcement tokens in both themes. The existing megaphone inherits the title color, and scheduled grid announcements retain their outline. Updated Pattern Lab and the Calendar identity guidance. The existing semantic contrast contract covers default and hover colors.
