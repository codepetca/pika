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

## 2026-08-29 — Combine Daily and teacher Attendance

**Risk profile:** standard application behavior — teacher classroom navigation,
authoritative Attendance commands, responsive operational-table composition,
and existing Daily logs/summary; no schema, migration, hosted configuration, or
student Attendance behavior changed.

- Removed the standalone teacher Attendance destination and composed entitled,
  classroom-enabled Attendance hours, QR/session commands, selected-student
  actions, Check-in, and Present/Late/Absent controls into Daily.
- Preserved Daily date selection, First/Last/ID/Log sorting, resizable columns,
  log hover text, student-log inspection, and the dotted resizable Class Log
  Summary. The summary timestamp now omits “Generated,” uses the existing
  Toronto-relative formatter, and names its action list “Class log follow-ups.”
- Kept the Daily-only state stable when Attendance is unavailable or disabled:
  centered date navigation and a trailing More menu containing only Show/Hide
  ID. Legacy `?tab=attendance` links and new Blueprint classrooms resolve to
  Daily. Daily-log content never infers Attendance.
- Added production-path tests for entitlement/setting composition, status and
  bulk mark commands, session close, QR presentation, sorting, ID removal,
  menu/dialog focus, and preserved Daily split/resize behavior. Stabilized two
  unrelated Test-detail debounce assertions selected by the full dependency
  gate by asserting the immediate mirror update synchronously and holding the
  other assertion's 3-second autosave timer.
- Independent review identified that an accepted Attendance command could stay
  locally pending forever when provider confirmation arrived after the bounded
  foreground poll. Daily now keeps one cancellable background revalidation
  queue until authoritative success or terminal failure, then releases the
  affected controls. Non-retryable check-in invalidations are surfaced through
  the existing per-student failure contract. Request-scoped ownership rejects
  overlapping commands for a still-pending student, and a monotonic view
  generation cancels stale foreground work across A-to-B-to-A date transitions.
  Regression coverage confirms delayed success after the eighth read, terminal
  session failure recovery, overlap rejection, view-generation cancellation,
  non-retryable active-versus-invalidated check-in mapping, and controller-level
  rejection of mark/reset commands for students whose authoritative view still
  reports pending command ownership.
- Final integration review hardened four boundaries: Attendance hours remain
  reachable when the entitlement exists but the policy is disabled or missing;
  a current pending retry takes precedence over retained historical outbox
  failures; long-roster headers stay sticky inside the Daily scroll pane; and
  Escape closes the active action menu, restores trigger focus, and preserves
  the selected Daily log workspace. Direct controller, server-view, component,
  shared-menu, and browser-geometry regressions cover these cases.
- A subsequent cumulative review closed three more integration boundaries.
  The server projection now exposes authoritative session-command ownership so
  remounts cannot submit a duplicate open/close command. Selection and bulk
  mutations are intersected with the current Daily log rows, immediately
  pruning students hidden by a fresher Daily response. The rare QR check-in
  plus manual-override recovery action now stacks below the three 44px status
  targets inside a minimally wider status column instead of overflowing it.
  Focused controller, server-view, component, and browser-geometry regressions
  cover all three cases.
- Visual verification passed Attendance-on, unconfigured Attendance, and
  Daily-only teacher states on desktop/mobile in light/dark, including
  selection, hidden ID, open More menus, the sticky long-roster header, and the
  contained QR-override recovery row. The unchanged student Daily flow also
  passed in all four browser projects.
- Ready-PR CI exposed an action-menu focus race in the existing Tests workspace.
  Tooltip-wrapped icon menus now keep the same trigger mounted while their menu
  is open and suppress only the tooltip through one lifetime-controlled Radix
  state, so a dialog reliably captures and restores focus to its opener without
  an uncontrolled/controlled transition or retained hover state. The full Tests
  workspace file and a shared action-cluster modal round-trip regression cover
  the hosted failure.
- `pnpm check:focused -- --base origin/main` passes: workflow, architecture,
  UI/design policy, 228 changed-path tests, 1,868 related tests, TypeScript, and
  lint. The Pika pre-commit audit passes; the composite-widget checklist is
  covered by direct semantic, keyboard, focus, and resize tests.

**Model recommendation:** GPT-5.6 Terra high for correctness, requirements,
responsive behavior, and compatibility review of the complete PR diff.

## 2026-08-29 — Finalize assignment history exploration and focused previews

**Risk profile:** low — shared teacher/student history visualization and
client-side saved-document comparison only; no API contract, schema,
persistence, authentication, dependency, migration, deployment, or hosted
state changed.

- Replaced fragmented snapshots with one compact complete-history chart across
  actual activity days. Long and dense histories aggregate by day, zoom reveals
  individual saves, vertical wheel input zooms around the pointer, and
  horizontal or Shift-wheel input pans the bounded window with smooth,
  reduced-motion-aware zoom transitions.
- Kept the document at normal reading size while hovering a save and scrolled to
  its earliest changed location. Clicking retains the existing pinned-save
  behavior. Insertions show Added, rewrites show Revised, and deletions leave a
  `Deleted here` anchor.
- Added a narrow, non-interactive whole-document minimap with change marks and a
  viewport box that follows reading scroll. It hides at narrow mobile widths,
  remains absent from the accessibility tree, and a polite status message
  announces change kinds, counts, and document-block locations.
- Bounded adjacent-save matching by precomputing block signatures, capping exact
  LCS work, and using unique patience-style anchors with monotonic gap matching
  for large documents. A one-block move remains exactly one addition plus one
  deletion across the 199–202 boundary and at 1,000/5,000 blocks; the 5,000
  block case completes in about 9–11 ms locally.
- Independent stable-SHA review found and resolved four P2 issues: unbounded
  comparison work, mixed-save focus order, color-only change semantics, and the
  large-reorder threshold edge. Final targeted re-review found no residual
  P0–P2 issues.
- Clarified the UI gallery demonstration after review: its five saves now grow
  from 8 to 20 to 40 sections, and it opens on the mid-project save so the
  minimap visibly ends before the final-document length. The main pane lands on
  Sections 9–11 marked Added, making snapshot-at-that-time behavior immediate.
- Smoothed overview zooming across the full window-size change instead of only
  animating a clamped final step. Daily totals now crossfade into individual
  saves on the same 420 ms easing curve, zoom-out uses the reciprocal scale,
  and wheel zoom waits for the active transition so repeated wheel events do
  not interrupt the motion. Follow-up review caught and removed the remaining
  0.05–20 scale clamp; year-long histories now retain the exact zoom ratio and
  reciprocal dezoom ratio with direct regression coverage.
- Ready-PR CI exposed an unrelated date-boundary failure in the newly merged
  Daily/Attendance browser fixture: its fixed August 29 summary expected a
  relative `Today` label. The fixture now fixes its browser clock to August 29,
  and the affected desktop/mobile light/dark matrix passes 4/4.

**Verification:** the final pre-rebase focused gate passed 77 workflow tests,
179 focused tests, and 571 related tests plus TypeScript, lint, architecture,
UI/design policy, diff checks, and the Pika audit. Playwright covered teacher
and student desktop, student mobile, and dark mode, including hover, pinning,
rewrite/insertion/deletion marks, minimap scrolling, no horizontal overflow,
and no browser errors. The post-rebase exact-SHA gate is rerun before PR handoff.

**Composite-widget accessibility checklist:** checklist reviewed: yes; keyboard
behavior covered: yes; semantic state covered by tests: yes; remaining manual
follow-up: none.

**Model recommendation:** GPT-5.6 Sol for compact time-series interaction,
historical document diffing, viewport coordination, and cross-role visual QA.

## 2026-08-30 — Keep the light Pika favicon in every theme

**Risk profile:** none — root metadata and its focused regression assertion
only; no application behavior, schema, runtime configuration, or role-specific
surface changed.

- Replaced the theme-conditioned light/dark favicon metadata with one
  unconditional `pika-icon-light.svg` declaration so browser color preference
  cannot select the dark asset.
- Updated the existing middleware/favicon regression test to require the light
  icon, reject the dark icon from root metadata, and reject favicon media
  conditions while preserving the static-asset checks.
- Visual verification passed in headed Chrome: the same light mouse icon appears
  in the tab under light and dark color preferences. Playwright DOM checks also
  confirmed the unconditional light SVG on desktop and mobile. Teacher and
  student roles are not applicable because favicon metadata is global browser
  chrome.
- `pnpm check:focused -- --base origin/main` passes in application-browser mode,
  including workflow, architecture, UI/design policy, focused/related tests,
  TypeScript, and lint. The Pika pre-commit audit passes.
- Ready-PR CI exposed an existing Toronto-midnight rollover in the combined
  Daily/Attendance visual contract: a fixed August 29 timestamp was asserted as
  “Today” after August 30 began. The browser assertion now verifies the stable
  `10:10 AM` timestamp inside the summary while unit coverage continues to own
  relative-day formatting. The corrected scenario passed desktop/mobile in
  light/dark; one cold-start desktop fixture race passed on its immediate
  targeted rerun.

**Model recommendation:** current model for this narrow metadata-only visual
fix.

## 2026-08-30 — Add a governed Pattern Lab for consistent AI-built UI

**Risk profile:** none — development-only reference route, AI guidance,
catalog data, and regression coverage; no production data, schema, or runtime
feature behavior changed.

- Replaced the private, data-dependent UI gallery entrypoint with a guarded
  `/pattern-lab` reference that renders deterministic production components.
  The catalog covers stable versus experimental patterns, canonical owners,
  use/avoid guidance, core controls, semantic page states, and role-specific
  teacher/student reference surfaces.
