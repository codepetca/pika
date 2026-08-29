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

This started as a code-inspection pass. The P1 and P2 findings have since
been implemented and browser-verified; each ranked finding below carries its
own **Status**. Rows in the per-workflow table describe the state *after*
that work. Anything still marked deferred or unverified says so explicitly.

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
| Today (daily journal) | `StudentTodayTab` | Full — converted to `Card`. The "No past logs yet" row stays a compact inline row on purpose (see the P2 correction) | History list has no mobile-specific treatment, just stacks. Save status *is* announced: `SaveStatus` bakes in `role="status" aria-live="polite" aria-atomic="true"` |
| Assignments | `StudentAssignmentsTab`, `StudentAssignmentEditor` | Full on the tab; editor is dense (1,798 lines, one coordinator) but already responsive (`md:flex-row`/`md:hidden` history rail split at `StudentAssignmentEditor.tsx:1493-1575`) | Mobile workspace mode is stacked-by-default rather than an explicit mode switch; matches the roadmap's "deferred mobile workspace modes" note |
| Tests + results | `StudentTestsTab`, `StudentTestForm`, `StudentTestResults` | Full page-state handling; accessible save/flag live regions in `StudentTestForm`; compact exam mode below `lg` | Still one large coordinator (~2,000 lines). The non-exam list and results were already fine on narrow screens; the exam shell now switches panes rather than stacking |
| Surveys | `StudentSurveyPanel` | Full (`Card`, live regions) | None. The July "results failure hangs in loading" note is resolved: the results fetch's `catch` sets an explicit `error` state, guarded by request/survey id, rendered as `role="alert"` with Retry |
| Calendar | `StudentLessonCalendarTab` | Full (`PageState`, `PageLayout bleedX={false}`) | Mobile redesign explicitly deferred per roadmap; not independently re-verified here |
| Announcements | `StudentAnnouncementsSection` (+ thin `StudentAnnouncementsTab` wrapper) | Full — announcement items now use `Card padding="sm"` | None found |
| Course Guide / resources | `StudentResourcesTab` → `CourseGuidePanel` (shared with teacher/public) | Delegates entirely to the shared component | None specific to student |
| Class resources sidebar | `StudentClassResourcesSidebar` | Full — `Card` and `Card tone="muted"`; the legacy `shadow-sm` is gone | None found |
| Achievements (Pal) | `StudentAchievementsTab` | Thin wrapper delegating to `@codepet/pal-widget`, with `PageState` error fallback | Not owned by this codebase's design system; out of scope beyond the fallback |
| Attendance history utility | `/student/history/page.tsx` | Full — ready-state body now uses `Card`; the borderless `shadow-sm` blocks are gone | Mobile density still deferred per the roadmap |
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

### P3 — checked, both resolve

**Status:** done, and both notes in the first draft of this review were
wrong or stale.

- `StudentSurveyPanel` does not hang on a results failure. The results
  fetch's `catch` sets an explicit `error` state with a message, fenced by
  request-id and survey-id guards, and renders `role="alert"` with a Retry
  action. The July finding is resolved in current code.
- Today's save status *is* announced. `SaveStatus` (`src/ui/SaveStatus.tsx`)
  carries `role="status" aria-live="polite" aria-atomic="true"` in the
  primitive itself, so every caller inherits it. The first draft's claim that
  it "renders text but isn't wired to `aria-live`" was incorrect.

Neither needed a code change. Both were resolved by reading the primitive
and the state machine rather than trusting the earlier note.

## Where this leaves the student side

Done and verified in this pass:

1. **Compact exam mode for Tests** — the substantive item. Below `lg`, a
   Questions/Documents switch replaces the stacked shell; both panes stay
   mounted so answers survive a swap, and swapping is not logged as an exam
   exit.
2. **Two exam bugs found while building it** — the touch-keyboard lock and
   the desktop grid overflow (see the P1 status above).
3. **`Card` convergence** across Today, Announcements, the resources sidebar,
   and `/student/history`.
4. **The two P3 accessibility/recovery questions**, both of which resolve
   with no code change.

Verification standing behind those: focused unit and component tests, plus
Playwright coverage of the compact exam layout across the existing
desktop/mobile and light/dark projects, plus before/after captures for the
`Card` work at 1440 and 390 in light and dark.

Deliberately not done:

- **`TeacherTestPreviewPage.tsx`** carries the same percentage-track overflow
  that was fixed in the student exam shell. Left to the teacher-surface owner
  to avoid colliding with in-flight work; it is a one-line change.
- **Assignments editor mobile polish** and **aggregate student grades** stay
  exactly where the roadmap already has them — deferred, and pending a
  product decision on disclosure and profile authority respectively. Neither
  was reopened here.
- **A refreshed full student visual-evidence set.** The captures taken here
  were scoped to the surfaces that changed, through fixture routes and a
  temporary local harness, not a seeded run of the whole student matrix.

## Follow-up: remaining visual evidence

The surfaces changed in this pass are browser-verified. What is *not* covered
is a durable, recorded evidence set for the student surfaces that did not
change — Classrooms index, Assignments, and Calendar in particular. Before
declaring the student side "done" the way Attendance is done on the teacher
side, run the matrix in
[`ai-ui-testing.md`](../../guides/ai-ui-testing.md) (desktop/mobile,
light/dark) against seeded data and record it the way
[`design-qa.md`](/design-qa.md) records Attendance. The captures behind this
pass were verification artifacts, not durable evidence: they used mocked APIs
and a scratch harness that is not in the repo.
