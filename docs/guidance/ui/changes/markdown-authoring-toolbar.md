# Course Guide and assignment Markdown authoring

Owner approved the quieter toolbar and consistent Write / Markdown switch on
2026-10-22. Scope: Course Guide overview and teacher assignment instructions.
Risk profile: none (client authoring only; existing Markdown persistence).

Reference: the existing Course Guide editor, assignment instructions, Pattern
Lab `assignment-edit-split`, and stable `selection-controls` / `form-fields`.
Keep the existing reading surface, classroom shell, save/cancel and autosave
owners. No new dependencies, schema changes, student-document changes or AI
generation workflow.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Mode selection | SegmentedControl | reuse | Peer editor modes with shared keyboard and focus behavior |
| Formatting | RichTextEditor and Tiptap commands | extend | Opt-in Markdown authoring preset: Bold, Italic, Link, Format |
| Source and visual composition | MarkdownContentEditor | create | Two real adopters share a controlled Markdown value and mode contract |
| Field labels | ContentField / FormField | reuse | Preserve accessible names in both modes |

The Format menu contains headings 1–3, bullet/numbered lists, quote, code block
and inline code. Only offer formatting the existing limited Markdown boundary
can save. Rich document controls and presets remain owned by their existing
consumers. Opening or switching modes never emits a content change; actual
edits update the same Markdown draft. Source editing preserves literal input.

Primary signal: selected Write / Markdown option. Retain a compact formatting
row; omit extra count, undo/redo buttons, alignment and decoration controls for
these two surfaces. Existing keyboard undo/redo remains available in Write.
The shared composition is scoped to these adopters; wider adoption remains
experimental pending human promotion.

Verification: teacher editing and student reading, desktop 1440×900 / mobile
390×844, light/dark; Write, Markdown, Format open, focus/keyboard, edited,
disabled/retiring, save/cancel and existing Markdown entry paths. Composite
review required: segmented selection and Radix editor menu keyboard/focus.
Confirm no horizontal overflow and no Markdown writes merely from mode changes.

Evidence and final review receipt will be recorded below.

## Verification receipt — 2026-10-22

- `pnpm check:focused -- --base origin/main --max-workers 2`: 121 files /
  2,093 tests; architecture, UI policy, design policy, TypeScript and lint passed.
- Playwright `ui-pattern-lab.spec.ts --grep 'Markdown authoring'`: 8/8 across
  teacher/student, 1440×900 and 390×844, light/dark. Student captures were
  refreshed (4/4) with an explicit in-viewport assertion after visual inspection
  found smooth scrolling had captured the gallery header instead of the target.
- Current conformance captures: local task visualizations `markdown-authoring/`;
  the PR records the implementation SHA and full provenance. Production owners
  run in gated local fixtures with deterministic data and intercepted API writes.
- Composite checklist reviewed: yes. Mode pressed state, arrow-key focus,
  Format menu keyboard open/Escape return, 44px toolbar targets, retirement,
  existing preview undo and autosave covered. No remaining manual follow-up.
- Pika audit passed. No raw design-value additions. The two native source
  textarea registry entries became one shared source textarea owner.
- Refactor candidate: Blueprint guidance retains its separate source/visual
  composition; broader adoption and any Markdown-dialect expansion are outside
  this change. Student rich documents retain their existing preset.

## Independent review correction

The initial complete review at `46c0c799c` found one P2 keyboard blocker: the
newly reachable toolbar inherited Tab trapping. One remediation batch lets
native toolbar Tab/Enter handling proceed while retaining arrow navigation.
The new Tab regression failed before the fix; 75 focused editor/lifecycle tests
and TypeScript passed after it. Teacher browser checks passed 4/4 with explicit
forward Tab and reverse Shift+Tab assertions. Existing student reading evidence
remains applicable because the correction changes only toolbar keyboard handling.