- Added an approved Lucide icon catalog and a semantic status-symbol catalog.
  Icons remain supplemental to accessible names and visible labels; domain
  statuses remain feature-owned unless meaning and behavior genuinely match.
- Added the repository-owned `pika-ui-change` skill and wired it into agent and
  UI guidance. Every UI change now records reuse/extend/create decisions, uses
  the Pattern Lab plus a real product surface, and promotes shared components
  only after two genuine adopters and a durable behavioral contract.
- Added unit/accessibility coverage and deterministic Playwright snapshots for
  teacher/student, desktop/mobile, and light/dark modes. The canonical alert
  dialog interaction is also captured. Nine visual comparisons passed with no
  horizontal page overflow.
- `pnpm check:focused -- --base origin/main` passes: workflow, architecture,
  UI/design policy, focused and related tests, TypeScript, and lint; database
  and browser contracts are selected for final CI. The pre-commit audit passes,
  and its composite-widget test covers named navigation, tabs, segmented
  controls, role-specific references, and dialog open/dismiss behavior.
- Independent review closed three boundaries before ready review: production
  now rejects the route even if gallery/fixture flags are set; the Tabs example
  owns explicit tab-to-panel relationships and demonstrates arrow-key focus and
  selection; and remaining `/__ui` documentation now points to `/pattern-lab`.
- Targeted re-review kept both controlled tab panels mounted so every
  `aria-controls` target remains valid in either selection state, with direct
  regression assertions before and after keyboard selection. It also removed
  the obsolete Vercel-preview recommendation now that Pattern Lab is explicitly
  local/non-production only.
- Ready-PR CI confirmed Test & Build and all pre-existing browser contracts,
  then exposed that the new snapshots only had macOS baselines. The nine
  CI-generated Linux baselines were retrieved from browser diagnostics,
  visually reviewed, and added alongside the macOS set. The PR returned to
  draft before this correction; the database job completed every contract step
  but was canceled during cleanup by that draft transition.
- Final authorization review removed the teacher-only Snapshot gallery from
  student reference surfaces while preserving the teacher catalog. Catalog,
  rendered-UI, and browser assertions now enforce that boundary. Updated
  desktop/mobile light/dark baselines were visually approved on macOS and from
  stable GitHub Linux captures; the diagnostic browser run passed 94 existing
  scenarios and failed only the four intentionally stale student snapshots.

**Model recommendation:** GPT-5.6 Terra medium for a low-risk UI governance,
test, and documentation consistency review.

## 2026-08-30 — Development-speed remediation audit at 30 natural attempts

**Risk profile:** workspace-state — CI evidence audit and a browser-test clock
fixture; no product behavior, schema, migration, dependency, or enforcement
change.

- Ran the approved post-remediation audit after 30 completed natural CI attempts
  following 2026-08-29T16:09:56Z. Exact `pnpm measure:ci -- --limit 30` output:

```text
failed to get run: Get "https://api.github.com/repos/codepetca/pika/actions/workflows/217397176": read tcp 172.16.30.1:59640->140.82.114.5:443: read: operation timed out
{
  "sampleSize": 30,
  "successfulSampleSize": 7,
  "counts": { "cancelled": 1, "failure": 3, "skipped": 19, "success": 7 },
  "cancellationRate": 0.03333333333333333,
  "cancelledElapsedSeconds": 355,
  "successfulQueueSeconds": { "min": 0, "p50": 0, "p95": 0, "max": 0, "average": 0 },
  "successfulRunSeconds": { "min": 448, "p50": 464, "p95": 482, "max": 482, "average": 467 },
  "successfulWallSeconds": { "min": 448, "p50": 464, "p95": 482, "max": 482, "average": 467 },
  "successfulRunsWithoutPrGateEvidence": 1,
  "prGateByMode": {
    "application-browser": {
      "sampleSize": 2,
      "timeToGateStartSeconds": { "min": 445, "p50": 477, "p95": 477, "max": 477, "average": 461 },
      "gateRunSeconds": { "min": 2, "p50": 3, "p95": 3, "max": 3, "average": 3 },
      "timeToGatePassSeconds": { "min": 447, "p50": 480, "p95": 480, "max": 480, "average": 464 }
    },
    "full": {
      "sampleSize": 4,
      "timeToGateStartSeconds": { "min": 459, "p50": 466, "p95": 478, "max": 478, "average": 466 },
      "gateRunSeconds": { "min": 2, "p50": 4, "p95": 4, "max": 4, "average": 3 },
      "timeToGatePassSeconds": { "min": 461, "p50": 469, "p95": 482, "max": 482, "average": 469 }
    }
  }
}
```

- Passes: cancellation rate is 3.3% (<10%); full-mode PR Gate p50 is 469
  seconds (<480); all 19 draft runs were inspected individually and contained
  no non-skipped jobs; the sole cancellation was a superseded PR attempt, not a
  duplicate dispatch. All seven successful runs have a PR Gate; the one missing
  measurement evidence was the transient GitHub API timeout above, and direct
  rechecks proved five full and two application-browser gate modes.
- The two application-browser and five full successes selected their expected
  browser/database dependencies. Failed browser lanes caused PR Gate to fail,
  never to skip. Existing strict `PR Gate` rulesets, unknown-path fail-closed
  classification, two-worker combined browser workflow, artifact upload, and
  canonical production-promotion behavior remain unchanged.
- Documentation-only mode did not occur in this post-remediation sample, so its
  under-two-minute target is not newly evidenced here (the prior audit measured
  53 seconds). No production-promotion attempt occurred in this window.
- The checkpoint nevertheless fails browser stability: runs 33293971804 and
  33295218351 each exhausted all retries of the new Daily/Attendance browser
  case because the fixture asserted `Today 10:10 AM` for a fixed
  2026-08-29 timestamp after the calendar advanced. The third failure was an
  unrelated Test-detail focus assertion. Preserve enforcement; remediate the
  deterministic Daily/Attendance fixture within the approved speed program.
- Freeze that browser test's clock at 2026-08-29T14:15:00Z before navigation so
  the Toronto-relative fixture label remains deterministic. Targeted local
  browser verification passes all four viewport/theme cases first try (6/6
  including auth) in 18.7 seconds.

**Verification:** targeted Daily/Attendance Playwright matrix (6/6), focused
application-browser checks (77 workflow tests, architecture/UI/design policies,
TypeScript, lint), and diff validation pass. Final CI/review remains pending.

**Model recommendation:** GPT-5.6 Terra high for the bounded browser-fixture
stability review; no broad product or CI-policy redesign is indicated.

## 2026-08-30 — Tween history zoom through the actual time window

**Risk profile:** low — client-side motion refinement in the shared
teacher/student history chart only; no API, persistence, authentication,
dependency, migration, or deployment behavior changed.

- Replaced the SVG scale transform with a frame-by-frame tween of the chart's
  actual visible start and end times. Bars now move continuously between the
  complete-history overview and the focused save window in both directions.
- Synchronized the daily-to-save crossfade and vertical character scale with
  the same symmetric easing curve. Hover no longer interrupts an active zoom;
  click-to-pin, keyboard selection, wheel zoom, horizontal pan, and the reduced
  motion instant path remain intact.
- Added deterministic animation-frame tests covering pointer-anchored zoom,
  midpoint interpolation, reciprocal dezoom, year-long histories, interruption,
  click locking, and reduced motion, plus pure easing/window interpolation tests.
- Independent review found three P2 transition-boundary issues in hover, click,
  and pan handling. One remediation batch keeps hover live against the rendered
  layer, pins the exact visible save or day, and retargets a mid-tween pan from
  the on-screen window without snapping. Direct regressions cover all three.
- Visual verification passed for the shared teacher and student examples at
  desktop and mobile widths, including captured zoom/dezoom intermediate frames
  and a long six-week history. Browser console errors: none. Dark mode is n/a
  because Pika does not currently expose a dark theme.
- `pnpm check:focused -- --base origin/main` passes: 77 workflow tests, 184
  focused tests, 576 related tests, TypeScript, lint, architecture, UI policy,
  and design policy. The Pika pre-commit audit passes.

**Composite-widget accessibility checklist:** reviewed: yes; semantic slider
state and keyboard selection remain covered by component tests; click selection
during tween is covered; reduced motion is covered; remaining manual follow-up:
none.

**Model recommendation:** GPT-5.6 Terra high for animation-state correctness,
interaction interruption behavior, and shared teacher/student compatibility.

## 2026-08-30 — Restore version context after discarding the separate zoom task

**Risk profile:** low — shared teacher/student history presentation and
interaction only; no API, persistence, authentication, dependency, migration,
or deployment behavior changed.

- Stopped the overlapping Smooth history zoom task and reverted only its three
  commits, returning the product tree exactly to the existing tween baseline.
- Added a compact chart context label: exact date, time, and character change
  for individual saves; date and daily addition/deletion totals in overview.
  Hover context clears on leave, while click-to-pin keeps the selected context
  visible. Large totals wrap within the 240 px student chart.
- Focused regression coverage passes 76/76 across the history graph, history
  utilities, assignment-history helpers, and gallery fixtures.
- Visual verification passed for teacher and student views, desktop/mobile
  widths, hover and pinned states, daily and exact-save labels, and dark mode.
  Browser console errors: none.

**Composite-widget accessibility checklist:** reviewed: yes; the visible label
is supplemental to the existing complete slider value text, keyboard behavior
is unchanged, and the label is hidden from the accessibility tree to avoid
duplicate announcements; remaining manual follow-up: none.

