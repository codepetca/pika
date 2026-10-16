# Test browser interactions

- Surface: active student test workspace; teacher Tests grading table exit tooltip.
- References: existing `student-test-attempt` Pattern Lab composition and teacher/student table fixture; existing Exits tooltip owns the teacher evidence presentation.
- Roles/viewports/themes: student and teacher, desktop 1440×900 and mobile 390×844, light and dark.
- States: active attempt with selected text and browser focus loss, return to test, genuine hidden/navigation/window exit, submitted attempt; teacher zero exits with browser evidence, tooltip open and real exit highlight.
- Primary signal: browser interactions have a separate count/duration and do not increase Exits or Away. No new column, control or warning.
- Exclusions: in-app translation, automatic identification of a translator, selected-text collection, cross-origin/browser-owned reference internals, new dependencies or migrations.
- Composite-widget review: preserve workspace focus, reference-frame lifecycle, tooltip keyboard behavior, and test cleanup. No new composite widget.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Attempt and reference layout | ExamDocumentWorkspace / student-test-attempt | reuse | Only event handling changes. |
| Focus incident classification | exam-mode-incidents reducer | extend | One-use selected-text context-menu intent separates browser focus loss. |
| Teacher evidence | Existing Exits Tooltip | extend | Show count and duration without adding a competing visual signal. |

Native reproduction on macOS Chrome 155.0.8059.84: selecting a synthetic French phrase, right-clicking and choosing Translate Selection to English opened the native Translated popup. Trusted contextmenu preceded trusted blur by 4.119 seconds; fullscreen and inner/outer dimensions stayed unchanged. The diagnostic visibility state was stale after a macOS fullscreen window switch, so the visible-page guard is verified separately by deterministic browser tests. Diagnostic source/trace: `/tmp/pika-translation-repro/`; only selection length was recorded.

The page cannot identify which native menu action was chosen. The exemption is therefore called a browser interaction: selected text inside the exam/reference arms one blur for 15 seconds; the page must remain visible and window-compliant. Focus ends the interaction. Hidden page, navigation/lifecycle and sustained window violations still count normally. Duration is stored through existing focus-event metadata and excluded before ordinary away accounting.

Verification: 8/8 Playwright scenarios passed again after main sync and frame-focus remediation (1.0m); coordinator inspected both roles at 1440×900 and 390×844 in light/dark, including open desktop teacher tooltip. Browser evidence preserves zero exit styling, ordinary blur remains counted, drafts stay intact, accessible reference menus work, and Find is restored after submission. Teacher mobile retains the existing hidden Exits column; no new mobile treatment.

Capture provenance: 2026-10-16, Playwright Chromium, local http://localhost:3012, `/e2e-fixtures/teacher-student-tables?role=student|teacher&tab=tests`, production owners with synthetic API responses. Final captures render the uncommitted frame-focus remediation on37aa15af (main82a413518 merged); source contents match the ensuing remediation commit identified in PR1606. Current-conformance evidence is under ignored `test-results/student-test-find.ui-patte-*`: `browser-interaction-return.png`, `reference-find-blocked.png`, and `teacher-browser-evidence.png`. References: existing student-test-attempt workspace and teacher Exits tooltip at matching viewport/theme. No new pattern, decorative signal or layout change; text remains legible and document width does not overflow. Native popup evidence is supplemental; browser-owned UI is not available in headless Playwright.

Independent review found that native focus loss inside a focused reference dispatches on the frame window. The correction observes focus/blur on the same accessible exam documents as context menus and ignores internal transfers while the top document retains focus. A component regression fails before the correction; E2E now uses trusted frame click, waits past the grace period, then dispatches frame-owned popup blur/focus instead of top-window substitutes. Both roles/themes/viewports were recaptured and visually inspected after the main UI sync.
