# Test publication date

Owner request 2026-10-15: replace the standalone Test date field with Publish today / Schedule test, then a clickable date offering Change date and valid Unpublish. Future closed Tests stay hidden from the student's Tests list until the Toronto date, while remaining visible on Calendar. This supersedes the date-entry/list behavior in [the original calendar-date brief](./test-calendar-date.md); it does not change learner authorization or per-student access.

Surface: selected Test workspace and split authoring dialog, student Tests and Calendar navigation. References: existing Tests operational context bar, teacher work-surface menu, split editor, Pattern Lab core controls/forms and Test controller. Primary signal: the existing primary Publish button becomes a quiet date label. No new chrome, status colors, access automation, dependency, schema, or background scheduler. Composite review required: menu arrows/Home/End/Escape and restoration, nested picker/dialog focus and invalidation.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Publication menu | TeacherWorkSurfaceMenuButton | reuse | Shared navigation and focus |
| Date form | DialogPanel, FormField, Input, Button | reuse | Native civil-date picker and governed modal |
| Save and acknowledgement | useTestCalendarDate | extend | Synchronize authoritative changes between the two controls |
| Publication composition | TestPublicationControl | create | Two genuine adopters: workspace and authoring dialog |
| Future list presentation | StudentTestsTab / PageState | extend | Keep unfiltered API/cache available to Calendar and explain scheduled selections |

Teacher and student: desktop 1440×900, mobile 390×844, light/dark. States: draft, open/focused menu, date picker, scheduled date, edited date, immediate publication, unpublish confirmation/cancel, unavailable unpublish, date-save failure/retry, owner replacement, student hidden-list/calendar/scheduled selection, Toronto midnight reveal. Both roles are affected. Local composition only; no stable shared primitive or icon/status contract changes. Existing prototype authoring layouts remain experimental, not new authority. No unrelated extraction.

Save the date through the strict metadata PATCH, then perform existing draft validation and publication confirmation. Date failure prevents publication. If publication fails, the saved date remains on the draft and publication can be retried. Publication remains closed; it never opens student access. Unpublish uses its existing atomic POST and backend validity checks. Future rescheduling is available only while the existing unpublish preflight is valid, preventing ordinary date edits from concealing worked Tests. Manual open access, active Tests and submitted/returned work remain visible even if dated in the future.

The API intentionally still includes scheduled Test metadata, because Calendar must display it. Tests list filtering is presentation, not a secrecy or authorization boundary. Reveal uses Toronto midnight with focus/visibility reconciliation. No migration or cron is needed. Browser scenarios intercept all requests and use production UI owners; their writes are synthetic, not database persistence evidence.

Verification: `e2e/test-publication-date.ui-pattern-lab.spec.ts` covers both roles and all four viewport/theme projects. Component/helper tests cover failure, scope, unpublish eligibility and Toronto/DST boundaries. Final execution evidence is recorded in the session log and PR.
