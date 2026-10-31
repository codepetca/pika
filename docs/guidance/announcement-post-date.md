# Announcement calendar dates

**Calendar date (Toronto)** places an announcement on any past, current or
future civil day. New posts default to today. The field is available while
creating or editing new, draft, posted and scheduled announcements.

**Post** publishes now, including when the calendar date is in the future.
**Save** changes placement while retaining publication/scheduling state.
**Schedule** separately selects a future release time. Choosing a future calendar
day never changes Post/Save into Schedule. Drafts remain unpublished.

Creation saves the displayed date even when today's default is untouched.
Publication changes also preserve the displayed date for legacy undated rows;
ordinary unchanged edits retain their existing no-op behavior.

Published announcements stay immediately accessible in Announcements. On the
student Calendar, their date must fit the existing Calendar Visibility horizon
(current week, one week ahead, or all). Week/Month/All/presentation views share
this filter; a pending/failed/missing horizon cannot reveal extra calendar placements. The existing
Test reminder navigation exception does not widen announcement/material dates.

## Storage and API

Migration `295_independent_calendar_post_dates.sql` adds nullable `posted_on`
separately from `published_at` and `scheduled_for`. Readers prefer this civil day
without timezone conversion; legacy null/absent values retain the old Toronto
publication-day fallback. Existing announcement ordering and read receipts remain
based on their original contracts, and a confirmed edit refreshes the calendar.

Create/PATCH accept `posted_on` with ordinary draft/schedule inputs. New
`create_announcement_for_owner_v2` creates and sets the date in one transaction;
existing `update_announcement_for_owner_v1` changes date metadata independently.
Owner, archive, purge, immutable-row, returned-row and concurrent-binding checks
remain in the locked operations. Browser roles gain no new function/table access.

This supersedes migrations 289/290's timestamp-based date edits without changing
historical SQL or backfilling rows. Migration and app rollout must be coordinated:
old date-edit callers expect a changed publication timestamp. Null calendar keys
are omitted from legacy mutation receipts; nonnull dates require the new decoder.
The revised app's explicit shared reads require column 295 and fail closed before
it is installed. No shared/production application is authorized by this feature
request; follow the [schema checklist](./schema-rollout-checklist.md). See the
[material contract](./material-post-date.md) for the shared rollout and test matrix.

## UI evidence

Reference: existing inline announcement editor plus the production Material
Calendar date field and Pattern Lab example. Extend the feature editor and reuse
FormField/Input/SplitButton and current publication controls. Teacher and student,
desktop/mobile, light/dark verification covers new/edit/future/invalid/saved,
failed mutation, immediate list availability and calendar horizon behavior.
No new shared visual pattern or unrelated refactor is introduced.