**Model recommendation:** GPT-5.6 Sol for branch-conflict recovery, scoped UI
rollback, history interaction correctness, and cross-role visual QA.

## 2026-08-30 — Add Daily relative-date context and stronger light header

**Risk profile:** none — teacher-only Daily presentation and pure date-label
formatting changed; no persistence, API, schema, Attendance commands, or student
behavior changed.

- Added a compact muted subtitle inside the Daily date selector for past dates:
  Today, Yesterday, elapsed days, weeks, months, or years. Forward dates keep
  the selector single-line, while configured Attendance context remains in the
  action bar's left slot.
- Gave the Daily table header a stronger light-theme surface using the existing
  `surface-3` token. The token resolves to the prior header value in dark mode,
  preserving the approved dark appearance.
- Added boundary coverage for every relative-date unit, future-date omission,
  action-bar updates while navigating, and the Daily-specific header surface.
- Independent follow-up review caught and fixed a shared `DateNavigator`
  regression: joined static labels without subtitles retain flex centering for
  Calendar's All-dates state, with direct regression coverage.
- Visual verification passed the teacher desktop/mobile light views, teacher
  desktop/mobile dark views, and unchanged student mobile view. The small
  subtitle remains legible without increasing the action bar's control height.

**Verification:** focused Daily/date tests; `pnpm check:focused -- --base
origin/main`; exact-branch Playwright teacher/student desktop/mobile captures;
browser console check; Pika audit; `git diff --check`.

**Model recommendation:** current model for this bounded teacher Daily context
and semantic-surface refinement.

## 2026-08-30 — Add Daily relative-date visibility preference

**Risk profile:** low — teacher-only local presentation preference; no API,
schema, Attendance command, or student behavior changed.

- Added a persistent Hide relative date / Show relative date toggle to Daily
  More actions, following the existing ID-column preference pattern.
- Hiding the subtitle preserves the established date selector layout and date
  navigation; reopening Daily restores the teacher's preference.
- Added component coverage for hide, persistence, and restore, plus browser
  coverage across teacher desktop/mobile and light/dark variants.
- Visual verification passed for the open menu and hidden selector states on
  teacher desktop/mobile in light/dark themes; the student view is unchanged.

**Verification:** focused Daily/date tests; targeted Daily Playwright matrix
(6/6 including auth); repository UI verification captures; Pika audit; focused
gate; `git diff --check`.

**Model recommendation:** current model for this bounded Daily preference.

## 2026-08-30 — Balance standalone teacher action-bar spacing

**Risk profile:** low — shared teacher work-surface presentation only; no
business logic, persistence, API, schema, or student behavior changed.

- Added the compact content-top spacing token above standalone teacher action
  bars. Together with the context bar's internal padding, this creates the same
  12px visual rhythm above and below the controls and matches page side gutters.
- Kept attached-tab shell behavior unchanged and added direct shell coverage
  for standalone summary and workspace states.
- Visual verification passed Daily, Classwork, Tests, Gradebook, and Roster on
  teacher desktop/mobile, plus a dark-mode Daily spot check and unchanged
  student baselines.

**Verification:** TeacherWorkSurfaceShell, Daily, and Classwork component tests;
repository UI verification across all five consumers; focused gate; Pika audit;
`git diff --check`.

**Model recommendation:** current model for this shared spacing refinement.

**Review follow-up:** independent cumulative review identified that the Daily
date button's explicit accessible name masked its new subtitle. Linked the
subtitle with a stable `aria-describedby` ID and added accessible-description
coverage for both shown and hidden states. The full focused gate remains green;
the correction does not change visual styling or the existing control name.

## 2026-08-30 — Reconcile Pattern Lab with merged teacher refinements

**Risk profile:** none — development-only examples and merge integration; no
new production behavior, schema, dependencies, or stable-guidance promotion.

- Integrated main through `16ec69ea` (Daily date context and standalone spacing),
  preserving the concurrently merged history-preview gallery from PR #1089.
- Added real-owner teacher examples for DateNavigator, the context bar,
  standalone shell spacing, and attached workspace modes. Catalog entries are
  family-scoped; no new shared component was extracted. Fixed fixture dates,
  temporary controls, and mounted tabpanel targets keep the examples reproducible.
- Kept Daily's saved preference, stronger table-header treatment, commands, and
  status meanings feature-owned. Existing icon/status guidance is unchanged.
- Reconciled the `/ui-gallery` compatibility route with the guarded Pattern Lab
  owner; preserved teacher/student history-preview interaction coverage.
- Visual review refined the Lab's embedding margins without altering shared
  owners. Composite checklist reviewed; date descriptions, toggle semantics,
  keyboard focus, panel relationships, and student isolation are tested.

**Verification:** focused gate passed (77 workflow, 261 focused, 807 related
tests, architecture/UI/design policy, TypeScript and lint); final targeted suite
19/19; Pattern Lab browser matrix 13 passed / 3 intentional dialog skips with
unchanged existing baselines. Teacher examples captured in desktop 1440x900 and
mobile 390x844, light/dark, default/hidden-subtitle/future/selected-focus states.
Repository screenshot procedure also run with explicit teacher/student fixture
roles. New captures are local review evidence, not promoted visual baselines.

**Checkpoint:** user visual approval is pending. PR #1124 remains draft;
independent review of this reconciliation and fresh final CI follow acceptance.
No merge authorized or performed. No new reviewer launched this turn.

**Model recommendation:** current coding model for implementation; one bounded
Terra review of the new integration scope after the visual checkpoint.

## 2026-08-30 — Clarify Daily-only relative-date scope

**Risk profile:** none. **Model recommendation:** current coding model for
this bounded Pattern Lab wording correction.

- Per user clarification, labeled the relative-date example page-specific and
  explicitly prohibited copying its relative-date text to other pages. The
  shared catalog now describes only date-navigation structure, spacing, and
  accessible labels. No production component or interaction changed.
- Added scope regression assertions. Focused gate passed (77 workflow and 20
  Pattern Lab tests, related tests, policies, TypeScript, lint). Browser matrix
  passed 13/13 with 3 intentional skips and unchanged baselines; inspected the
  updated desktop/mobile light/dark wording. Existing composite behavior and
  student isolation remain covered.
- Explained the future correction workflow: identify local drift versus a
  shared-owner issue versus a proposed design change; show before/after; update
  Pattern Lab, guidance, and reviewed baselines only where the approved contract
  actually changes. Visual approval, independent review, and final CI remain
  pending; PR #1124 stays draft.

## 2026-08-30 — Enforce stable-SHA PR Gate launch

**Risk profile:** runtime-platform — GitHub Actions admission policy and its
workflow contract only; no product behavior, schema, dependency, secret, or
branch-ruleset change.

- Ran the approved post-#1125 audit after 25 completed natural CI attempts
  following 2026-08-30T15:49:02Z. Exact `pnpm measure:ci -- --limit 25` output:

```text
{
  "sampleSize": 25,
  "successfulSampleSize": 5,
  "counts": {
    "cancelled": 9,
    "skipped": 11,
    "success": 5
  },
  "cancellationRate": 0.36,
  "cancelledElapsedSeconds": 892,
  "successfulQueueSeconds": {
    "min": 0,
    "p50": 0,
    "p95": 0,
    "max": 0,
    "average": 0
  },
  "successfulRunSeconds": {
    "min": 467,
    "p50": 479,
    "p95": 518,
    "max": 518,
    "average": 483
  },
  "successfulWallSeconds": {
    "min": 467,
    "p50": 479,
    "p95": 518,
    "max": 518,
    "average": 483
  },
  "successfulRunsWithoutPrGateEvidence": 0,
  "prGateByMode": {
    "full": {
      "sampleSize": 5,
      "timeToGateStartSeconds": {
        "min": 464,
        "p50": 474,
        "p95": 513,
        "max": 513,
        "average": 479
      },
      "gateRunSeconds": {
        "min": 2,
        "p50": 2,
        "p95": 4,
        "max": 4,
        "average": 3
      },
      "timeToGatePassSeconds": {
        "min": 466,
        "p50": 478,
        "p95": 517,
        "max": 517,
        "average": 482
      }
    }
  }
}
```

- The full-mode p50 remains within target (478 seconds), but the checkpoint
  fails cancellation rate: 9/25 (36%). Eleven draft runs skipped every job;
  the five successes all produced `PR Gate` evidence. There was no fresh
  docs-only or production-promotion run, so those targets remain unevidenced.
- Each cancellation was inspected. Eight launched or queued on the same ready
  PR #1089 while successive commits and reverts were pushed; seven cancelled
  already-running Test & Build, browser, and database lanes, consuming 892
  seconds total. The remaining cancellation was draft-skipped. The two manual
  dispatches were separate exact-head full runs and did not overlap eligible
  pull-request runs.
- Preserve all safety lanes and branch rulesets. The bounded remedy admits
  heavy lanes only for `ready_for_review` or deliberate `workflow_dispatch`.
  A ready-PR push now runs only the lightweight required `PR Gate`, which fails
  with instructions to return to draft before pushing and mark the stable
  reviewed SHA ready again. This prevents skipped checks from satisfying branch
  protection and makes the documented lifecycle mechanically enforceable.

**Verification:** CI workflow contract (4/4), workflow suite (77/77), focused
full-mode checks (workflow, architecture, UI/design policy, TypeScript, lint),
Pika audit, and diff validation pass. Independent review and exact-head CI are
pending.

**Model recommendation:** GPT-5.6 Terra high for CI admission and protected
branch-safety review; no product-domain review is needed.

## 2026-08-30 — Prepare final Pattern Lab integration review

