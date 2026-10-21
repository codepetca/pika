# Tooltip motion consistency audit — 2026-10-21

Audit of source `192f4cbff507f272573a3581260af8e75aac8c89`, following the Announcement Schedule closing pass. This is an evidence record and implementation recommendation, not promoted stable guidance or a Tooltip behavior change.

## Verdict

The shared Tooltip has a confirmed motion consistency gap: its presentation disappears in the logical-close update, while the current shared SplitButton reference fades for the semantic fast duration. Existing hint interactions work in the primary matrix. A separate mobile keyboard investigation found a small scroll-related help-discovery issue; artifact activation and the accessible chooser remain available.

## Scope and evidence

Current production owners rendered by `/pattern-lab?role=teacher` and `?role=student`:

1. Application header references: Home hover hint, description ownership and Escape dismissal.
2. Core controls: Edit example keyboard hint; Formatting help pointer/touch toggle, keyboard activation, Escape, rapid reopen and outside focus.
3. `#ui-consistency`: shared SplitButton as the positive motion control; real AssignmentArtifactsCell interactive hover content and its keyboard chooser.

| Dimension | Coverage |
|---|---|
| Roles | Teacher and student; artifact table is teacher-only |
| Viewports | Desktop 1440×900; mobile 390×844, including touch activation |
| Themes / preferences | Light/dark × normal/reduced motion |
| Primary native matrix | 16 complete contexts; interactive hover transfer in the eight teacher contexts |
| Interactive keyboard | Four desktop contexts; four mobile first-focus cases plus four diagnostic continuations |
| Existing owner test | `tests/ui/Tooltip.test.tsx`: one passing click/description/toggle regression |
| Visual review | 14 inspected and accepted current screenshots; other native captures retained as supporting material |

All 16 primary contexts had zero API requests, console/page errors or document overflow. The targeted keyboard/chooser drivers also recorded zero API requests; no external artifact link was activated. The in-app browser click-help capture supplements the Playwright CLI measurements. Local preview: localhost:3564; capture date October 21, America/Toronto.

Task artifacts: `product-fluidity/transition-consistency/tooltip-motion-audit`. Retained files include source/media hashes, accepted screenshot index, `final-measurements.json`, `interactive-keyboard.json`, `mobile-keyboard-diagnostic.json`, driver versions and raw logs. The audited component/fixture blobs are bound to the source commit above; later documentation commits do not turn this into evidence for changed product code.

## Findings

### 1. Low priority: Tooltip closing differs from the shared motion reference

The native observer captured 88 Tooltip dismissals across header, keyboard, help and interactive variants. Every presentation was disconnected by the first post-dismissal mutation observation, with no retained opacity frames. Open content reported no CSS animation and `transition-property: none`; the computed default duration alone is not an active fade.

The same observer captured intermediate opacity for all eight normal-motion SplitButton references, with removal about 154–155ms after the keyboard event. All eight reduced-motion references retired immediately. This positive control establishes that the tool can observe a real fade in the same environment. Event-to-observer latencies are instrumentation observations, not perceived animation durations.

The Tooltip owner has no configured entry/exit motion. Its 100ms hover delay and provider's 300ms skip delay are disclosure delays, not animation durations. Preserve them when refining presentation.

Sources: `src/ui/Tooltip.tsx`, `src/ui/SplitButton.tsx`, `src/styles/tokens.css`.

### 2. Low priority: first mobile keyboard focus can lose the interactive hint during scroll

In all four mobile theme/motion contexts, native Tab from Select Example One focused the correct first artifact button, but its hint disappeared. Recorded events showed the hint/description mount, then the table scrolling horizontally, then the description and tooltip being removed. The installed Radix Tooltip closes on ancestor scroll, consistent with the observed sequence.

Tab to the next artifact control and Shift-Tab back at the settled position restored the hint in all four diagnostic contexts. Enter opened the three-link modal chooser, and Escape restored focus to the artifact button. Desktop keyboard entry, Tab retirement, chooser activation and focus return worked in all four contexts.

