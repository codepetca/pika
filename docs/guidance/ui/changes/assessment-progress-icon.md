# Assessment progress icon

Owner approved 2026-10-08: apply the Pattern Lab yellow two-thirds ring over
grey to the shared production assessment status icon.

- Surface/reference: `/pattern-lab#status-colors`, existing Classwork & Tests examples.
- Roles: teacher and student fixture previews. Viewports: 1440×900 and 390×844.
- Themes: light and dark. State: static In progress beside the other existing statuses.
- Primary signal: a 240° yellow arc over a complete grey 16px ring.
- Exclusions: status logic, labels, late clock, other status icons and animation.
- Composite-widget review: n/a; the changed indicator is passive.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Status labels and layout | AssessmentStatusIndicator | reuse | Preserve domain status meanings |
| Partial ring | AssessmentStatusIcon and Lucide Circle | extend | Shared assessment owner with two existing icon layers |
| Yellow colour | Semantic colour tokens | extend | Dedicated assessment-progress token in both themes |
| Reference examples | StatusPatterns | reuse | Production owner, including the late variant |

The shared owner uses `text-assessment-progress` for the yellow arc and
`text-text-muted` for the grey ring. Lucide's radius-10 circle uses dash lengths
40π/3 and 20π/3, with flat ends and a top starting point. Both layers scale with
the existing icon boundary. The ratio indicates the status category, not measured
task completion. Labels, status calculations, and the late clock are unchanged.

Pattern Lab renders this same production owner; the fixture-only icon copy was
removed. No additional shared component or nearby refactor is needed.

Verification evidence is recorded in the PR and session log. Required matrix:
teacher/student × 1440×900/390×844 × light/dark, normal and late progress beside
unchanged statuses, plus the existing compact icon-sizing contract.