**Risk profile:** none for the remaining development-only UI reconciliation.
**Model recommendation:** GPT-5.6 Terra/medium for one bounded final integration
review, with at most one follow-up launch inside the remaining review budget.

- User authorized final independent review and CI for PR #1124, not merging.
- Integrated main through `61ec4bbf`, preserving its stable-SHA CI admission
  workflow and both sides of the session-history conflict. No product source
  changed in this sync; Daily-only relative-date scope remains intact.
- Existing local UI checks passed at `471020c2`; the final integrated revision
  receives refreshed focused checks before ready-for-review. Review results and
  exact-head CI evidence will be recorded on the PR so evidence does not require
  an unreviewed post-review commit.
- Ledger carried forward: 6 earlier reviewer launches and 4 remediation batches;
  this checkpoint allows at most 2 additional launches and 2 remaining batches,
  20 minutes per reviewer, and 45 minutes for the review session. The integration
  preparation is not remediation of a reviewer finding.

## 2026-08-30 — Focused check and agent workflow efficiency

- Combined workflow, changed, and related test selection in one native Vitest run; successful checks now print summaries/timings with full private temporary logs and complete failure output.
- Added opt-in startup context reuse while retaining environment/current-state checks; documented single-writer handoff, detached reviewer checkouts, evidence reuse, and compact context in the canonical workflow.
- Measured date-helper case: old runs executed 14 + 292 tests; combined selection retained the identical 292 unique cases in 21 files. One local sample took 9.94s versus 7.97s; not a general speed guarantee. Startup output was approximately 20 KB versus 5 KB when guidance was already loaded.
- Native two-project selection, standalone/space-containing paths, failure propagation, dry-run, invalid workflow/base, and startup-verification regression checks passed. No CI topology, application behavior, coverage threshold, dependency, model default, or migration changes.

## 2026-08-30 — Sync Pattern Lab after PR #1128

- Integrated `origin/main` at `e1f4fb61` into PR #1124; resolved only the archive conflict while preserving both histories. Developer-tooling changes apply unchanged; no `src/` or `e2e/` changes from the previously reviewed `976b958d`.
- This task remains sole writer for `codex/pattern-lab-governance`. Returned the PR to draft before updating; refreshed focused checks, targeted integration review, and exact-head CI evidence will be recorded on the PR without post-review commits.
- Risk profile: none (tooling/history integration). Model recommendation: GPT-5.6 Terra/medium for one bounded fixed-commit review in a separate detached checkout. Ledger: 7 prior launches and 4 prior remediation batches; at most 1 launch remains. Merge approval is still outstanding.

## 2026-08-31 — UI consistency approach (read-only review)

Reviewed DESIGN.md, stable/family UI guidance, Pattern Lab catalog and fixtures, committed Pattern Lab visual evidence, and current product-experience progress. Recommended a page/role/state adoption matrix, family-scoped reference compositions, a Roster pilot, and incremental visual/interaction verification. No product code changed; no fresh live page audit performed. Next: baseline active routes and approve missing family patterns before implementation.

## 2026-08-31 — Reference-page audit and local preview

Started local Pika preview at localhost:3000 with the governed launcher and seeded local accounts. Captured Student Tests list/submitted detail, teacher Daily unselected/selected, and live Pattern Lab teacher examples. Initial findings: test Closed labels hide submitted progress; Daily first names truncate in current width configuration; Lab lacks complete source-page state examples. Preliminary audit and eight screenshots saved under the task visualization directory, pika-reference-audit/audit.md. No product code changed. Next: agree one small source-page preview before broader adoption.

## 2026-08-31 — Relative-date clipping local preview

Fixed clipped descenders in both DateNavigator subtitle render paths by restoring 16px line height. Local Daily/Lab preview updated, 44px control retained. Six component tests and four Pattern Lab browser matrix checks passed; all default captures reviewed; UI/design policy pass. Evidence: task visualization relative-date-fix/brief.md. Local preview on codex/fix-relative-date-descenders; awaiting visual acceptance before publishing.

## 2026-08-31 — History timestamp local preview

Extended shared HistoryGraph so hover/selected context shows only Toronto date/time below the chart, with a reserved line to prevent hover layout shifts. Removed overlay and character-count summary; kept detailed accessible slider labels and existing selection behavior. Updated Pattern Lab explanation and existing semantic tests. All 27 HistoryGraph tests, UI/design policy, and diff checks pass. Playwright verified both authenticated roles at desktop/mobile sizes in light/dark, with hover, pin, keyboard, clear and daily overview checks; screenshots visually reviewed. Evidence: task visualization history-tooltip-fix/brief.md. Local preview only, preserving relative-date fix; not published.

## 2026-08-31 — Stack history date above time

Refined the local HistoryGraph preview per user request: date on the first line, time below, both beneath the graph. Reserved two lines to avoid hover shifts; shared owner and existing interactions retained. All 27 component tests and UI/design policies pass. Playwright repeated both roles, desktop/mobile, light/dark with two-line, no-overlap, stable-layout, pin/keyboard/clear and daily-overview checks; screenshots reviewed. Evidence: task visualization history-tooltip-fix/stacked. Local only, not published.

## 2026-08-31 — Prepare UI fixes PR and authorized main merge

User authorized PR and merge of the relative-date descender fix and stacked history timestamp. Sole writer: current task on codex/fix-relative-date-descenders. Risk profile: none (localized UI presentation); no API, schema, dependency, or permission changes. Model recommendation: GPT-5.6 Terra/medium for one independent fixed-commit review. Ledger starts at 0 launches and 0 fix batches; limits 5 launches, 3 remediation batches, 45 minutes total and 20 minutes per reviewer. Existing visual evidence covers DateNavigator's four-project matrix and history's eight role/viewport/theme combinations, including hover/pin/keyboard/clear. Removed incidental gallery explanatory-copy edit; Pattern Lab still renders the changed production components directly. Focused checks, independent review and exact-head CI follow; results will be recorded on the PR without post-review commits.

## 2026-08-31 — Codepet Labs Daily attendance diagnosis

Read-only browser inspection found Daily on Aug 29 with disabled row selection; the attendance dialog shows 09:00–10:00 with automatic hours enabled. Class Days ends Aug 29, with Aug 30–31 disabled. Today's Daily also has no session hours. Source confirms saving timing syncs only today through 90 days ahead, while Daily displays occurrence hours and permits selection only for open/closed sessions. No future eligible class days remain, and saving does not backfill historical sessions; the Set attendance hours label obscures this distinction. Restored the user's Aug 29 view; no app code, classroom settings, attendance records, or hosted state changed. Next: clarify whether the user needs historical manual attendance or an extended/new class schedule before implementing or mutating anything.

## 2026-08-31 — Confirm existing future attendance scheduling

User paused proposed historical changes and asked to confirm the current one-range-per-classroom future check-in behavior. Verified the classroom-keyed policy, save-triggered 90-day sync, scheduled-class-day filtering, Toronto/DST materialization, QR opening/closing offsets, roster-before-schedule delivery, and rolling daily automation. Eight focused suites passed, 46/46 tests; these use local mocks/contracts and do not prove a fresh hosted delivery. Forward scheduling already supports the clarified future-only requirement; historical selection is separate and no implementation is authorized or needed for this confirmation. No production commands or settings changes performed.

## 2026-08-31 — Future-course reliability scope clarified

User explicitly excluded Codepet Labs historical attendance and wants future-course reliability only. Existing entitlement mode admits new active classrooms for an entitled teacher; hours must be configured independently per classroom. Four additional access/student/readiness suites passed, 26/26 (72 relevant tests total with prior unchanged checks). The aggregate-only production readiness command using the canonical local env failed its target guard before database access; no target override attempted. Fresh new-classroom save isolation and actual Bara schedule/student check-in remain live verification gaps, not established defects. Need explicit authorization for dedicated production test setup before creating a future-dated test course or recording a test check-in. No product implementation or hosted mutations.

## 2026-08-31 — Authorized future-course production test setup

User approved a dedicated production classroom and test-student check-in. Created Attendance verification — 2026-08-31 for September 2026 only through signed-in teacher UI. The whole-month August–September attempt was rejected before execution; switched to the materially safer verified September-only range. Saved automatic 09:00–10:00 Toronto hours, QR open/close offsets 0, Present grace 5 minutes, Absent offset 0. Sep 1 and Sep 2 both display the same hours, but UI says Last confirmed, so this is not proof of Bara acknowledgement. No test student enrolled or check-in performed; requested user sign in an authorized test student in the in-app browser. Automatic opening cannot yet be checked before Sep 1 09:00. Local configured database/origin/credentials are not production and were not overridden. Existing real classrooms untouched. Browser handoff remains on Sep 1; no code, flags, entitlements, migrations, manual session-open, or recovery commands changed. Test classroom retained, not archived/deleted; no follow-up automation created. Detailed handoff is in the task visualization directory.

## 2026-08-31 — Test enrollment confirmed

User reported joining the dedicated production test classroom. Teacher roster confirms one student named Test Attendance. Separate in-app browser is signed out; opened its login and asked user to sign in, without reading credentials. Teacher page changed during inspection because the user was editing attendance timing; left the form untouched and warned that changing hours does not add Aug 31 to the Sep-only calendar. No attendance commands, records, or settings changed by this task. Live delivery, automatic opening, and student check-in remain unverified; no follow-up automation exists.

## 2026-08-31 — New classroom saved hours but production delivery fails

