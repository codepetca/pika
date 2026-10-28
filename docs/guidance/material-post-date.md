# Material calendar dates

Teachers can choose **Calendar date (Toronto)** when creating or editing a
Classwork material. It defaults to today for a new post and accepts any real
civil date from 0001–9999, including past and future dates.

- **Post** publishes immediately. A future calendar date does not delay release.
- **Save** changes calendar placement without changing an existing release time.
- **Schedule** separately chooses when students receive access.
- **Save draft** retains an unpublished item, including its chosen calendar date.

The editor always saves the displayed calendar date, even when today's default
is left unchanged. Reopening a draft or changing release timing keeps that date.

The field is available for new, draft, posted and scheduled materials. Its hint
explains calendar placement versus release timing. Published materials remain
accessible in Classwork; their placement in the student calendar follows the
classroom's existing Calendar Visibility horizon. Current-week, one-week-ahead
and unrestricted horizons apply in Week, Month, All and presentation views.
An unconfirmed or failed horizon read hides calendar posts until recovered;
Tests retain their existing reminder/navigation exception.

## Persistence and rollout

Migration `295_independent_calendar_post_dates.sql` adds nullable `posted_on`
civil dates to materials and announcements. It supersedes the date-edit behavior
introduced by migrations 289/290, which used publication timestamps as calendar
placement. Historical migration files remain unchanged; there is no data backfill.
Readers prefer `posted_on`; absent/null legacy rows use their Toronto release day
(or creation day when release is absent). Drafts remain absent from the calendar.

Create and PATCH accept `posted_on` independently of draft/scheduling fields.
`create_classwork_material_for_owner_v4` atomically creates a dated material via
the existing creator and locked updater. `update_classwork_material_for_owner_v1`
changes the date without touching release timestamps unless the request explicitly
changes publication too. All owner/archive/purge locks, immutable-row checks,
mutation receipts and service-only execution ACLs remain enforced.

The application requires migration 295 for these fields and create wrappers.
Explicit shared reads fail closed if the column is absent; no fallback silently
turns a calendar date into a schedule. Coordinate migration and application
rollout: existing v1 date-edit semantics change at migration time. Null date keys
are omitted from legacy mutation receipts to preserve ordinary strict-decoder
contracts. An older application cannot reliably edit newly dated rows.
Production/shared migration application remains separately authorized under the
[schema checklist](./schema-rollout-checklist.md). No shared or production
migration was applied by this feature work.

## UI and verification

Reference: production Material editor and its Pattern Lab example. Extend the
feature editor; reuse FormField, Input, SplitButton, schedule picker and existing
Save feedback. No new visual pattern, dependency, due date or automatic save.
Primary signal: Calendar date label and explicit Post/Save versus Schedule action.
Teacher desktop/mobile, light/dark: new/draft/posted/scheduled, focused date,
invalid date, saving, failed save and explicit publication/date saves. Student
calendar/list reading uses the same viewport/theme matrix; editing is teacher-only.
Composite checklist: existing menu/dialog keyboard/focus contracts retained;
labels, descriptions and enabled state covered by interaction tests.

Rollback-only private database proofs cover arbitrary dates, independent release,
atomic creation, combined metadata/publication edits, ownership/archive rejection,
tampered before/after rows, legacy null receipts, ACLs and generated-type equality.
Application tests cover default dates, outgoing payloads, failure retention,
calendar mapping, inclusive horizons, all views, and scheduled-release exclusion.
Historical release evidence for 289/290 remains in the
[October 22 receipt](./production-release-2026-10-22.md).

Dev-flow risk profile: none. Review risk: high due to privileged owner RPC and
schema compatibility changes. Production release and migration authority are
separate from implementation and review.
