# Dormant existing Tests screen adoption

This follows the prepared owner and learner components through migration262.
It connects existing screens; it does not change rollout settings, subscriptions,
Test quotas, provider behavior or the independent classroom-page pilot.

## Selection and contracts

The authenticated Classroom SSR owner resolves the strict shared experience
admission and serializes `testExperienceMode: 'existing' | 'shared'` through
ClassroomPageClient to TeacherTestsTab. The absent/unmatched configuration selects
existing behavior. Invalid configured admission fails closed. Global account role
and the separately resolved classroom relationship are unchanged. A client prop
selects transport only: each API still proves its own authority and resource.

Shared publication uses `POST /api/teacher/tests/[id]/publish` with the original
saved `{ status: 'closed', draft_version }`; existing mode keeps legacy PATCH.
Shared publication acknowledgements must match the captured Test, classroom and
closed status. No failed write falls back to PATCH, retries or refreshes the
captured version. A response for an old selection/classroom/experience must not
update a replacement workspace.

Shared list reorder uses `/api/teacher/tests/reorder/atomic` with the complete
current unfiltered Test snapshot, including Blueprint-retired rows. It is not a
partial visible-list operation and not an order-version CAS. The existing1,000
operating ceiling remains separate from subscription quotas. Loading, incomplete,
failed or over-ceiling snapshots cannot dispatch a shared reorder.
Every refresh synchronously invalidates eligibility using the list request
generation. It becomes eligible only when that request's replacement snapshot
has rendered, not when a queued loading flag or an older response completes.
Rejected membership/conflict reloads the canonical list without repeating the mutation;
late responses cannot replace another classroom's state. Existing-mode transport
and ordinary list presentation remain compatible.

Saved standalone preview uses the reviewed current-owner Test detail read for
admitted accounts of either historical role. It verifies the requested classroom
parent before rendering the unchanged TeacherTestPreviewPage. Expected invalid,
forbidden and missing-resource errors produce not-found; unavailable verification
propagates and never enters the legacy teacher path. Unmatched accounts retain
the existing global-teacher preview checks. This does not widen the main classroom
page's independent pilot.

## UI brief and acceptance

Reference: governed teacher work-surface and operational-table canon; executable
Pattern Lab teacher `#mockup-workspaces-panel` Tests/`#test-edit-split`, student
`#mockup-student-tests-panel`. Preserve current layout, statuses, controls, icons,
confirmation, focus and messages. Do not add classroom quota explanations; those
remain restricted to upgrade/tier summaries by the owner.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Server selection | Classroom SSR + strict shared admission | extend | Select endpoint without granting authority or changing account role |
| Publish/reorder | TeacherTestsTab and complete list/draft controller | extend | Adopt accepted contracts with original snapshot and safe failures |
| Preview | Reviewed owner detail read + TeacherTestPreviewPage | reuse | Same saved owner preview and parent binding |
| Feedback/focus | Existing confirmation and message components | reuse | No new presentation pattern |
| Synthetic verification | Existing gated teacher-student-tables fixture | extend | Exercise both account roles and relationships without backend traffic |

Verify teacher/student account-role owners and teacher/student members, desktop
1440×900/mobile390×844, light/dark. Cover owner list/edit/drag pending/conflict,
publish confirmation/pending/error/success, selected preview and unchanged member
list. Composite checklist applies to existing menu/dialog/keyboard drag behavior;
do not claim new-widget semantics from screenshots. TDD tests must cover endpoint
and real request-schema compatibility, unchanged existing requests, complete
membership, no retry/fallback, bad acknowledgements and stale responses, strict
SSR selection and foreign-parent/nonowner denial.

Gallery references and API-intercepted fixture screenshots are visual/browser
evidence only, not authenticated persistence or a Tests phase exit. Every fixture
API request must be intercepted before mounting the real production owners.
Production and non-E2E fixture access remain excluded.

## Compatibility evidence