User created Manual Attendance verification (e2e60420-a6af-4a31-adb7-dca6867da631), joined as Test Attendance, and reported a clock icon and missing student prompt. Read-only teacher inspection confirmed persisted 14:00–15:00 Toronto policy, automatic enabled, QR offsets 10 minutes. Daily initially selected Aug 28; clock-only display reflects missing occurrence for that historical date, not rejected policy. Navigated to Aug 31: QR window 13:50–14:50 exists, but Last confirmed and Open QR check-in indicate no confirmed open session. Student notice requires an actual open projection. Signed-in Vercel Logs show production POST /api/teacher/attendance/sync failing at 13:58:34 with BaraAttendanceClientError remote_rejected, retryable true, remote status 500; an earlier 13:55:45 attempt reports delivery_pending. Logs establish a live delivery failure, but do not yet explain Bara's internal error or expose classroom-specific POST bodies. No manual open, retry, policy save, settings, attendance records, deployments, or code changes performed. Left teacher Daily on today and retained the filtered log tab. Next diagnosis is Bara-side request/error tracing; prior mock tests do not establish live future-course reliability.

## 2026-08-31 — Bara roster failure isolated; two-fix plan prepared

User requested both fixes. Implementation startup passed and linked the worktree to the canonical local env. Bara's read-only production logs identify the matching 17:58:35Z failure as an ambiguous Pika tenant organization mapping, before roster or schedule acceptance. Bounded production reads found no installation-tenant or integrated-roster mappings but an existing Pika-named organization. Do not adopt an organization by slug alone. Proposed collision-safe new organization creation with isolation/idempotency regressions, plus classroom-policy-based Daily hours with separate selected-date status. Required startup plan approval requested asynchronously; no implementation yet. UI brief and validation matrix are in the task visualization directory's attendance-fix-plan.md. No production mutation, recovery, deployment, manual attendance action, or Bara worktree change. Log streams stopped after diagnostic reads.

## 2026-08-31 — Production conflict traced to August 28 cleanup

User requested deeper read-only investigation and discussion before a fix. Archived task Design Attendance Timing Rules (01a04930-92c8-70b3-aa4e-327ea49e8952), cleanup turn 01a04a20-0ad2-7d32-a9a2-97b77e16dcbb, records authorized production legacy-state removal on August 28. Its successful empty-import loop explicitly cleared pika_installation_tenants along with integrated roster/schedule state. It left organizations/auth identities intact. Current bounded production reads confirm the Pika organization retains one staff and three student memberships, while the installation-tenant and integrated scheduling tables are empty. Provisioning sees no mapping, tries the occupied deterministic slug, and throws the exact production error before roster/schedule delivery. Normal provisioning creates organization and mapping together; inspected retention does not remove that link. The documented signed smoke explicitly cannot test provisioning or scheduling, so it did not establish end-to-end recovery.

Supersedes prior duplicate-workspace proposal: prefer audited restoration of the existing ownership link after exact installation/tenant verification, preserve memberships, then use supported current/future delivery recovery. A matching slug alone is not sufficient ownership proof. Revised local plan includes backup/preconditions, idempotent bounded repair, no historical backfill, independent saved-policy display fix, cleanup invariants, actionable sync status, and a genuine production teacher-to-student canary. Exact deleted mapping tuple still requires proof before any repair. No app code or hosted data changed; no recovery, deployment, or migration performed. Production approval remains outstanding.

## 2026-08-31 — Prepare classroom-owned hours and scoped connection recovery

Active goal: reliable future-course attendance, with separate exact approval required for production repair, deployment and canary mutations. Sole writer owns Pika codex/daily-checkbox-investigation and paired Bara codex/attendance-tenant-repair. Risk: workspace-state plus high-risk tenancy recovery. Production installation configuration and retained identities agree; the deleted historical tenant association still needs independent evidence or an explicit owner decision.

Daily now reads the saved classroom policy independently of the selected date and QR entry offsets, shares strict decoding/cache with the timing dialog, and ignores stale classroom/opening/save responses. Last-save delivery warning is separate from saved hours and does not claim later worker retries are still failing. Sync acknowledgement requires a validated schedule result. Archived occurrence display remains read-only without calling the active-policy endpoint. Regression coverage includes past/current/future dates, wrong classroom, late reads, reopen during save, malformed acknowledgement, read failure and retry. Live Pattern Lab reference and teacher/student desktop/mobile light/dark captures verified existing layout; the four-project saved-hours flow covers Aug 28, Sep 1, dialog, delivery failure, read failure and keyboard focus return.

Paired Bara work adds disabled-by-default internal exact-scope inspection/repair with bounded retained identity checks, evidence digest, atomic mapping/audit insertion, idempotent replay and cleanup/retention safeguards. Bara 199 tests, typecheck, lint and build pass. Pika focused checks passed 208 tests plus architecture/UI/design/type/lint; 14 final browser checks passed across teacher/student and saved-hours flows. Plan/evidence live in this task's attendance-fix-plan.md artifact. Drafts are Pika #1134 and Bara #54. Initial Sol/Terra review completed: fixed Escape/backdrop dismissal during pending save with deferred persistence/delivery and four-project browser regressions; clarified the privileged Convex CLI recovery procedure after official docs and installed CLI code disproved a claimed internal-function invocation blocker. One correction batch; targeted/final review and exact-head CI remain required. No production changes, migration application, delivery recovery or attendance check-in performed.

## 2026-08-31 — Match and enlarge Classwork creation dialogs

Task Resize classwork creation modals owns codex/classwork-creation-modal-size. Extended CreationModalShell with opt-in 90dvh height and a non-scrolling footer; reused it for materials and expanded assignment/material editors. Other creation shells retain content-driven sizing. Assignment actions stay above the scrolling form; material actions stay below it. No business logic, dependencies, schema, or permissions changed (risk profile none). Pattern Lab includes a deterministic shell example; no new stable design pattern or unrelated refactor. Component tests cover sizing, footer placement, focus containment/return, and the gallery example. Playwright verified teacher desktop 1440x900 and mobile 390x844 in both themes, empty and long/scrolled content: matching 896x810 desktop and 374x759.6 mobile bounds, visible actions, no horizontal overflow, and keyboard containment/Escape. Student creation is n/a; standard both-role Classwork smoke screenshots also captured. Local evidence: output/playwright/ and /tmp/pika-modal-matrix.log. Focused checks passed; final check, one independent Terra/medium review, and draft-first PR follow. Merge requires user authorization.

## 2026-08-31 — Student Tests local redesign review

- Worktree `/Users/stew/.codex/worktrees/9667/pika`, branch `codex/student-tests-page-review`: progress-first test cards, mobile title wrapping, shared Back/focus return, and explicit detail read recovery. API, data, exam rules, and grading untouched.
- Experimental brief: `docs/guidance/ui/experimental/student-tests-progress.md`; deterministic production-owner examples under Pattern Lab feature patterns. Unrelated date/history fixes left to their owning task.
- Evidence: `/Users/stew/.codex/visualizations/2026/08/31/01a057fb-2a22-7e92-88f4-9d582c079959/student-tests/`. Focused checks: 176 tests plus policy/types/lint; 66 targeted access/exam regressions; four browser combinations; semantic-token contrast passes. Local preview runs on port 3001 with its own worktree build and local Supabase credentials.
- User accepted moving the preview through commit, draft PR, and independent review; leave card/page spacing and active exam workspace unchanged. Merge remains a separate approval; no migration or test-data writes.
- Risk profile: workspace-state. Model recommendation: GPT-5.6 Terra/high for one independent fixed-commit review in a detached checkout. Review budget: five launches, three remediation batches, 45 minutes maximum; final review and CI evidence will be recorded on the PR without changing the reviewed commit.

## 2026-08-31 — Approve Student Tests merge and integrate current main

- User manually verified the student preview and authorized PR review and main merge for #1131. This task remains sole writer of `codex/student-tests-page-review`; no production promotion is authorized.
- Integrated the Classwork-dialog change from current main. Preserved both Pattern Lab examples and both continuity histories; Student Tests application files and existing spacing are unchanged from the reviewed preview.
- Risk profile: none for integration (underlying PR workspace-state). Model recommendation: GPT-5.6 Terra/medium for one targeted fixed-commit integration review; earlier Terra/high behavioral review remains valid. Prior ledger: one review, zero remediation batches. Final focused checks, integration review, and CI will be recorded on the PR without post-review commits.

## 2026-08-31 — Consume published Pal badge-label cleanup

Task owns codex/pal-widget-alpha6. User authorized widget publication and Pika PR/review/main merge; production promotion is excluded. Pinned @codepet/pal-widget 0.1.0-alpha.6 and its registry integrity after Pal #102 merged and the guarded alpha release passed. Reused StudentAchievementsTab and PalWidgetThemeBoundary without host UI/API/schema changes (runtime-platform dependency risk). Regression tests fail against alpha.5 and pass against alpha.6: 25 Pal integration tests verify exact package version, name-only earned labels, focusability, unfinished status, and progress. Playwright inspected the real student achievement component with synthetic local data at 1440x900 and 390x844 in both themes, hover and keyboard focus; final mobile width 390/390, no broken images. Pattern Lab reference inspected; teacher badge surface is n/a. Evidence: /tmp/pika-pal-alpha6-visual.nEY1f9; temporary fixture removed, no authenticated classroom or production-data validation claimed. Focused checks, draft PR, one independent Terra/high fixed-commit review, and exact-head PR Gate follow; record final results on the PR without post-review commits.

## 2026-08-31 — Preview centered creation and page action icons

