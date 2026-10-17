# Test browser shortcuts and exit tracking

- Surface: active student test workspace and teacher Exits tooltip.
- References: existing `student-test-attempt` Pattern Lab composition, production student test owner in the teacher/student table fixture, and existing teacher Exits tooltip.
- Roles/viewports/themes: student and teacher; desktop 1440×900 and mobile390×844; light/dark.
- States: active attempt, selected-text right-click then sustained focus loss/return, genuine route/window exits, submission cleanup; teacher ordinary exit details.
- Primary signal: translation/browser popup focus loss follows ordinary Exits/Away accounting. Ctrl/Cmd+F stays blocked during active tests and is restored afterward.
- Exclusions: translation exemption, browser-interaction counters, in-app translation, new columns/controls, dependency or schema changes.
- Composite review: preserve focus grace, reference access restrictions, cleanup, draft preservation and existing tooltip semantics.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Exit detection | Existing exam incident reducer | reuse | Restore normal focus-loss handling after right-click. |
| Teacher evidence | Existing Exits tooltip | reuse | Remove the separate browser-interaction presentation. |
| Exam workspace | Existing student-test-attempt owner | reuse | Preserve layout and Find blocking. |

Owner explicitly removed the selected-text right-click exemption because page focus cannot reliably distinguish native translation UI from an app switch. Remove the exemption and its count/duration transport, summaries and tooltip details. Translation popup focus loss remains subject to the existing600ms grace and standard exit accounting.

Verification: the new Ctrl/Cmd regression failed with the exemption and passes after removal; accessible-reference regression verifies ordinary away start/end and ignores internal frame transfers. 8/8 Playwright scenarios passed (51.6s), covering both roles at1440×900 and390×844 in light/dark, draft preservation, reference focus, Find blocking and post-submission cleanup. All8 captures visually inspected. Teacher desktop tooltip shows Exits1/Away-focus1 and no browser-interaction detail; teacher mobile retains the existing hidden telemetry columns. Student mutation fixtures acknowledge events without updating displayed totals; payload assertions prove exit recording.

Capture provenance: 2026-10-16, Playwright Chromium, local http://localhost:3012, `/e2e-fixtures/teacher-student-tables?role=student|teacher&tab=tests`; production owners with synthetic APIs. Uncommitted removal on09c897644, source-identical to ensuing removal commit identified in PR1606. Ignored artifacts: `test-results/student-test-find.ui-patte-*/popup-exit-recorded.png`, `reference-find-blocked.png`, `teacher-popup-exit.png`. References are the existing test workspace and Exits tooltip at matching viewport/theme. Text is legible, drafts remain mounted, no document-width overflow. Prior exemption captures are historical. Native Chrome was not repeated because this removal restores ordinary focus-loss classification; the existing reproduction established that the popup emits blur.
