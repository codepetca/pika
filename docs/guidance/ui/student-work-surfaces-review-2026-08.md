# Student Work-Surfaces Review (August 2026)

## Purpose

Attendance and Tests are considered stable on the teacher side, and teacher
work continues under the `teacher-work-surfaces` canon
([`teacher-work-surfaces.md`](./teacher-work-surfaces.md),
[`audit-teacher-work-surfaces.md`](./audit-teacher-work-surfaces.md)). This
review does the equivalent pass for the student product: it re-verifies the
Student Workflow Map in
[`product-experience-audit-2026-07.md`](./product-experience-audit-2026-07.md)
against current code, confirms which July P0/P1 findings are actually fixed,
and produces a ranked, back-to-school-oriented punch list.

This is a code-inspection pass, not a new visual-evidence capture. No
`pnpm dev` / local Supabase / Playwright screenshots were taken in this pass —
see [Follow-up: visual verification](#follow-up-visual-verification) before
treating any "looks fine in code" note below as pixel-verified.

Scope: everything under the student role — classroom tabs
(`Student*Tab.tsx`), the classroom index/join flow, and the `/student/*`
utility routes. It does not re-litigate teacher surfaces.

## What's already solid (re-verified against code, not just the July doc)

- **P0 data-loss fix holds.** `StudentAssignmentEditor.handleSubmit`
  (`src/components/StudentAssignmentEditor.tsx:1094-1109`) now blocks
  submission and surfaces a retryable error when the pre-submit save throws,
  instead of submitting stale content. This was the most serious July finding
  and it is fixed.
- **Modal-layer contract is real, not aspirational.** `src/ui/Dialog.tsx`
  (`ContentDialog`, `ConfirmDialog`, etc.) is built on `ModalLayer`
  (`src/ui/ModalLayer.tsx`), which owns focus containment/return, Escape,
  background inertness, and scroll lock. Every student dialog usage
  (assignment instructions, history/restore, test submit confirmation)
  inherits this for free.
- **Page-state discipline is consistently applied.** `StudentAssignmentsTab`,
  `StudentTestsTab`, `StudentLessonCalendarTab`,
  `StudentAnnouncementsSection`, `StudentAchievementsTab`, and
  `/student/history/page.tsx` all use `PageState`/`EmptyState` from `@/ui`
  with distinct `loading`/`error`/`empty` branches and explicit Retry — the
  "failures look like empty states" P1 finding is resolved for these
  surfaces. `StudentTestForm` uses `role="status" aria-live="polite"` for
  save state and `role="alert" aria-live="assertive"` for errors.
- **Toronto date handling is centralized**, not ad hoc (`getTodayInToronto`,
  shared class-day/date helpers used throughout `StudentTodayTab`,
  `StudentLessonCalendarTab`).
- **`/student/history` is on the shared app-navigation shell**
  (`src/app/student/layout.tsx` uses `AppShell` + `AppNavigation`, not a
  bespoke header), matching the Phase 2 shared-navigation goal.
- **Classrooms index and Assignments tab are the cleanest examples of the
  primitive contract**: `PageLayout`/`PageActionBar`/`PageContent`,
  `EmptyState`, `Card tone="panel"`, `RefreshingIndicator`, `ContentDialog`.
  Treat `StudentAssignmentsTab.tsx` as the reference implementation for any
  other student tab that needs summary/detail navigation via search params.

## Per-workflow status

| Workflow | Component(s) | Primitive conformance | Known gap |
| --- | --- | --- | --- |
| Classrooms index / join | `StudentClassroomsIndex` | Full (`PageLayout`, `EmptyState`, `Card`) | None found |
| Today (daily journal) | `StudentTodayTab` | Partial — hand-rolled `bg-surface rounded-lg border` boxes instead of `Card`; "No past logs yet" is a raw paragraph instead of `EmptyState` | Save status not live-announced (`SaveStatus` renders text but isn't wired to `aria-live`); history list has no mobile-specific treatment, just stacks |
| Assignments | `StudentAssignmentsTab`, `StudentAssignmentEditor` | Full on the tab; editor is dense (1,798 lines, one coordinator) but already responsive (`md:flex-row`/`md:hidden` history rail split at `StudentAssignmentEditor.tsx:1493-1575`) | Mobile workspace mode is stacked-by-default rather than an explicit mode switch; matches the roadmap's "deferred mobile workspace modes" note |
| Tests + results | `StudentTestsTab`, `StudentTestForm`, `StudentTestResults` | Full page-state handling; accessible save/flag live regions in `StudentTestForm` | No responsive split-pane handling found in `StudentTestsTab` beyond the exam full-screen fallback (`isMobileBrowserWithoutFullscreen`) — list/detail is desktop-shaped; this is the largest single student surface (1,948 lines) and the least mobile-adapted |
| Surveys | `StudentSurveyPanel` | Full (`Card`, live regions) | None found beyond the July note that results failure could hang in loading — worth a quick re-check live |
| Calendar | `StudentLessonCalendarTab` | Full (`PageState`, `PageLayout bleedX={false}`) | Mobile redesign explicitly deferred per roadmap; not independently re-verified here |
| Announcements | `StudentAnnouncementsSection` (+ thin `StudentAnnouncementsTab` wrapper) | Mostly full; one raw `bg-surface rounded-lg border` card at line 171 instead of `Card` | Cosmetic only |
| Course Guide / resources | `StudentResourcesTab` → `CourseGuidePanel` (shared with teacher/public) | Delegates entirely to the shared component | None specific to student |
| Class resources sidebar | `StudentClassResourcesSidebar` | Raw divs (`rounded-lg bg-surface p-4 shadow-sm`, `rounded-lg border ... bg-surface-2`) instead of `Card`; `shadow-sm` is a legacy elevation value DESIGN.md reserves for overlays | Cosmetic; small file, easy fix |
| Achievements (Pal) | `StudentAchievementsTab` | Thin wrapper delegating to `@codepet/pal-widget`, with `PageState` error fallback | Not owned by this codebase's design system; out of scope beyond the fallback |
| Attendance history utility | `/student/history/page.tsx` | Uses `PageLayout`/`PageState` for load/error/empty, but the ready-state body (roster-style list, entry detail) is built from raw `bg-surface rounded-lg shadow-sm` blocks, not `Card` | Same `Card`-primitive drift as Today/Announcements/sidebar; `shadow-sm` again |
| Grades / profile | returned assignment/test feedback only; no aggregate view | N/A | Explicitly out of scope until product defines an aggregate-disclosure and profile-authority contract (see roadmap Phase 3, item 12) — this is a product decision, not a UI bug |

## Ranked findings

### P1 — resolved

**Status:** done. Student Tests now has a compact exam mode: below `lg` a
Questions/Documents switch shows one pane at a time, both panes stay mounted
so in-progress answers survive a swap, and swapping is not recorded as an exam
exit. Two bugs surfaced while building it and are fixed:

- On a browser that supports the Fullscreen API (Android Chrome), the existing
  mobile fallback did not apply, so an on-screen keyboard shrinking the
  viewport raised the "Window must be maximized" lock mid-typing.
- The desktop split used `lg:grid-cols-[30%_70%]` with `gap-2`, so the tracks
  summed past 100% and the page scrolled horizontally at 1440px. Now fr-based.

The same percentage-track pattern remains in
`src/components/TeacherTestPreviewPage.tsx` and was deliberately left for the
teacher-surface owner.

### P1 — original finding

**Student Tests and the Assignment editor are not mobile-adapted; Tests has
no mobile mode at all.** Every other student surface either already branches
for mobile (`Assignments` editor's `md:` split) or is simple enough that
stacking is fine (Today, Calendar, Announcements). Tests is the largest,
densest student surface (1,948 lines) and is desktop-shaped end to end: no
`sm:`/`md:` branching outside the full-screen exam fallback. Since Tests is
explicitly "done" on the teacher side and used for real assessments, a
student opening a test on a phone or narrow tablet is the one place where the
product genuinely risks looking unfinished for back-to-school. This matches
what the roadmap already names as deferred ("Remaining Tests work is limited
to the deferred mobile navigation treatment") — it is not a new finding, but
it is the single biggest remaining piece of "student work."

### P2 — consistency drift, cheap to fix, not blocking

Four surfaces hand-roll a card-like container instead of using `Card
tone="panel"` from `@/ui`, which is the stable-rule-2 violation pattern
(`stable.md` §2): `StudentTodayTab.tsx` (daily-log box, past-logs box),
`StudentAnnouncementsSection.tsx:171`, `StudentClassResourcesSidebar.tsx`,
and `/student/history/page.tsx`. Two of those also use `shadow-sm`, which
DESIGN.md reserves for overlays/drag/temporary-foreground states rather than
resting content. None of this is a functional bug — it's exactly the kind of
drift the teacher audit called out and converged before declaring Attendance
"done." Converging these to `Card` is a small, low-risk, same-afternoon pass
and is the cheapest way to make the student side visually match the polish
level Attendance/Tests already have on the teacher side.

Correction to an earlier draft of this review: it also recommended replacing
`StudentTodayTab`'s "No past logs yet" line with `EmptyState`. That is wrong.
`EmptyState` renders its own `Card` with an `<h2>`, so using it for an empty
row inside the past-logs card would nest a card in a card and duplicate the
section heading. A compact inline empty row is the correct pattern there;
`EmptyState` stays a page- or region-level primitive.

**Status:** done. `StudentTodayTab`, `StudentAnnouncementsSection`,
`StudentClassResourcesSidebar`, and `/student/history` now use `Card`. Token
mapping is exact where it matters (`rounded-card` == `rounded-lg`,
`p-card-cozy` == `p-6`); list-item boxes moved from `p-4` to `padding="sm"`
(14px), a 2px tightening onto the card scale. Verified with before/after
captures at 1440 and 390, light and dark. The clearest win is dark mode: the
`/student/history` boxes previously carried only `shadow-sm`, which is
effectively invisible on a dark background, so they had no visible boundary
at all; they now have proper borders.

### P3 — worth a quick live check, not a code-visible gap

- `StudentSurveyPanel` results-failure handling was flagged in July as
  possibly hanging in loading; the component now has explicit `role="alert"`
  error rendering, so this looks resolved, but it wasn't exercised live in
  this pass.
- `SaveStatus` on Today (`StudentTodayTab.tsx:672`) renders visible text but
  wasn't confirmed to carry a live region; worth a screen-reader spot check
  alongside the Tests/Assignment save announcements, which already use
  `aria-live`.

## Suggested sequencing for "ready for school, quickly"

1. **Card-primitive convergence pass** (P2 above) — four files, mechanical,
   low risk, immediately makes student surfaces read as finished rather than
   half-migrated. Good candidate for Codex or a quick Claude pass today.
2. **Live visual verification** of Classrooms index, Today, Assignments,
   Tests, and Calendar at desktop/mobile, light/dark, per
   [`ai-ui-testing.md`](../../guides/ai-ui-testing.md) — none of the notes
   above were screenshot-verified, and it's been a month since the last
   recorded student visual evidence in the July audit.
3. **Tests mobile mode** (P1 above) — the substantive remaining work. Scope
   it the same way the teacher canon scoped Attendance: define the mobile
   list/detail (and exam) states explicitly rather than shrinking the
   desktop layout. This is the one item that actually matches "a lot of work
   left to do" — everything else here is finishing touches.
4. Leave **Assignments editor mobile polish** and **aggregate grades**
   exactly where the roadmap already has them (deferred / needs a product
   decision, respectively) — don't reopen those scopes as part of a quick
   pass.

## Follow-up: visual verification

This review did not run `pnpm dev`, seed local Supabase, or capture
Playwright screenshots. Before marking any student surface "done" the way
Attendance/Tests are done on the teacher side, run the matrix in
[`ai-ui-testing.md`](../../guides/ai-ui-testing.md) (desktop/mobile,
light/dark) for at least Today, Assignments, Tests, and Classrooms index, and
record it the way [`design-qa.md`](/design-qa.md) records Attendance.
