# Editable workspace title cue

Owner request: 2026-10-16. Show the edit pencil at the right of an Assignment
or Test title on hover, matching the pencil used by More actions → Edit.

- Scope: existing teacher selected-Assignment and selected-Test title buttons.
  Summary list titles retain their existing open-item meaning.
- Reference: the same owner's More actions → Edit Assignment/Edit Test command
  and Lucide Pencil. Existing title-button callbacks and permissions are reused.
- Primary signal: a quiet pencil at the button's right edge, revealed on hover
  or keyboard focus. Reserve its space so the title does not jump.
- Reuse decisions: extend the two existing title buttons; reuse Lucide Pencil.
  No new component or abstraction; no adjacent extraction is needed.
- Preserve borderless framing, truncation, 44px targets, accessible edit names,
  and the shared focus ring. The icon is decorative and does not add a tab stop.
- Read-only/unavailable Assignment titles and read-only Test titles omit the cue.
- Matrix: teacher; desktop/mobile; light/dark; resting, hover, focus, editor open,
  archived/read-only and Assignment details pending. Student is n/a because
  student titles do not edit assessment definitions.
- Composite semantics/handlers: unchanged. Stable guidance followed; no new
  experimental composition or human promotion required.

Verification uses the real teacher grading fixture routes with intercepted
synthetic reads and no persisted writes. Captures/scripts and matrix results are
in the owning worktree's ignored `output/playwright/title-hover/` and
`verify-title-hover.ts`. Existing title-editor tests cover callback routing,
read-only and pending-detail guards, plus decorative icon availability.