- Worktree `codex/standardize-page-action-icons`: shared IconButton composes Button/Tooltip; classroom, classwork, test, announcement and blueprint creation entry points use Plus with contextual names. Final form submissions and chooser labels retain text. Classroom-load retry uses RotateCw.
- PageActionBar primary actions/custom center slot use equal side columns; secondary actions use the rightmost More actions menu at every width. Announcements now uses the same centered create/right overflow arrangement. Pattern Lab and UI canon document the user-approved direction.
- Focused checks passed: 134 files / 1,332 tests plus architecture, UI/design, TypeScript and lint. Eight centered-action browser contracts passed across both roles, desktop/mobile and light/dark; screenshots and keyboard/menu/tooltip states inspected. Real classroom and announcement creation entry points verified without creating records.
- Preview runs on localhost:3004; no commit, PR or merge for this new change. Screenshot contract baseline refresh (Darwin/Linux) remains a pre-publication step after visual acceptance. Evidence is in the session visualization folder under `page-action-icons`.

## 2026-08-31 — Inspect Attendance catalog direction

- Audited current combined Daily/Attendance controls, semantic colors, count ownership/sorting behavior, student confirmation semantics and older attendance implementations. Recorded findings in `docs/guidance/ui/changes/status-catalog-audit.md`; catalog implementation awaits the number-only versus icon-plus-count design choice.
- Current direction: green Present, yellow Late, red Absent; rounded tabular-number header pills with contextual tooltips and active-sort rings; click sorts rather than filters; Unmarked has no count chip. Student Checked in stays separate from teacher-derived marks.
- Fixed an incidental regression from this worktree's earlier PageActionBar change: omit an empty trailing flex slot for primary-only bars to remove a 6px left shift. Existing Attendance browser contracts pass 4/4 (desktop/mobile, light/dark); screenshots inspected and saved under session artifacts `attendance-catalog-review`. No business logic, API, schema or permissions changed.

## 2026-08-31 — Confirm number-only status count chips

User chose color-only status count chips: retain colored fills and numeric counts without added status icons. Recorded the decision in the status-catalog audit and operational-table guidance. Preserve contextual tooltips, accessible names, focus and active-sort rings. Documentation only; existing Attendance controls already match this choice. No UI or business behavior changed.

## 2026-08-31 — Render the agreed status examples in Pattern Lab

- Corrected the documentation-only handoff: Controls now visibly includes an interactive Attendance example with production green/yellow/red number-only count chips and row controls, plus actual Classwork/Test status labels and colors. Direct preview: localhost:3004/pattern-lab#status-colors; Statuses links back to it.
- Five fixed sample students support count sorting, local status changes, zero counts and reset. Reused existing production controls and display mappings; no API, saved attendance, grading or permission changes. Added catalog owner entries and semantic/browser tests.
- Focused checks passed: 135 files / 1,335 tests plus architecture, UI/design, TypeScript and lint. Eight role/viewport/theme browser contracts pass; screenshots inspected, with teacher/student captures identical in each visual variant. Artifacts saved under `status-catalog-preview` in this session's visualization folder. Existing screenshot baseline acceptance remains required before publication. Changes remain local and uncommitted.

## 2026-08-31 — Reduce visible attendance selection circles

- User requested smaller attendance selection circles. Reduced visible discs from 28px to 20px in the production Attendance controls and matching standalone Attendance implementation; preserved 44px targets, count-chip size, colors, selection rings and behavior. Pattern Lab reflects the production owner automatically.
- Updated existing geometry assertions. Verification: 56 component tests and 12 browser contracts pass; inspected Lab role/theme/viewport screenshots and confirmed 20px visible discs in the user's local preview. Evidence saved in session artifacts under `smaller-attendance-circles`. Explained that local preview changes do not require a production merge. No commit or publication.

## 2026-08-31 — Sync main and audit Classwork creation

