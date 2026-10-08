# Account menu hydration — 2026-10-08

Surface/reference: production UserMenu inside AppHeader and TeacherWorkSurfaceActionCluster dropdowns and existing teacher/student classroom shell fixture. Both roles, desktop/mobile, light/dark, normal/reduced motion; closed menu hydration, keyboard opening, Escape and focus return. Preserve geometry, menu actions and authentication behavior.

Strict assignment/journal browser contracts expose mismatched server/client generated menu IDs. The closed server menu remains hidden; the client attaches inert through its existing ref, without client-only ID relationships. Attach the existing useDropdownNav unique IDs when the useDropdownNav mounted state confirms hydration. Retain every keyboard handler and generated ID; no header or keyboard API changes.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Hydration readiness | React state/effect inside useDropdownNav | extend | Add a server/first-client false and hydrated-client true phase using existing React dependencies |
| Unique IDs and keyboard behavior | useDropdownNav | reuse | Preserve instance uniqueness and focus behavior |
| Dropdown relationship attachment | useDropdownNav | extend | Attach client-owned relationships after hydration; closed server menu remains hidden |

Composite accessibility review: required. Verify server menu hidden and hydrated closed menu inert, unique IDs for multiple owners, trigger/menu labeling after hydration, keyboard opening and Escape focus return. Do not suppress hydration warnings, patch dependencies or change visual styling. Browser evidence retains strict console-error assertions.
