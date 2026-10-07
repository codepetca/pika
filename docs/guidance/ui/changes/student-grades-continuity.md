# Student Grades reactivation and recovery continuity

Surface: actual student Classroom Grades tab. Reference: approved Student Grades contract, stable page-state conventions, StudentAssignmentsTab’s classroom reset/active-edge read and Retry focus handoff, and deterministic Pattern Lab Student Grades visibility. Pattern Lab composition is appearance evidence; no experimental pattern is introduced or promoted. Coordinator inspected desktop/mobile light/dark reference screenshots in external product-fluidity/student-grades-next-audit/references.

Roles: student; teacher n/a because only the student Grades reader and Grades-only student prefetch and scroll-history change, with shared controls unchanged. Viewports: desktop 1440×900 and mobile 390×844. Themes: light and dark. Motion: normal and reduced, with existing semantics retained. States: initially inactive, cold loading/error/Retry, returned long list, same-classroom hidden/reactivation pending/success/failure/Retry, empty success, changed classroom, authoritative access denial and obsolete completion. Primary signal: Current grade and existing request status. No extra chrome, layout redesign, animations, grade calculations/disclosure change, API/schema/dependency change, Pal change or shared cache redesign. Composite widget review: n/a; existing navigation, links and buttons retain keyboard contracts.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Returned grade composition | StudentGradesView and Card | reuse | Preserve grades, stable row keys, links, zero and Not counted. |
| Cold state and retry | PageState and Button | reuse | Canonical request-state presentation and control semantics. |
| Warm request feedback | Existing Grades alert and RefreshingIndicator | reuse | Keep last usable snapshot visible during recovery. |
| Active-edge lifecycle | StudentGradesTab and Student Classwork reference | extend | Separate classroom ownership reset from same-owner activation. |
| Retry focus destination | Feature-owned Grades work region | extend | Focus a stable named region with preventScroll before replacing Retry. |
| HTTP failure identity | Existing pure ApiError | reuse | Preserve status through the tab and shared Grades prefetch promise without API/cache changes. |

Keep the existing `student-grades:<id>` key, 30-second TTL, deduplication and intent behavior. Explicit Retry may invalidate only the affected key. Same-classroom pending reads may finish while the retained tab is inactive; they cannot activate navigation. Newer reads supersede prior publication; classroom change/unmount retire old success, error and finally callbacks. Recoverable failures retain only the current classroom’s successful snapshot. Authoritative 401/403/404 clears it, including prefetch failures and non-JSON denial bodies. Successful responses reconcile the exact new projected data, including empty results. Background reads do not move focus.

Verification planned: real-cache delayed-response behavior tests; native actual Classroom owner recordings/screenshots across declared matrix; stable row identity, saved scroll, Retry focus, immediate navigation, links, access denial and obsolete completion checks; UI/design policies, focused check, independently reviewed frozen draft PR, normal exact-head CI. Fixture identities/API interceptions must be explicitly qualified; no authenticated persistence or hardware INP claim.

Nearby candidate: Achievements’ local render-boundary recovery remains a separate open finding; no changes here. Passing this slice does not complete the Grades/Achievements family or product-wide goal.

## Browser-discovered scroll boundary

With the corrected read fixture and retained Grade rows, actual Classroom navigation still returned a long list at scrollY=0 instead of the saved 900. The shell reads departing scroll in a passive effect after hidden content has shortened the document and clamped its scroll. Extend the existing shell scroll history only for student Grades: observe actual active Grades scroll before departure, retire that observer during commit, and do not overwrite its saved value with the post-hide position. Other tab and teacher scroll contracts remain unchanged. This feature-scoped correction is part of Grades continuity; no new shell abstraction, shared primitive or motion. Native regression evidence is retained in the external native-scroll-before folder.

## Local verification

Real-cache behavior coverage: 22 tests pass, including current versus obsolete requests, initially inactive behavior, repeated Retry, owner/unmount retirement, recoverable failures, authoritative JSON and non-JSON denials, and keyboard focus before Retry replacement. TypeScript passes. The corrected original-owner browser baseline loses its returned row when leaving Grades (genuine regression); the first incomplete Gradebook-items fixture is retained and explicitly excluded from behavioral evidence.

Eight native scenarios pass across the declared viewport/theme/motion matrix, with actual 30-second TTL expiry and prefetch-before-activation. They cover row identity, saved scroll, keyboard Retry focus, recoverable error, updated/removed rows, non-JSON denial and empty recovery. Four additional normal-motion scenarios capture the focused error alert after the keyboard naturally scrolls it into view. Screenshots of pending, recovered, denied, cold retry and empty states plus all four focused error views were inspected against the approved references; desktop/mobile layouts and light/dark colors are acceptable. API identities/responses are synthetic and intercepted; this proves owner/shell behavior, not authenticated persistence or hardware performance. Videos are retained without claiming all were replayed.

Final base integration, required focused checks/audit, draft-first independent review and exact-head CI remain required before merge.
