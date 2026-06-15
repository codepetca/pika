# UI Change Brief

Use this brief before starting any non-trivial UI or UX change. The goal is to lock the acceptance target early enough to avoid post-PR visual churn.

If the task is small but still user-visible, answer this briefly in the plan or PR notes.

## Required Brief

Record these items before coding:

- Surface: page, tab, modal, menu, card, or shell being changed
- Reference: existing Pika surface or governed canon that the new work should resemble
- Affected roles: teacher, student, unauthenticated, or not-applicable
- Required viewports: desktop, mobile, or both
- Required themes: light, dark, or both
- Key interaction states: default, hover, focus, open, selected, loading, empty, edit, drag, or any state that materially changes visuals
- Primary signal: the one visual cue that should do the work, such as accent edge, gradient, icon, or elevation
- Must not add: visual treatments or extra UI elements that are explicitly out of scope
- Composite widget accessibility review needed: yes/no

## Recommended Acceptance Language

Use compact language like:

```text
This is a refinement of the existing teacher work-surface pattern, not a redesign.

Primary signal: the pencil options menu and primary action button grouping.
Must not add: extra marker dots, decorative subtitles, or duplicate selection chrome.

Verify teacher and student where applicable, desktop and mobile, light and dark, plus hover/open/selected states.
```

## Verification Matrix

Before marking UI work complete, confirm each relevant row:

| Dimension | Required declaration |
|---|---|
| Role | `teacher`, `student`, or `n/a` |
| Viewport | `desktop`, `mobile`, or `both` |
| Theme | `light`, `dark`, or `both` |
| States | Explicit list of affected visual states |

Do not leave this implicit in screenshots alone. If a dimension is not relevant, say why.

## Escalation Rule

Stop and seek human judgment before continuing when:

- the brief cannot name a clear reference surface
- the primary signal changes mid-implementation
- the work introduces a new visual pattern that does not fit stable guidance
- multiple acceptable treatments remain and the difference is product judgment rather than implementation quality