- Synced page-action-icons worktree to main de3f73cd (#1132), preserving local UI work. Resolved Pattern Lab imports and archive history; retained applied safety stash 0950d7fb. No publish or production merge.
- Focused checks: 135 files / 1,338 tests plus architecture, UI/design, TypeScript and lint pass. Inspected Assignment draft/action menu, Material and Survey creation in local teacher browser without changing content or publishing.
- Recorded source-backed comparison, screenshots, reuse decisions and proposed shared top bar in docs/guidance/ui/changes/classwork-creation-audit.md. Recommend Material first; survey composer consolidation and new scheduling/autosave behavior remain separate proposals. Dark desktop audit only.

## 2026-08-31 — Standardize Material creation controls

- Material now uses the Assignment-style pinned title/action row, eye-only Preview with tooltip, and Post/Save draft split action. Removed Ungraded classwork; added an opt-in visible modal heading. Existing manual persistence, permissions and delete confirmation remain; Assignment/Survey unchanged.
- Added a deterministic production-owner example at /pattern-lab#material-creation. Preview shows unsaved content through the student RichTextViewer without saving. Fixed initial focus through the existing ModalLayer marker.
- Verification: 1,341 focused tests; after an equivalent spacing-token correction, 59 affected tests and architecture/UI/design/TypeScript/lint passed. Four browser variants passed with inspected editor/menu/preview/error captures under material-creation-bar. Local only; full Pattern Lab snapshot baseline acceptance remains pre-publication work.

## 2026-08-31 — Show Classwork modal headings and center save status

- User refined the proposed above-editor status placement to the modal header. Assignment now shows its existing autosave status centered between the visible modal heading and Close; Saved is muted. Survey opts into the same visible heading as Material. Manual-save modals do not show false autosave status.
- Extended CreationModalShell with an optional center slot and aligned the 44px Close target in the header. Updated the deterministic Pattern Lab creation example. Preserved scheduled-release context, save logic and focus behavior.
- Verification: 45 component tests, eight browser contracts, architecture/UI/design policy, TypeScript and lint pass. Inspected actual Assignment/Survey and Material example screenshots at desktop/mobile × light/dark; actual-route verification made no write requests. Evidence: session visualization folder modal-headings. Local and uncommitted; baseline acceptance still required before publication.

## 2026-08-31 — Replace the misleading generic creation preview

- User found that Open creation dialog showed placeholder paragraphs instead of a real authoring form. Removed the generic shell example and added clearly named Open assignment example beside Open material example.
- Assignment example reuses production form/editor/submission, shell, preview and scheduling components with gallery-local state. Publication outcomes are simulated; no API calls or production controller changes. Same modal frame, with Assignment-specific date/submission controls.
- Eight browser contracts and architecture/UI/design/TypeScript/lint pass. Inspected desktop/mobile × light/dark form/preview/schedule captures; verified centered/pinned status, edited-content preview, nested Escape/focus, draft selection, reopen reset and zero API writes. Artifacts: real-creation-examples in session visualization folder. Local only.

## 2026-08-31 — Make Assignment Preview icon-only

- Reused Material's IconButton in AssignmentForm, removing the visible Preview text at every width while retaining its tooltip, accessible name, disabled behavior and 44px target. Production and Pattern Lab update together; no save or preview-content behavior changed.
- Forty component tests, four browser contracts, UI/design policy, TypeScript and lint pass. Inspected desktop/mobile × light/dark screenshots; keyboard tooltip/activation and nested Escape/focus return pass. Evidence: assignment-preview-icon in session visualization folder. Local only.

## 2026-08-31 — Remove the success-alert checkmark

- User disliked the success checkmark shifting alert text. Removed the decorative icon from shared AlertDialog; its conditional indentation now disappears too, aligning title, description and action to the same content width. Error alerts, dismissal, focus and auto-dismiss behavior remain unchanged.
- Forty dialog/gallery tests and UI/design/TypeScript/lint pass. Eight Playwright role/viewport/theme checks passed with inspected screenshots, aligned bounds, accessible description, keyboard/button dismissal and focus return. Evidence: alert-alignment in session visualization folder. Local only; full Lab snapshot-baseline acceptance remains pre-publication work.

## 2026-08-31 — Discuss simpler assignment attachments

- Audited teacher requirement fields, validation modes, image formats and student submission flow for the user's proposed single-label rows and missing-attachment warning. Basic/Reachable/Expected site are Link validation settings; supported images are PNG/JPEG/GIF/WebP, 10 MB maximum.
- No current Assignment submit confirmation exists. Missing required items block Submit in the client, submit API and database guard, so the proposed confirmation requires coordinated behavior changes. Recorded proposed UI, pending URL-save handling, legacy-policy and migration-rollout considerations in submission-area-audit.md. Discussion only; no product behavior or database changes.

## 2026-08-31 — Checkpoint UI standardization before attachment redesign

- User approved a local checkpoint and a separate task for simplifying assignment attachments. This checkpoint contains the shared creation/action icons, centered action bars, attendance/status catalog, smaller attendance circles, consistent Classwork headings/Material creation bar, centered Assignment save status, real Pattern Lab creation examples, icon-only Preview and aligned success alerts. Attachment behavior remains unchanged.
- Updated obsolete gallery assertions and direct keyboard/accessibility coverage for attendance controls, the visible modal heading/initial title focus, and both production-owner creation examples. Pika audit passes; focused checks pass 137 files / 1,343 tests plus architecture, UI/design policy, TypeScript and lint.
- Reviewed and refreshed five Darwin and five Linux teacher screenshot references; student references remain unchanged. Full macOS Pattern Lab suite: 37 passed / 3 intentional skips. Linux: 36 passed / 3 skips plus one Chromium launch SIGSEGV before any assertion; the affected case passed twice in isolation. All 37 browser contracts therefore verified on each platform. Linux used Playwright 1.58.0 Noble with fonts-dejavu-core, matching the existing student references; no project dependency changes.
- Visual matrix covers teacher/student, desktop/mobile, light/dark and relevant interaction/focus states. Evidence and final check logs saved under the session visualization folder `checkpoint-verification`. Earlier pending-baseline notes are superseded by this verification.
- Checkpoint stays local on codex/standardize-page-action-icons; no push, PR, merge, deployment or database change. Separate attachment task creation is queued; its prompt carries the agreed design, compatibility and database-rollout constraints, and instructs it to use its own worktree.

## 2026-08-31 — Attendance current-main integration and bounded queue recovery candidate

User confirmed the retained Bara organization is the intended Codepet production workspace and that its one staff and three student memberships must be preserved. This resolves ownership only; no deployment, migration, mapping repair, queue mutation or production canary was authorized or performed. Integrated current main `983f9de4` into `codex/daily-checkbox-investigation`, preserving both sides of the sole shared archive-history conflict. Added proposed migration 142: a service-role-only, idempotent recovery that requires the exact teacher, active entitlement epoch and complete unresolved roster/schedule row set; rejects changed scope and live leases; rotates the entitlement epoch and supersedes the exact old rows atomically; and writes an immutable audit. Added a dry-run-first operator command whose execution gate is bound to the exact target, operation, teacher, epoch, row IDs, actor and reason; added static migration, authorization, launcher and rollback-scoped database contract coverage plus generated types and runbook guidance. Local targeted tests and TypeScript pass. The integrated 14-check teacher/student desktop/mobile light/dark browser matrix passes and representative screenshots were visually reviewed, including 2:00–3:00 PM on Aug 28 and the student notice. One unrelated CourseBlueprint purge-dialog timing assertion failed during an earlier focused run and remains to be rechecked in the final candidate run. User approved exactly one additional final fixed-SHA review after complete verification; no later reviewer is authorized. Production remains unchanged. Next: finish canonical checks, commit/push the draft candidate, run the one approved review and exact-head CI, then prepare fresh backup and exact production approval requests.

## 2026-08-31 — Close attendance recovery ordering blocker

The one owner-approved final fixed-SHA reviewer found one P1 operational sequencing gap and otherwise rated the SQL concurrency/idempotency/privileges, tenant boundaries, authorization binding, Bara identity preservation, UI async ownership and coverage clean. The gap was that restoring the Bara tenant mapping could make Pika's 10 obsolete rows claimable before migration 142 superseded them. Corrected both Pika and Bara runbooks: the default mandatory order is exact old-epoch supersession plus empty/non-claimable queue proof before Bara restore; the only alternate requires a separately approved verified Pika worker pause beginning before restore and spanning supersession/proof, with no implicit unrelated-classroom pause. Fresh snapshot delivery remains separately approved. Reviewer ran 65 focused Pika and 15 Bara tests. These documentation corrections are post-review changes; no additional reviewer is authorized without a new owner decision. No production mutation occurred.

## 2026-08-31 — Exact-head CI generated-type ordering correction

After the clean owner-approved targeted runbook re-review, Pika PR #1134 was marked ready and exact-head CI run `33449330779` started on `d0e6dc7d`. Ephemeral migration replay succeeded, then the database lane stopped because the migration-142 table and RPC definitions in `database.generated.ts` were manually placed before Supabase's generated alphabetical positions. The PR was immediately returned to draft. The coverage and browser lanes were canceled by that draft transition, not failed assertions; their partial logs show the attendance tests and 28 browser checks reached before cancellation were passing. Applied the exact inverse of CI's generated diff: unchanged 53-line table/RPC blocks moved only to the generated positions. Seven focused recovery/authorization/launcher tests and TypeScript pass; diff check confirms a pure 53-line move. No migration was applied locally, no CI retry has been requested, and production remains unchanged. This mechanical generated-artifact correction does not change the reviewed SQL or runtime behavior. Next: canonical focused checks, commit/push, then follow the stable-head review/CI gate without treating canceled lanes as failures.

## 2026-08-31 — Stabilize TestDetailPanel autosave timing coverage

Fresh exact-head CI run `33449809343` on `f72cc6cd` passed the complete database-contract lane, including migration replay/generated types, and the complete browser matrix. Its Test & Build job failed twice at the same TestDetailPanel assertion while 5,474 tests passed: the test typed a long prompt in real time and assumed the production three-second autosave could not elapse before asserting zero PATCH calls. Under hosted full-coverage contention, the typing crossed that valid debounce boundary. A first test-only correction at `b709cbe3` stretched the debounce with the file's existing helper, but fresh run `33451182430` proved that remained wall-clock-dependent by producing the same PATCH; the PR was returned to draft and remaining lanes canceled. Replaced the long character-by-character input with a single paste after select-all, preserving the real editor change/blur behavior while removing elapsed typing time from the assertion. No production source or behavior changed. Local exact-file tests pass 43/43 and full locked-dependency coverage passes; the corrected test completes in under one second during coverage. PR #1134 remains draft pending final focused checks and fresh exact-head CI. No production mutation occurred.

## 2026-08-31 — Move markdown preference to Advanced settings

- Worktree `codex/advanced-settings-tab`: added a URL-backed Advanced teacher Settings section and moved the existing storage-backed Show markdown switch out of General without changing preference behavior.
- Reused the current Settings `SegmentedControl`, panel, and switch row. The settings scroller now brings the selected section fully into view so the final Advanced option is not clipped on direct mobile URLs. No shared component contract, Pattern Lab example, API, schema, permission, or dependency changed; risk profile none.
- Verification: 32 Settings tests and four shared selector keyboard tests pass. Focused checks pass 12 files / 154 tests plus architecture, UI/design policy, TypeScript, and lint. Playwright screenshots were inspected for teacher desktop/mobile in light/dark, selected Advanced, focus, and toggle on/off. Student capture confirmed the teacher-only section is inaccessible and the normal student surface is unchanged.
- User authorized the draft PR, independent review, CI, and merge to `main`; production promotion, deployment, and database operations remain excluded. Low-risk review plan: one GPT-5.6 Terra/medium fixed-commit review. Ledger starts at zero launches, zero remediation waves, and zero fix batches; record final evidence on the PR without post-review commits.

## 2026-08-31 — Repair attendance epoch restaging and Daily availability controls

- Confirmed the production failure mode: migration 142 correctly superseded stale roster/schedule outbox rows, but preparation reused the same source revisions and therefore the same globally unique idempotency keys. Bara correctly rejects a second snapshot at the same revision, so the repair belongs in Pika rather than Bara.
- Added migration 145 so the private roster and schedule source documents include the teacher entitlement revision. A recovery epoch now changes both source tokens, advances both snapshot revisions, and generates fresh keys that Bara accepts. Added a rollback-only database lifecycle proving revision-1 stage, exact supersession, revision-2 restage, fresh pending rows, and idempotent retry.
- Daily now renders its selection column and Student actions menu only when the selected session is actually editable (`open` or `closed`). Scheduled, unconfigured, disabled, archived, and other non-editable views retain check-in/status evidence without dead checkboxes. The governed brief and composite-widget checklist are recorded in `daily-attendance-availability.md`.
- Verification after the first independent-review remediation: 51 focused attendance tests pass; the canonical focused gate passes 13 files / 163 tests plus architecture, UI/design policy, TypeScript, and lint; Pika audit passes. Teacher Playwright verification passes and screenshots were inspected for desktop/mobile, light/dark, open/closed/scheduled/unconfigured. The recovery runbook now makes migration 145 and newer revision/key proof explicit preconditions. Student UI is unchanged. Migration 145 has not been applied to any database; ephemeral replay remains a PR-CI gate and production application requires fresh exact-target authorization.
- Final cumulative review found no code, SQL, privilege, rollback, or UI blocker. A second documentation-only remediation aligned the completion audit with the control runbook: migrations 142 and 145 are a coupled recovery prerequisite, while migration application, supersession, fresh preparation/staging, tenant-link repair, delivery, and canary remain separate authorization gates. Added a documentation contract preventing a return to 142-only guidance. The cumulative focused gate passes 14 files / 167 tests plus architecture, UI/design policy, TypeScript, and lint.
- Exact-head CI replayed every migration successfully, then exposed an untyped `smallint` argument in the new rollback-only database lifecycle fixture before its recovery assertions could run. The PR returned to draft; the browser and Test & Build lanes were canceled by that draft transition rather than failed assertions. Added explicit UUID, time, smallint, bigint, and timestamptz casts matching the existing timing-policy RPC signature. This is remediation batch 3/3; 167 focused tests and every static gate pass locally. Reviewer launches remain at the default ceiling of 5/5, so a fresh exact-head review and CI retry require the owner checkpoint before merge.
- After the owner extended the bounded review, current-main rebase preserved the product patch. Exact-head CI then exposed one remaining stale fixture field: `class_days.course_code`, removed since migration 006. Owner authorized remediation batch 4, final review launch 8/8, and source-epoch migration replay only in a new disposable local Supabase target. The disposable `pika-attendance-144-ci:56322` project replayed the then-current migrations 001–144 and the complete Bara attendance database harness passed, then was stopped and moved to Trash; the existing local Pika stack remained healthy and untouched. The final reviewer found that the temporary configurable-target support could fall back after a misspelled explicit container, so owner-directed remediation batch 5 removes that support entirely and restores the original strict `pika:54322` guard while keeping the valid current-schema fixture correction. After current main added its own migration 144, the attendance source-epoch migration was resequenced to 145. The refreshed focused gate passes 14 files / 168 tests plus every static gate; current-main teacher Daily verification passes desktop/mobile in light/dark and open/closed/scheduled/unconfigured states. Production remains unchanged.

## 2026-08-31 Test corrections after first Start
- Added a reviewable migration and application policy: after first student Start only question prompt wording/instructions remain editable; structure, choices, grading, identities and response settings remain frozen.
- Start now persists through the atomic attempt transaction and returns its post-lock student snapshot; title/documents/result visibility stay on existing paths. Added focused UI/API/policy/migration coverage and a dev preview on port 3006.
- Static/focused checks and visual matrix pass. Migration 143 is not applied; local database replay, generated types and concurrency verification await exact one-time migration approval. PR/review pending.
- Draft PR #1140 received independent architecture and security review. The first remediation batch keeps the Test detail visible with a specific retryable Start error, corrects the pre-Start preview, and makes pre/post-142 Classroom archives restore locked Tests safely while preserving the boundary. The archive database harness now covers current locked, legacy started and legacy untouched Tests plus rejection outside maintenance mode.
- Post-remediation focused checks pass: 65 files / 914 tests plus architecture, UI/design policy, TypeScript and lint. Corrected desktop/mobile and light/dark screenshots were inspected. Migration 143 remains unapplied pending exact local approval, so live database replay/concurrency and generated types remain outstanding.
- User approved the Test editing migration for local Supabase and checks; it was numbered 142 before the branch was resequenced. The first transactional apply exposed an invalid historical timestamp column and rolled back; corrected the backfill/restore timestamp sources, then applied the Test editing migration successfully under its pre-resequence version 142. Generated database types match the local schema.
- Added a current archive-v2 Test-policy round trip covering a preserved current lock, reconstructed legacy-started lock, untouched legacy Test, exact restored rows and ordinary structural-write rejection. Updated the atomic Test harness for permanent locks and multiple local Supabase projects. Both live database harnesses pass.
- Ready-PR CI exposed an outdated atomic-grading fixture assumption, so the PR returned to draft before correction. Grading fixtures now persist the same Start boundary as production RPCs; wording/grading ordering expects the allowed prompt correction while grading fields remain frozen. The atomic grading harness passes locally, and the Test-policy archive harness is now an explicit database CI step.
- Rebasing PR #1140 onto `ad13b3d7` exposed the newly merged Attendance migration 142. Resequenced the Test editing migration to 143 and updated its runtime, test and rollout references. Reconciled the already-applied local Test schema to version 143 without resetting local data; a dry run then proposed only Attendance 142, which applied successfully. The local ledger is aligned through 143, generated types match, and the Attendance, Test editing, atomic submit and atomic grading database harnesses pass. No hosted migration or deployment occurred.
- Ready-PR CI passed Test & Build but exposed a remaining pre-policy fixture in the Blueprint question-identity database harness, so the PR returned to draft. Directly inserted attempt/response fixtures now set the durable Test lock, wording-only corrections are asserted to succeed without changing answers, points or responses, and grading mutations remain rejected. The exact Blueprint database harness, 25 targeted static tests, and the focused gate (67 files / 934 tests plus policies, TypeScript and lint) pass locally.
- Follow-up: Close should confirm discarding unapplied Markdown.

## 2026-08-31 — Refine the exam document workspace

- Replaced the duplicated teacher Preview and student live-exam document compositions with a shared `ExamDocumentWorkspace`. The persistent pane header now transitions from Documents to Back plus the active document title without a jarring horizontal morph; list/viewer layers and the question form stay mounted.
- Added an accessible desktop split-pane resizer. Documents begin at 30% in the list, open at or remember 30–50%, and questions remain at least 50%. Pointer drag, Arrow keys, Home/End, double-click reset, visible focus, and semantic separator values are covered; compact screens retain the stacked layout without a divider.
- Focused verification passes 60 component tests and the repository gate passes 15 files / 184 tests plus architecture, UI/design policy, TypeScript and lint. Pika audit passes. Inspected actual teacher Preview and student attempt at desktop/mobile and light/dark; a compact document-body collapse found during verification was corrected. A live unsaved answer remained mounted while opening docs. Temporary local visual-only records were deleted; no existing data changed.
- Draft PR #1145 review found one non-blocking P2: inactive eager iframes could remain in the screen-reader tree. They now retain eager mounting while receiving inactive `tabIndex` and `aria-hidden` isolation; two-frame coverage and the full 184-test focused gate pass after the fix. Final cumulative review and exact-head CI remain.

## 2026-08-31 — Preview simpler Assignment attachments

- In worktree `codex/assignment-attachments-redesign`, Assignment creation now uses a compact 52px single-line Submission Requirement row at every width: 44px drag target, type icon, editable label and 44px trash target. Its tooltip-backed 44px `+` button opens the Link, Repo and Image menu. Removed visible Required, helper-text, image-limit and Link-check rows while keeping image limits as accessible label help and preserving existing hidden values during edits. Teacher work review continues to call submitted artifacts Attachments and shows missing legacy optional rows.
- Assignment Title and Instructions labels are now visually hidden and their reserved rows collapse; empty fields show `Title` and `Instructions` placeholders while retaining associated accessible labels and required semantics. Removed the student-facing instructions hint and tightened the Assignment-only inset between the modal heading and title field. Assignment and Daily now share one zero-gap date/subtitle button that reserves the subtitle line for constant height when relative context is absent. Other creation forms retain their existing visible labels and spacing.
- Student Turn in treats every configured attachment as expected, flushes pending link edits before submit, and uses one shared `Submit without attachments?` confirmation listing all missing labels. Present invalid/inaccessible attachments and save failures still block. The submit API requires explicit `allow_missing_attachments`; empty work is allowed only through that acknowledged missing-attachment path.
- Prepared migration `144_allow_acknowledged_missing_assignment_attachments.sql` so acknowledged missing attachments are accepted only inside the locked submission RPC while present invalid/inaccessible artifacts remain blocked. It was not applied to any shared database.
- Draft-PR review hardened that boundary: the API requires an exact, duplicate-free match and passes only its canonical missing-requirement IDs to both standard and Pal submission RPCs; the shared locked validator independently re-derives the missing set and requires exact cardinality and membership. Extra IDs, duplicates, a concurrently added requirement, or a deleted artifact are not covered by an earlier confirmation. Legacy call shapes remain strict, ordinary submissions safely fall back during migration-first rollout, and acknowledged missing submissions return a retryable migration-required response until migration 144 is present. Failed or in-flight image uploads block confirmation and submission until retry or an explicit continue-without action.
- Rollback-scoped atomic checks and disposable-database concurrency checks pass, including strict/scoped acknowledgement, invalid, Pal, acknowledged requirement-add and acknowledged artifact-delete cases. Remediation tests pass 89/89; the focused gate passes 186 files / 1,856 tests plus architecture, UI/design policy, TypeScript and lint. The eight desktop/mobile × light/dark Pattern Lab contracts pass and representative captures were inspected. Migration 144 remains unapplied to shared databases.
- Pattern Lab has API-free teacher/student examples. Desktop/mobile × light/dark teacher rows, populated/empty label states, the shared fixed-height relative-date subtitle, the open requirement menu, student checklist and confirmation all passed and were inspected; geometry caps the three-row card at 220px and checks same-row centering. Evidence is under session artifacts `assignment-attachments`. Final focused checks pass 185 files / 1,837 tests plus architecture, UI/design policy, TypeScript and lint. Preview remains on localhost:3007; no commit, PR, merge or deployment yet.

## 2026-08-31 — Remove Daily corner clipping artifact

- Removed the redundant radius from Daily's invisible standalone workspace frame while preserving the table, warning-card, and summary-card radii. This prevents nested anti-aliased clipping from reading as a translucent page-colour overlay at the top corners.
- Added focused ownership coverage. The Daily component suite passes 37/37; the repository focused gate passes 12 files / 159 tests plus architecture, UI/design policy, TypeScript, and lint.
- Playwright screenshots were inspected for the plain table and warning-first composition at teacher desktop/mobile in light/dark. The student mobile capture confirmed no regression on the teacher-only route. Local only on `codex/fix-daily-table-corners`; no PR or publish action taken.

## 2026-09-01 — Record AI PR lifecycle evidence

- Added `pnpm record:ai-pr-lifecycle`, an append-only local recorder for AI PR stages, attributable active work/token metrics, CI queue/run timing, correction/sync counts, and final quality. It keeps unavailable fields unknown and never records prompts, source content, secrets, identities, or environment values.
- Updated the canonical development workflow plus Codex and Claude PR prompts so agents record start, draft, review, remediation, CI, merge, and summary evidence automatically. No application, schema, CI-policy, dependency, or production behavior changed.
- Verification: recorder and guidance tests (47), focused checks (89), architecture/UI/design policy, TypeScript, lint, and Pika audit passed. Model recommendation: GPT-5.6 Terra — bounded local tooling and workflow-contract change.
- Independent review corrections: added recorder tests to the canonical PR Gate workflow and renamed the post-PR timestamp to `trackingStartedAt`, so it cannot be mistaken for active development time.
## 2026-08-31 Pattern Lab remaining classroom page mockups
- Added experimental Gradebook, Calendar, Announcements, and Roster compositions using production owners and local fixtures only.
- Verified teacher desktop/mobile light/dark, populated/loading/empty/error, sorting, selection, menus, focus return, student exclusion, and no page overflow; tests and UI/design policy passed.
- Independent review found missing inactive tabpanel targets, inert retry/prototype commands, and insufficient durable coverage. Fixed all findings in one batch, added explicit local-only feedback and a reusable 35-check browser scenario; focused checks pass 13 files / 101 tests.
