# Product Experience Evidence (July 2026)

## Purpose

This manifest makes the Phase 1 product audit reviewable after the local browser session ends. The full local set contains 53 screenshots and 52 matching DOM/accessibility snapshots under the ignored `artifacts/product-experience-audit` directory. The initial dark login screenshot is the only image-only capture.

Twenty-three representative screenshots are committed below. They cover the three role/shell regimes, the highest-risk teacher/student workflows, desktop/mobile behavior, both themes, lifecycle controls, and the utility routes added during audit review.

The matching DOM `.txt` files are committed beside each screenshot with the basename shown in the final column.

Open Design project: `Pika Product Experience Audit` (`ec89fd79-1229-4143-8f69-cf24842c6584`). Generation run: `879efda2-651b-4b5c-aeba-111e43e0cab4`. Review run: `b503a4ba-f0c0-41df-85a5-6b349588c7e7`. The final board was browser-verified at desktop and mobile widths; the mobile root measured `375px` client and scroll width.

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
| 48 | Shared | Login | 1440x900 | Light | Password login | [48 login](./evidence/product-experience-2026-07/48-auth-login-light-desktop.png) | `48-auth-login-light-desktop.txt` |
| 49 | Shared | Signup | 1440x900 | Light | Verification-code request | [49 signup](./evidence/product-experience-2026-07/49-auth-signup-light-desktop.png) | `49-auth-signup-light-desktop.txt` |
| 50 | Shared | Forgot password | 1440x900 | Light | Reset-code request | [50 password reset](./evidence/product-experience-2026-07/50-auth-reset-light-desktop.png) | `50-auth-reset-light-desktop.txt` |

## Local-Only Evidence

The ignored local set additionally covers teacher Daily, Classwork summary, Tests summary, Gradebook, Roster, classroom Calendar, Syllabus, Settings, blueprint actions/create, student Classwork summary, assignment instructions, Tests summary, Calendar, Syllabus, Announcements, and additional mobile summary states. The numeric filenames and matching `.txt` snapshots are the stable references used in the audit document and Open Design board.

The temporary archive evidence used only the seeded local database. The fixture was set to hot-archived long enough to capture Restore/Delete, then `archived_at` was restored to `null` and verified. No production data was read or modified.

## Evidence Limits

- Seeded local data demonstrates layout and interaction state, not production frequency or user impact.
- Light-theme captures are representative, not an exhaustive duplicate of every dark-theme state.
- DOM snapshots support semantic review but do not replace screen-reader testing or research with disabled users.
- Full-page captures of sticky legacy utility pages can show stitching artifacts; accepted evidence `43`, `44`, `46`, and `47` uses stable viewport captures where stitching obscured the interface.
- The Open Design board is a synthesis artifact. This manifest and the repository audit remain the engineering source of truth.