This is a help-discovery papercut, not a blocked artifact action. Track it separately from opacity polish. Reproduce the natural scrolling entry when implementing a fix; do not remove Radix scroll dismissal globally merely to make a test pass.

Sources: `src/app/__ui/UiConsistencyPattern.tsx`, `src/components/assignment-workspace/TeacherAssignmentStudentTable.tsx`, `src/components/AssignmentArtifactsCell.tsx`; installed `@radix-ui/react-tooltip` 1.2.8 ancestor-scroll handler.

## Confirmed strengths and implementation constraint

Description IDs clear on close. Escape preserves the focused ordinary hint trigger; outside clicks preserve the chosen field. Rapid help reopening survives the prior close. Touch help toggles, and interactive pointer transfer across the trigger/content gap survives in all eight teacher contexts. Tooltip text and content remain legible in the inspected desktop/mobile light/dark views.

A future exit fade needs more than an opacity transition. Installed Radix Presence 1.1.5 retains closing content for a changed CSS animation name, not a plain opacity transition. Radix Tooltip clears the trigger description on logical close, but its retained content includes a visually hidden duplicate of the children with `role="tooltip"`. Interactive artifacts contain real links. Pika's current owner has no retained closed-state inert/hidden/pointer fence because it unmounts immediately today.

Therefore a naive exit keyframe could leave closing role/content/link semantics mounted. This is a source-backed implementation risk, not an observed stale-link defect in the current immediate-close implementation. A refinement must explicitly retire descriptions, pointer targets and focusable interactive content at logical close, cancel old expiry on reopen, and honor reduced motion and owner teardown. Do not change the chooser or turn Tooltip into a new keyboard popover as part of this pass.

## Recommended next pass

Extend the existing shared Tooltip with the approved fast opacity treatment and unchanged positioning/text geometry. Reuse Radix trigger, hover grace, presence and description ownership; use semantic motion tokens and immediate reduced motion. Add direct owner regressions for real pointerdown/click ordering, hover/focus, interactive content retirement, reopening, disabled changes and live preference changes before implementation. If safe exit retirement cannot be established without broadening the contract, land entry-only opacity first and keep exit work explicitly incomplete.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Trigger, delay, description and hover ownership | Shared Tooltip / Radix | reuse | Existing interaction and chooser paths work; preserve their contract. |
| Opacity presentation and logical-close fencing | Shared Tooltip | extend | One bounded shared owner with actual header, help and artifact adopters; no new shared primitive is justified. |
| Timing and reference evidence | Semantic fast duration/easing; current Pattern Lab SplitButton | reuse | Positive native control verifies the shared motion and reduced-motion policy. |

This recommendation is not implementation approval for a new visual pattern. It follows the existing Pika motion reference; stable canon promotion and new dependencies are unnecessary.

## Limits and audit rework

This audit uses Chromium and fixed-data actual owners. It does not establish screen-reader compliance, other-engine behavior, authenticated routes, backend correctness or app-wide Tooltip conformance. Disabled-prop retirement is source-reviewed, not a separate native fixture. Collapsed navigation and Calendar announcement Tooltip adopters need their own visible fixture coverage. Tiptap's separate Tooltip family is excluded.

Early automation failures were retained: first hover could arrive before hydration; an unspecific tooltip selector could observe a transient preceding owner; offscreen focus could close a hint during scroll. The final primary driver waits for hydration, selects the intended owner and settles the viewport before ordinary keyboard checks. The separate mobile keyboard driver deliberately keeps the natural table scroll and records the resulting product behavior. The source worker corrected preliminary Calendar fixture assumptions and a missed artifact adopter; the final safe fixture was verified by the coordinator.

No product source, shared API, dependency, database, production configuration or stable guidance was changed by this audit. The broad product-fluidity goal remains open.
