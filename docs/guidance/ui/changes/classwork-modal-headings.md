# Classwork modal headings and save status

User approved visible modal headings on 2026-08-31, then refined the save-status placement to the modal header, centered on the same row as the heading. This replaces the earlier proposed placement above the content field.

Reference: Material's approved visible CreationModalShell heading and Pattern Lab's classwork creation example. Scope: Assignment, Material and Survey creation chrome; no unrelated modal redesign.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Visible modal name | CreationModalShell showTitle | reuse | Assignment and Survey opt into the same heading as Material. |
| Centered header metadata | CreationModalShell | extend | Add an optional center slot with equal-width side columns; heading and Close remain separate. |
| Autosave feedback | SaveStatus | reuse | Move the existing Assignment status without changing persistence; Saved is quiet in this header. |

Primary signal: modal name left, draft save status at the true center, Close right. Keep the editable item title and publication actions in the next row. The heading can truncate on narrow screens without overlapping the status or Close; its complete accessible name remains available. Material and Survey do not autosave, so never show a false Saved indicator there. Preserve scheduled-release metadata, error handling, keyboard/focus behavior and all business logic.

Verification matrix: teacher desktop/mobile × light/dark; header visibility, saved/unsaved feedback, narrow layout, long scrolling content and Close. Student n/a: these are teacher authoring surfaces, and student reading/preview components are unchanged. Existing shell focus tests cover overlay behavior; no new composite widget is introduced. Update the deterministic Pattern Lab shell example as executable evidence. Nearby inconsistent headings in other modal families are a separate audit, not part of this patch.

## Verification

Implemented using opt-in visible headings, an optional center slot and the existing SaveStatus owner. Close now shares the header's vertical center with a 44px target. Scheduled-release information remains beside the item title. Default heading visibility for other consumers is unchanged.

45 affected component tests and eight browser contracts passed, plus architecture, UI/design policy, TypeScript, lint and diff checks. Captured and inspected the actual Assignment and Survey dialogs in the local classroom at desktop 1440×900 and mobile 390×844, in light and dark themes; no write requests occurred. Also inspected Material in all four variants after the shared Close alignment change. Browser contracts check mathematical centering, non-overlap, pinned status during scroll, Close target, Escape and focus return. Existing Assignment autosave tests cover status transitions.

Evidence: this session's visualization directory under modal-headings. Actual authoring captures use local test-classroom data; Pattern Lab captures are fixed, API-free fixtures. Local branch codex/standardize-page-action-icons at base de3f73cd plus uncommitted changes, captured 2026-08-31. No new global visual pattern or persistence behavior; full Pattern Lab snapshot acceptance remains a separate pre-publication step.

## Replace the misleading generic preview

The user correctly identified that “Open creation dialog” showed placeholder paragraphs instead of a comparable authoring form. Replace it with a clearly named Assignment example beside Material. Reference the actual Assignment dialog verified above, using AssignmentForm, AssignmentSubmissionRequirementsEditor, CreationModalShell, SplitButton and the existing preview/scheduling owners (`reuse` for each). Create only a gallery-local composition, not another product modal implementation. Keep all example edits and action outcomes in memory; never mount AssignmentModal's draft-creating controller or call an API. Show the Assignment-specific date and submissions controls, retaining the shared header and editor framing. Production behavior remains unchanged.

Verify teacher desktop/mobile × light/dark, local title/content edits, Preview and nested Escape/focus, publication menu, scheduling and long content; student n/a because this is a teacher-only gallery correction. Confirm no write requests. Replace the old shell-only browser contract with the real-form example.

Completed: the generic dialog is removed, replaced by “Open assignment example” at #assignment-creation beside “Open material example”. Assignment uses the actual form/editor/submission owners with gallery-local state and simulated publication outcomes. Scheduling is a UI example, not a test of production release validation. Eight browser contracts pass across desktop/mobile and light/dark, including live preview of edited instructions, fixed header during long content, nested Escape/focus, action selection, reset on reopen, and no API writes. Architecture, UI/design policy, TypeScript, lint and diff checks pass. Inspected form, preview and schedule captures in all four variants; evidence is under real-creation-examples in the session visualization folder. Capture clock fixed to 2026-08-31 at noon Toronto. Product form/persistence code is unchanged by this correction.

## Assignment Preview icon

User requested removal of Assignment Preview's visible text. Reference: Material's approved eye-only Preview in Pattern Lab.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Eye-only Preview action | IconButton | reuse | Same 44px control, tooltip and accessible name as Material; production and gallery share AssignmentForm. |

Only replace the existing Preview button presentation. Preserve disabled state, callback, preview rendering and save behavior. Verification: teacher desktop/mobile × light/dark, icon-only text, 44px target, tooltip on focus, activation and nested Escape/focus return. Student n/a: teacher authoring control only. No new component or experimental pattern.

Completed: AssignmentForm now uses the same IconButton as Material. Forty affected component tests, four browser contracts, UI/design policy, TypeScript and lint pass. Inspected all four viewport/theme form captures; the button has no visible text, retains the Preview name/tooltip and 44px target, and keyboard activation/Escape restores focus correctly. Evidence: assignment-preview-icon in the session visualization folder; fixed 2026-08-31 sample clock, local uncommitted branch. No API writes during the gallery checks.
