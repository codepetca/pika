# Product Experience Evidence (July 2026)

## Purpose

This manifest makes the Phase 1 product audit reviewable after the local browser session ends. After review deleted the two credential-bearing login images and their one DOM snapshot, the ignored local product set contains 51 screenshots and 51 matching DOM/accessibility snapshots. Two additional Open Design board-QA pairs bring the local directory totals to 53 screenshots and 53 DOM snapshots.

Twenty-two representative product screenshots and two Open Design board-QA screenshots are committed below. They cover the three role/shell regimes, the highest-risk teacher/student workflows, desktop/mobile behavior, both themes, lifecycle controls, and the utility routes added during audit review. A credential-bearing local login capture was removed during review; signup and reset remain as durable authentication-entry evidence.

The matching DOM `.txt` files are committed beside each screenshot with the basename shown in the final column.

Open Design project: `Pika Product Experience Audit` (`ec89fd79-1229-4143-8f69-cf24842c6584`). Generation run: `879efda2-651b-4b5c-aeba-111e43e0cab4`. Review run: `b503a4ba-f0c0-41df-85a5-6b349588c7e7`. The preview URL is maintainer-local and is not durable PR evidence; captures `51` and `52` below preserve the verified desktop/mobile board states. The mobile root measured `375px` client and scroll width.

The post-review board uses 21 unique product captures: it includes local-only teacher Daily capture `02`, omits manifest-only light parity captures `42` and `45`, and contains no login capture `48`. Its count of 22 refers to the current committed product-evidence total, not the number of gallery tiles. Architecture review is incorporated directly: the Safety Wave disables the legacy route/UI, and any future hot-data removal uses only the compaction state machine. The repository audit remains authoritative.

The `Viewport` column records the configured browser viewport, not always the image pixel dimensions. Full-page captures can extend vertically; legacy horizontal-overflow evidence `12` and `36` intentionally extends to `4980x900` and `4907x844`. Stable viewport captures `43`, `44`, `46`, `47`, `51`, and `52` use the browser content area and are `1425x891` or `375x812` after browser chrome.

## Accepted Evidence