The historical whole-TeacherTestsTab source seal
`e8653214921b5dbe9ab736fc70232f6d1427b69b97951b71fe23a1e734d9e7b0`
recorded the pre-adoption UI through PR1579. This intentional screen integration
supersedes that whole-file freeze rather than silently replacing its expected hash
or stripping arbitrary new UI code. `TeacherTestsTab.test.tsx` directly verifies
existing publication PATCH with the original closed-status/version payload and
existing reorder transport, alongside the dedicated shared publication and atomic
reorder contracts, acknowledgement checks, conflicts and late-response isolation.
The legacy API source seal `d9947ed07251b95be672c0947f21d0b625cca695798a151ae3155940f761700e`
and its exact dormant-dispatcher normalization remain unchanged. This successor
requires independent review with the full screen diff; it is not proof of live
rollout or persistence.

## Later integrated exit evidence

One separately reviewed and authorized isolated appHTTP/browser rehearsal must
use synthetic authenticated identities on an exact disposable schema. It must
never configure or seed the shared stack as a shortcut. Execute existing screens:
create → edit/Markdown → save → preview/references → publish closed → selected open
→ learner start → autosave/recover → submit → inspect → manual grade/clear and
version conflict → close/return → read returned results. Also exercise unsubmit,
attempt reset, unpublish, whole-Test deletion and atomic reorder. Cover current
owner precedence over self-enrollment, both historical account-role values,
teacher/student members, nonmember and foreign-parent denial, withheld pre-return
keys/feedback, archive and membership-revocation boundaries. Retain unchanged
accepted SQL/concurrency/native component evidence instead of relaunching it
solely for newer timestamps; do not label that evidence as the app rehearsal.

Existing AI grading entrypoints/jobs and Blueprint compatibility are still
separate open groups. The manual screen adopter does not prove provider readiness,
Surveys/Gradebook completeness, Tests batch2 exit or full goal completion.

### Consolidated remaining check — prepared 2026-10-17

The separate `lifecycle-permissions-v1` scope reuses the accepted ordinary
Playwright carrier on frozen main `eb4fa32b2`, schema001–267. It uses two synthetic
Tests and the complementary ownerTeacher/memberStudent/memberTeacher pairing;
accepted ownerStudent grading/Return evidence remains valid without replay.
The workload covers saved references/previews, reload recovery, real stale-grade
revision/retry, grade clearing with explicit Return preserved, Unsubmit, single/multiple work reset,
atomic reorder and deletion. Positive return-to-draft occurs before any attempts;
the irreversible first-attempt lock is separately checked in the UI and API.
Eight captures cover owner/learner desktop/mobile light/dark combinations.

Preserve-data learner removal intentionally retains the work and tombstone and
refuses rejoin. The final isolated witness enumerates that expected removal;
it must not claim full fixture restoration or purge retained work to force one.
Cached/fresh removed-member and archived-classroom denials are checked, the
classroom is unarchived, and exact saved work is compared independently. Browser
code gets no SQL capability. Existing network/process/source/dependency limits,
canonical-state preservation and complete disposable cleanup remain mandatory.
Preparation and CPU checks are not native acceptance. Production holds remain.
The first five attempts remain failed/spent with positive cleanup/preservation.
The third failure occurred after publication/reference preview; its broad reorder
label also covered subsequent access setup. Fixed substage labels now distinguish
the gesture, acknowledgement and access steps. A separately observed owner-RPC
deadline rejection has not been established as the causal blocker. Lifecycle
screenshots finish finite animations so mid-crossfade frames cannot be accepted.
The fourth reached both learner submissions, a real grading conflict/retry and
Return. Source inspection then found an obsolete expectation: effective migration
265 intentionally preserves explicit Return when scores are cleared. The proof
must keep the exact Return timestamp/actor, retain results access and unchanged MC
work, and verify the cleared open-response score/feedback and pending grading.
It must not invent a results-access revocation or change the app to match an old
test. Captures wait for the actual result/submission/roster state before saving.
The fifth stopped at recovery: its new capture gate incorrectly required a fresh
save announcement after loading existing answers. A real-form regression
reproduces the empty live region with visible Saved and correct recovered controls.
Recovery capture now checks those controls and the existing exact persisted
attempt equality, without an extra write. The gateway's cancellation label may
have arisen during teardown; it is not established as the primary failure.

Shared-local249+, production259+, production promotion, provider/AI/billing,
account/plan changes and admission/home/page/cohort/cutover activation remain held.
This source-only document grants no execution authority and no new trial/retention
or subscription behavior.
