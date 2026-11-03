# Teacher Classwork progressive list — 2026-11-03

Surface: teacher Classwork summary and its loading, count, error, retry, and
reorder states. The approved reference is the existing teacher Classwork
work-surface and its cards, with the teacher work-surface canon. Pattern Lab's
`#page-states` and `#teacher-patterns` entries are the executable references
for shared state and work-surface composition; both were rendered and inspected
at desktop light, then compared with the existing surface captures. The existing
teacher assignment-grading fixture provided the real Classwork owner for the
captures below.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Classwork list and cards | Teacher Classwork cards and work surface | reuse | Preserve item presentation and actions. |
| Loading and retry feedback | Existing refreshing indicator, page state, alert and button | reuse | Expose pending and failure without a new visual primitive. |
| Pending counts | Existing assignment and survey cards | extend | Show loading or unavailable text until real counts arrive. |
| Read coordination | Existing Classwork loader and request cache | extend | Keep summary and full data distinct and guard stale results. |

Role: teacher; student is n/a because student views are unchanged. Viewports:
desktop and mobile. Themes: light and dark. States: pending, complete, failed,
retry, keyboard focus, and edit/reorder; empty and warm-refresh behavior retain
existing component coverage. Primary signal: existing card title with explicit
count state. No new shell, icon, color convention, or shared pattern is proposed.
Composite-widget checklist reviewed: yes. Semantic pending/disabled state and
keyboard behavior are covered by tests and a synthetic Playwright run; manual
keyboard traversal reached both completed items and performed a keyboard reorder.

Visual evidence: intercepted synthetic teacher fixture captures are under
`/tmp/classwork-final-{desktop-light,mobile-light,desktop-dark,mobile-dark}-{pending,complete,error}.png`.
Representative images in each state and both viewports/themes were inspected;
the synthetic 500 captures include Next's development issue indicator. No
production data or persistence was used. An independent final review remains outstanding; do not treat these captures as a
production acceptance or a substitute for them.

Legacy cold reads add up to two summary requests and start the full count reads
after legacy mode is identified. Until all full list data is present, cards,
creation, editing and reorder are disabled. The shared owner path continues to
return its existing full response and reuses the existing full cache.