| ID | Role | Route or surface | Viewport | Theme | State | Screenshot | DOM evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Teacher | Classroom index | 1440x900 | Dark | Active classroom | [01 teacher classrooms](./evidence/product-experience-2026-07/01-teacher-classrooms-desktop.png) | `01-teacher-classrooms-desktop.txt` |
| 04 | Teacher | Classroom / Classwork | 1440x900 | Dark | Assignment grading | [04 assignment grading](./evidence/product-experience-2026-07/04-teacher-assignment-grading-desktop.png) | `04-teacher-assignment-grading-desktop.txt` |
| 06 | Teacher | Classroom / Tests | 1440x900 | Dark | Test grading | [06 test grading](./evidence/product-experience-2026-07/06-teacher-test-grading-desktop.png) | `06-teacher-test-grading-desktop.txt` |
| 12 | Teacher | Utility dashboard | 1440x900 | Dark | Attendance matrix | [12 dashboard](./evidence/product-experience-2026-07/12-teacher-dashboard-desktop.png) | `12-teacher-dashboard-desktop.txt` |
| 13 | Teacher | Utility blueprints | 1440x900 | Dark | Empty list/detail | [13 blueprints](./evidence/product-experience-2026-07/13-teacher-blueprints-desktop.png) | `13-teacher-blueprints-desktop.txt` |
| 14 | Student | Classroom index | 1440x900 | Dark | Enrolled classroom | [14 student classrooms](./evidence/product-experience-2026-07/14-student-classrooms-desktop.png) | `14-student-classrooms-desktop.txt` |
| 15 | Student | Classroom / Today | 1440x900 | Dark | Journal and lesson plan | [15 student Today](./evidence/product-experience-2026-07/15-student-today-desktop.png) | `15-student-today-desktop.txt` |
| 22 | Student | Classroom / Today | 390x844 | Dark | Journal and long history | [22 mobile Today](./evidence/product-experience-2026-07/22-student-today-mobile.png) | `22-student-today-mobile.txt` |
| 24 | Student | Classroom / Classwork | 390x844 | Dark | Assignment editor/history | [24 mobile assignment](./evidence/product-experience-2026-07/24-student-assignment-mobile.png) | `24-student-assignment-mobile.txt` |
| 30 | Teacher | Classroom / Classwork | 390x844 | Dark | Assignment grading | [30 mobile assignment grading](./evidence/product-experience-2026-07/30-teacher-assignment-grading-mobile.png) | `30-teacher-assignment-grading-mobile.txt` |
| 32 | Teacher | Classroom / Tests | 390x844 | Dark | Selected test response | [32 mobile test grading](./evidence/product-experience-2026-07/32-teacher-test-grading-mobile.png) | `32-teacher-test-grading-mobile.txt` |
| 36 | Teacher | Utility dashboard | 390x844 | Dark | Attendance overflow | [36 mobile dashboard](./evidence/product-experience-2026-07/36-teacher-dashboard-mobile.png) | `36-teacher-dashboard-mobile.txt` |
| 40 | Teacher | Classroom index | 390x844 | Dark | Hot archived classroom | [40 mobile archive](./evidence/product-experience-2026-07/40-teacher-archived-classroom-mobile.png) | `40-teacher-archived-classroom-mobile.txt` |
| 41 | Teacher | Classroom index | 1440x900 | Dark | Hot archived classroom | [41 desktop archive](./evidence/product-experience-2026-07/41-teacher-archived-classroom-desktop.png) | `41-teacher-archived-classroom-desktop.txt` |
| 42 | Teacher | Classroom index | 1440x900 | Light | Active classroom | [42 light teacher classrooms](./evidence/product-experience-2026-07/42-teacher-classrooms-light-desktop.png) | `42-teacher-classrooms-light-desktop.txt` |
| 43 | Teacher | Utility calendar | 1440x900 | Light | Calendar and invalid Delete | [43 teacher calendar](./evidence/product-experience-2026-07/43-teacher-utility-calendar-light-desktop.png) | `43-teacher-utility-calendar-light-desktop.txt` |
| 44 | Teacher | Utility calendar | 390x844 | Light | Calendar at narrow width | [44 mobile teacher calendar](./evidence/product-experience-2026-07/44-teacher-utility-calendar-light-mobile.png) | `44-teacher-utility-calendar-light-mobile.txt` |
| 45 | Student | Classroom index | 390x844 | Light | Enrolled classroom | [45 light student classrooms](./evidence/product-experience-2026-07/45-student-classrooms-light-mobile.png) | `45-student-classrooms-light-mobile.txt` |
| 46 | Student | Utility history | 390x844 | Light | Attendance history | [46 mobile student history](./evidence/product-experience-2026-07/46-student-history-light-mobile.png) | `46-student-history-light-mobile.txt` |
| 47 | Student | Utility history | 1440x900 | Light | Attendance history | [47 desktop student history](./evidence/product-experience-2026-07/47-student-history-light-desktop.png) | `47-student-history-light-desktop.txt` |
| 49 | Shared | Signup | 1440x900 | Light | Verification-code request | [49 signup](./evidence/product-experience-2026-07/49-auth-signup-light-desktop.png) | `49-auth-signup-light-desktop.txt` |
| 50 | Shared | Forgot password | 1440x900 | Light | Reset-code request | [50 password reset](./evidence/product-experience-2026-07/50-auth-reset-light-desktop.png) | `50-auth-reset-light-desktop.txt` |
| 51 | Audit | Open Design evidence board | 1440x900 | Dark | Post-review desktop verification | [51 board desktop](./evidence/product-experience-2026-07/51-open-design-audit-desktop.png) | `51-open-design-audit-desktop.txt` |
| 52 | Audit | Open Design evidence board | 390x844 | Dark | Post-review mobile verification | [52 board mobile](./evidence/product-experience-2026-07/52-open-design-audit-mobile.png) | `52-open-design-audit-mobile.txt` |

## Local-Only Evidence

The ignored local set additionally covers teacher Daily, Classwork summary, Tests summary, Gradebook, Roster, classroom Calendar, Syllabus, Settings, blueprint actions/create, student Classwork summary, assignment instructions, Tests summary, Calendar, Syllabus, Announcements, and additional mobile summary states. The numeric filenames and matching `.txt` snapshots are the stable references used in the audit document and Open Design board.

