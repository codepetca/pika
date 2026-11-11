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

## 2026-11-08 Billing recovery cadence and CI contracts

Added a private Cloudflare Cron Trigger caller for the existing paid and trial recovery endpoints. The two-minute canary interval and both independent caller switches are explicit in the Worker config. The Worker pins the app origin, rejects redirects, bounds receipt reads, and records sanitized failed invocations even when Pika returns a partial failure in HTTP 200. Wrangler packaged the source and exercised its local schedule with both switches off. An enabled workerd run with all outbound calls bound to a local fixture verified success, swapped-token rejection and a refused redirect. Separate synthetic calls reached both actual Pika POST handlers and proved bearer isolation. The CI database job now executes the scheduled billing rollback fixtures 322–325 in order. The operator runbook records activation, cadence evidence, alert verification and durable queue checks.

## 2026-11-08 Stripe exclusive tax custody

Taxed live offerings pin an immutable exclusive-tax mode through Checkout, paid invoice verification, scheduled renewal and cancellation, and unpaid closeout. Verified Stripe automatic tax is separate from the plan subtotal and the captured payment must equal the gross. Tax admission remains independently gated, with Canadian registration and address-only portal prerequisites. The live catalog CLI previews and creates distinct unavailable tax versions when authorized. Separate catalog keys let existing untaxed Max subscribers keep a compatible Pro downgrade while taxed Pro is available. Focused tests and the owned PostgreSQL replay cover legacy and opted-in shapes. The designated Stripe sandbox still needs its tax configuration and a real taxable checkout and renewal rehearsal.

## 2026-11-08 Teacher billing access notices

UI brief. Extend the teacher Plans and billing page and the teacher Classrooms landing page. Reuse the existing Billing card and Pattern Lab fixtures, the compact inline warning from Student Today, and the shared secondary button style. Share the feature-owned warning between the two teacher surfaces. The exact access date is the primary signal. Verify upcoming trial and paid expiry, failed renewal, recovered renewal, and expired access on desktop and mobile in light and dark, plus student exclusion. Existing links and buttons require no composite-widget review.

The teacher-only status read returns a notice only when the new client opts in. Billing and Classrooms refresh on focus so a successful renewal clears the warning. Verified the exact elapsed reminder boundaries and reviewed 32 Playwright captures across both roles, viewports and themes. The slice covers in-app notices.

## 2026-11-08 Billing email notices

Migration 327 queues live teacher cancellation, failed renewal, upcoming cutoff and expiry notices under independent default-off controls. Both recovery lanes use the existing Brevo sender after access processing. The private queue resolves the current verified recipient at claim, suppresses stale access revisions, and retains ambiguous attempts for operator review. Synthetic transport checks cover accepted and uncertain sends. Live email delivery requires a separate authorized canary.

## 2026-11-08 Stripe SDK decimal compatibility

The live paid pause rehearsal reproduced a Checkout verification failure after the pinned Stripe SDK decoded a Price decimal into a Decimal object. Normalize that representation before exact minor-unit comparisons in Checkout, upgrade quotes, applied-upgrade recovery and the exclusive-tax catalog. Detect SDK Decimal objects at validation time so existing Stripe test doubles can still load. Retain fractional, foreign and mismatched amount rejection. The regression test uses real SDK decoding with local response fixtures. The change adds no schema migration.

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

## 2026-11-09 — Rebase reviewed scheduled renewal closeout

Carried the reviewed unpaid scheduled renewal closeout onto main after the Max-to-Pro settlement squash merge. Preserved both continuity histories and the exact migration 324 source. The isolated Test reorder fixture uses the shared migration 319 RepoLight trigger proof for the additional closed profile.

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
