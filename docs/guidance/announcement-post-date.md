# Announcement post dates

Teachers can edit an already-published announcement, choose **Post date
(Toronto)**, then **Save** to move its publication/calendar day. Today or an
older real civil date is allowed; future dates use the existing Schedule action.
Drafts and future-scheduled announcements do not show this field. Changing the
field does not write until Save; unconfirmed saves retain the edited date.

Both API access paths use the existing locked owner operation for `posted_on`.
Migration290 extends its JSON patch without changing signatures or columns.
It stores Toronto midnight in `published_at` and clears historical
`scheduled_for`, preserving author, creation time and read receipts. It rejects
drafts, future publication, competing draft/schedule patches, nonowners,
archived classes and tampered after-row evidence. The API receipt must match
the requested Toronto day. Existing announcement sorting and teacher/student
calendar readers prefer publication time. A confirmed edit refreshes the
already-mounted teacher calendar. Apply289 and290 before deployment; no shared
local or production migration application was authorized by the feature request.
The later production rollout is recorded in the
[October 22 release receipt](./production-release-2026-10-22.md).

UI reference: Material editor Post date and its Pattern Lab example, composed
with existing announcement card editing. Reuse FormField/Input/SplitButton;
extend the announcement editor, reuse the civil-date schema for both post
kinds. No new shared UI pattern. Primary signal is the labeled native date
field and existing Save action; no decoration. Matrix: teacher desktop/mobile,
light/dark, edited/focused/invalid/saving/failure; student desktop/mobile
light/dark reading the saved date with no editing controls. Composite checklist
reviewed: native label/error association, primary disabled state with schedule
chooser retained, existing menu keyboard/focus contract. No new ARIA widget.
Risk profile none; API/schema payload compatibility is the rollout boundary.

Verification: focused API/server/interaction and calendar movement/refresh tests;
Playwright uses production owners with deterministic mocked API responses and
takes the declared teacher/student matrix screenshots. Database replay and
rollback proofs are in `scripts/check-material-post-date-database.sh` and
`scripts/check-announcement-post-date-database.sql`; Owner approved a brief Docker restart in this chat. Full001–290 replay,
material scheduling/backdating and announcement rollback proofs passed; evidence
`/tmp/pika-material-post-date.NSbkTw`. Attendance replay/rollback/contention/type
checks passed at `/tmp/pika-attendance-membership.R8Oq4m`. Both normal and
absent-default Data API ACL replays passed. Shared schema/history remained
unchanged, all owned clones were removed, and Docker was stopped again. No dependency
added. Migration289 remains byte-identical to the reviewed material change.


Visual evidence (2026-10-22, America/Toronto): production owners, deterministic
API fixtures, reference Material Pattern Lab owner, baseb6fd47492 plus this PR
announcement diff. Playwright1.58; viewports1440×900 and390×844, light/dark.
Four new cases passed with teacher focused/invalid and student saved-date
captures inspected in `/tmp/pika-announcement-post-date-browser-matrix`.
Two existing mutation-feedback cases passed at normal/reduced motion in
`/tmp/pika-announcement-existing-feedback-browser`. No baseline refresh or
experimental pattern. Feature focused5,413/173 and cumulative independent review
passed; production-base focused12,583/559 and the journal-resolution review also
passed. See the release receipt for exact-head CI and production verification.
