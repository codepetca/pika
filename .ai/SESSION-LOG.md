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

## 2026-11-17 — Audit Pika product consistency and architecture

Audited b61ab87d6 in an isolated worktree with three bounded reviewers and coordinator verification. Recorded 22 findings/opportunities, 14 accepted local teacher/student captures and the proposed sequence within the existing product-experience epic; no application code, migrations or hosted systems changed. Architecture/UI/design policy checks and 13 focused files/240 tests passed. History-error scoring and silent guardian-email loss reproduced locally; image-access finding narrowed to policy parity. See docs/guidance/ui/product-experience-audit-2026-11-17.md. Implementation and full Phase 6 verification remain outstanding.

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

## 2026-11-18 — Implement audited consistency and integrity fixes

Implemented bounded grading-history reads/failure retry, legacy Daily Log CAS, transactional assignment bulk reuse and named API schemas, legacy private-image membership/visibility parity, roster validation/dialog behavior, accessible date/card metadata and 44px controls/reduced motion. Extracted owner-scoped repository/test grading-start controllers and validated/scoped Blueprint copilot responses. Reconciled audit and architecture guidance; the existing product-experience epic remains open. Risk profiles: async-grading, workspace-state. Final focused checks pass (664 files, 14,750 tests, eight skips, TypeScript, lint, architecture/UI/design policies), precommit audit passes, and changed-UI teacher/student desktop/mobile light/dark matrix passes. PR #1833 is draft. Two initial reviews found seven gaps; two correction batches add intermediate patch bounds, absent-row revision conflicts, real roster refresh recovery/delimited-cell integrity, committed proposal reconciliation and newer grading-selection preservation. Historical oversized Daily repair and Blueprint tab/preview intent also have regressions and browser evidence. Targeted browser matrices and focused regressions pass; targeted/final fixed-SHA review and CI remain in progress. Test-history transaction work is isolated; its source preflight found native harness/compatibility corrections. In the isolated A5 follow-up, approved331 applied to a network-none disposable container; its first fixture rolled back and corrected verification awaits fresh approval. No existing database, production, merge or deployment changes.

## 2026-11-19 School location picker

Added the attendance school location picker and Custom fallback, retaining room poster and undo behavior. Integration contract coordinated with Bara; verification recorded in the task handoff.

## 2026-11-23 — Calendar announcements use red-orange

Applied the owner-approved red-orange palette to the shared Calendar announcement tokens in both themes. The existing megaphone inherits the title color, and scheduled grid announcements retain their outline. Updated Pattern Lab and the Calendar identity guidance. The existing semantic contrast contract covers default and hover colors.

## 2026-11-23 — Align non-grading OpenAI model defaults

Daily-log summaries, developer-feedback extraction, curriculum imports, and guided Blueprint/Classroom drafts now default to GPT-6.1 Sol with low reasoning effort. Existing overrides, privacy settings, request limits, and schemas remain in place. The synthetic daily-log evaluator requires the exact provider model identifier; historical evidence receipts remain unchanged.

## 2026-11-24 — Fix immediate assignment posting

Reproduced the Post failure with a zero-byte HTTP request through Next.js. The release endpoint now accepts an empty body and keeps JSON validation for schedule requests. Regression tests cover absent and zero-byte bodies, an empty object, malformed JSON, and JSON null. The affected route and scheduling suites passed 97 tests.

## 2026-11-24 — Verify synchronized production promotions

The production classifier can reuse Test & Build and PR Gate for a canonical same-repository promotion after verifying both parent pairs, reconstructing the clean sync, and matching GitHub's test-merge tree. The only permitted differences from current main are the two regular continuity files. Missing or conflicting evidence still selects full CI. The chip release's actual GitHub test merge provides the historical replay.

## 2026-11-24 — Reduce student sidebar notification queries

Admitted classroom participants use a single service-role SQL snapshot for the four existing sidebar counts. Migration 331 preserves current enrollment, owner precedence, release timing, and feature visibility. Before the RPC is installed, its exact missing-function response selects the existing reader. API regressions and disposable SQL checks cover the new route and authorization.

## 2026-11-24 — Appearance-only PR Gate path

Added a switch-controlled CI path for exact Calendar announcement palette edits and plain Join helper copy. The current main policy verifies the complete PR diff and the tested merge. Workflow contracts remain required, and the focused job checks the selected surfaces against the actual merge. Shadow mode keeps the normal checks and records focused evidence alongside them. Exact-head rollout, rollback, and hosted evidence are tracked in the rollout PR.

## 2026-11-25 — Bound student notification fallback time

Merged main into the notification query branch, shared the RPC deadline with its compatibility fallback, and separated the test-override database assertions. Focused notification API tests passed; migration 331 is unchanged.

## 2026-11-25 — Roll out parallel light browser checks

The ordinary hosted UI path can require both light-mode shards under the same Browser Experience Matrix job and PR Gate. Each required job contributes a completion receipt tied to the tested merge, run, and mode. The rollout switch starts off, can select a single reviewed head for shadow or required checks, and supports rollback to serial. Local CI retains serial coverage. The rollout PR records the hosted comparison and failure controls.

## 2026-11-25 — Student Classwork and Tests posting order

Student Classwork lists assignments, materials and surveys by newest posting or opening time. Student Tests follow newest publication day across statuses. Older undated records use creation dates, and ties keep their prior order. The student list tests cover mixed Classwork and Tests statuses. Teacher ordering, calendar placement and availability keep their existing contracts.

## 2026-11-25 — Started Test title corrections and editor dismissal

Restore atomic title editing after Start with migration 332. Preserve the existing question, grading, reference and results restrictions. The split teacher editor places feedback beside the affected controls. Close discards rejected input and keeps acknowledged saves. Playwright verified rename, invalid Markdown, close and reopen on desktop/mobile in light/dark. Rebased over the student notification counts migration 331 with identical title-fix SQL.

## 2026-11-26 — Rebase the reviewed Pika audit fixes

Rebased PR #1833 onto main b1ac2ed34. Preserved current main's continuity records and restored the November audit entries. The cumulative audit patch retains the shipped newest-first Student Classwork behavior alongside its reduced-motion changes. Risk profiles: async-grading and workspace-state. Rebased validation, independent review and PR Gate are tracked on #1833.