The temporary archive evidence used only the seeded local database. The fixture was set to hot-archived long enough to capture Restore/Delete, then `archived_at` was restored to `null` and verified. The redacted [capture-target and reset record](./evidence/product-experience-2026-07/capture-target-archive-reset.txt) records the local application/Supabase targets and the `archived_at = NULL` readback. No production data was read or modified.

## Durable Workflow Coverage Gate

The audit maps every core workflow, but the committed visual subset is intentionally representative. This matrix prevents an uncaptured state from being mistaken for completed browser verification. `Committed pair` means durable desktop and mobile evidence is present; every exception names the phase that must add or refresh the missing evidence before that workflow can exit.

| Workflow family | Durable status | Explicit exception and owner |
| --- | --- | --- |
| Teacher/student classroom indexes, teacher create/order, and student join | Indexes have committed desktop/mobile coverage across the two roles; create/order/join states are local-only or uncaptured | Phase 2 adds governed create/join form states; Phase 3 captures ordering and join success/profile/error states; Phase 6 refreshes theme parity. |
| Teacher assignment and test grading | Committed pair | Phase 3 adds error, keyboard, and standalone test-preview states. |
| Student Today journal | Committed pair | Phase 3 adds save failure/conflict and light-theme states. |
| Student assignments | Mobile committed; desktop local-only | Phase 3 commits a desktop pair member plus failed-save/submission evidence. |
| Teacher dashboard | Committed pair | Phase 3 replaces the authorization path and captures the corrected responsive state. |
| Teacher calendar | Committed pair | Phase 3 captures removal of invalid Delete and corrected mobile overflow. |
| Student history utility | Committed pair | Phase 3 records the migrate/redirect/retire result. |
| Hot archive discovery/actions | Committed pair | Safety Wave captures Delete removal; Phase 5 adds export/verification/restore operation states. |
| Authentication entry | Desktop signup/reset committed; credential-bearing login capture removed | Phase 2 adds a fixture-only login plus mobile field/focus states; Phase 3 captures verification, password creation, logout, and session-expiry recovery because they require controlled session lifecycle setup. |
| Teacher Daily, Classwork summary, Tests summary, Gradebook, Roster, classroom Calendar, Syllabus, Settings | Local-only desktop and selected mobile evidence | Each Phase 3 vertical slice, including the explicit Settings slice, commits desktop/mobile evidence for changed states; Phase 6 closes any remaining parity gaps. |
| Student Tests, Surveys, Calendar, Syllabus, Announcements | Local-only desktop and selected mobile evidence | Each Phase 3 vertical slice commits desktop/mobile normal and error states; Phase 6 closes theme parity. |
| Student grades and profile | Returned-work fragments only; no aggregate grades or profile editor surface exists | Phase 3 records the product decision, then captures the resulting consolidated surface or durable no-build decision before exit. |
| Blueprints | Desktop committed; actions/create local-only | Phase 5 commits desktop/mobile capture, overflow review, and classroom round trip. |
| Public `/planned/[slug]` | Not captured | Phase 5 captures desktop/mobile published, not-found, and exposure-boundary states. |
| Standalone teacher test preview | Not captured | Phase 3 captures desktop/mobile authorized behavior, unauthenticated login redirect, and the exact 404 contract for wrong-role, non-owner, missing-test, and classroom-mismatch cases. |
| Gradex status/retry/audit | Product surface does not yet exist | Phase 4 adds and captures the teacher-visible workflow after the backend contract is complete. |

Phase 1 may close with these explicit exceptions because the corresponding code/API/database/test paths are mapped in the audit. The owning phase may not close until its exception has durable evidence or a reviewed product decision removes the surface.

## Evidence Limits

- Seeded local data demonstrates layout and interaction state, not production frequency or user impact.
- Light-theme captures are representative, not an exhaustive duplicate of every dark-theme state.
- DOM snapshots support semantic review but do not replace screen-reader testing or research with disabled users.
- Full-page captures of sticky legacy utility pages can show stitching artifacts; accepted evidence `43`, `44`, `46`, and `47` uses stable viewport captures where stitching obscured the interface.
- The Open Design board is a synthesis artifact. This manifest and the repository audit remain the engineering source of truth.
