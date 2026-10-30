# RepoLight selected-student analysis — UI brief

Teacher assignment workspace; reference: the existing selected-student actions menu and AI Grade confirmation, plus the RepoLight report's private-draft import. Reuse the action menu and confirmation dialog; extend the assignment workspace with bounded per-student progress and outcomes. No shared component or new Pattern Lab pattern is proposed. The student surface is unaffected.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Selected-student action | Teacher work-surface action menu | reuse | The action belongs beside AI Grade. |
| Confirmation | ConfirmDialog | reuse | Explain draft-only operation and page-open requirement. |
| Batch progress | Existing workspace feedback and overlay | extend | Show activity and per-student outcomes without a new shared widget. |
| Individualized feedback | RepoLight report and guarded draft import | reuse | Preserve each student's identity, report digest and draft revision. |

Verify teacher desktop and mobile in light and dark, including selected, confirming, running, completed and failed/skipped states, keyboard and focus behavior. Student view is n/a: no student-facing UI changes. Primary signal is analysis status; no grade changes, AI, automatic sending or Return. Review menu and dialog composite-widget behavior.
