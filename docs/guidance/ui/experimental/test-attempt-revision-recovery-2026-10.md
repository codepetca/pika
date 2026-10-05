# Test attempt revision recovery

Acceptance brief recorded before client edits, 2026-10-04. Source/backend work remains unexecuted against a database until exact migration permission and replay proof.

Surface: existing student test response form and inline action footer. Reference: production StudentAssignmentEditor conflict recovery, canonical SaveStatus/Button/ConfirmDialog and executable `/pattern-lab?role=student` Controls save-status examples, inspected on local port3317. DESIGN, src/ui README, stable guidance, change brief and visual procedure loaded.

Roles: student editing/recovery; teacher closure/return backend behavior also requires teacher lifecycle proof. Viewports desktop1440x900 and mobile390x844, light/dark. States: saved, editing, saving, failed save, stale-tab conflict, explicit load-saved confirmation, submit, teacher close/reopen/return. Primary signal: existing save status plus danger alert with a single recovery action. Preserve layout and shell. No decorative signal, new shared widget or automatic overwrite of retained local answers.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Save feedback | src/ui/SaveStatus | reuse | Existing semantic/live status owner and Pattern Lab evidence |
| Response form and footer | StudentTestForm | extend | Preserve current questions, keyboard interaction and inline footer |
| Stale-save explanation | Current form alert / StudentAssignmentEditor recovery | extend | Preserve local responses and stop retries until explicit recovery |
| Load latest saved answers | Button + ConfirmDialog | reuse | Existing accessible44px action and explicit destructive-replacement confirmation |
| Revision serialization | StudentTestForm interaction queue | extend | Serialize feature-specific network interaction in its existing owner |

No new stable visual pattern or promotion requested. Experimental note documents a feature interaction only. Composite accessibility: no new composite widget; existing confirm-dialog keyboard/focus contract retained. Final screenshots must be visually inspected and source-contract/runtime limitations labeled. Deterministic production-owner fixture may demonstrate client conflict behavior without applying migration244; that does not establish database correctness.
