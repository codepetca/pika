# Submission area discussion

2026-08-31: User requested discussion of the busy required-submission editor, one prefilled editable text field per item, removal of Required, and a concise confirmation when an attachment is missing. This note records the source findings, approved direction, and implementation state.

## Current behavior

- AssignmentSubmissionRequirementsEditor renders label and instructions fields, a Required checkbox, and a link validation panel. Actual item types are Link, Repo and Image. Basic URL, Reachable page and Expected site are validation modes for Link, not item types.
- assignment-submission-validation validates URL format first. Basic stops there; Reachable checks whether Pika can access the page; Expected site also checks the host before and after redirects. Unreachable/login-like generic links yield a warning; domain mismatch is invalid. Repo has separate GitHub validation.
- image-upload allows PNG, JPEG, GIF and WebP up to 10 MB. The existing default image label is Screenshot.
- StudentAssignmentEditor has no submit confirmation; its ConfirmDialog is for history restore. StudentAssignmentsTab delegates Submit to that editor. Missing required artifacts currently disable Submit, and the submit API and database function private.validate_assignment_submission_requirements independently reject them (migration 099).
- StudentAssignmentSubmissionChecklist also displays required counts/badges and separate per-link Save controls. Pending local URL edits must be saved before computing a missing-attachment confirmation, so a freshly entered link is not incorrectly reported missing.

## Proposed direction

- Name the area Submission Requirement; retain only one editable item label, type icon and Remove action per row, plus a compact `+` menu trigger for adding Link, Repo or Image requirements. Give the icon-only trigger an accessible name, tooltip and full touch target. Prefill Link, Repo link or Image. Show actual image formats/size as static help, not a second text field.
- Remove the Required toggle and link-check chooser from normal authoring. Recommend automatic basic URL validation for ordinary links. Resolve existing non-default validation policies deliberately during implementation; do not silently discard them as part of a layout change.
- Treat configured attachments as expected. Missing items produce one concise confirmation, e.g. “Repo link is missing. Submit anyway?” with Go back / Submit anyway. Combine multiple missing labels into one prompt; do not stack confirmations. No prompt when everything expected is attached.
- Keep invalid-file/URL safety validation and save-failure protections. A user acknowledging a missing item must not bypass ownership, revision, submitted-document immutability or storage checks.

Implementation requires coordinated editor, checklist, API and database guard changes; a visual-only checkbox removal is insufficient. Any database rollout must follow the repository's explicit target/migration approval rule. This is not approval to apply a migration. Existing stored labels, instructions, attachment identities and grading records must be preserved.

## Implementation checkpoint

- The teacher editor now presents Submission Requirement as one compact single-line row per configured Link, Repo link or Image: drag handle, type icon, editable label and Remove. A single tooltip-backed `+` button opens the type menu. Image limits remain attached to the label as accessible help without increasing row height. Existing hidden instructions, required flags and validation policies remain in the draft payload so editing an assignment does not erase historical data.
- The student checklist counts every configured attachment as expected, saves pending URL edits before submission, blocks present-but-invalid attachments, and groups every missing label into one shared confirmation dialog.
- The submit API requires `allow_missing_attachments` plus an exact, duplicate-free match to the currently missing requirement IDs. It forwards only that server-computed canonical set, so neither extra IDs nor a newly missing requirement can be covered by an earlier confirmation. Ownership, revision and immutable-submission checks remain unchanged.
- Migration `144_allow_acknowledged_missing_assignment_attachments.sql` compares that exact acknowledgement set inside the locked submission transaction while still blocking present invalid attachments. Preparing this file does not authorize applying it to any database.
- Pattern Lab contains API-free teacher and student examples. The verified matrix covers both roles at desktop/mobile widths in light/dark themes, including the missing-attachment confirmation.
- The Assignment form hides the visible Title and Instructions labels to keep the authoring header compact. The fields use `Title` and `Instructions` placeholders while retaining their accessible labels; other creation forms are unchanged.
- The redundant “Students see this before they begin” hint is removed, and Assignment alone uses a tighter top content inset between the modal heading and Title field. On desktop, the Title field aligns with the top of the row instead of waiting for the taller Due-label control, reducing that gap without changing the mobile stack or hiding the due context. Material and Survey shell spacing remain unchanged.
- Assignment due-date context follows Daily's established date-button pattern: the relative date appears as a muted compact subtitle inside the date button instead of a separate label above it.
- Daily and Assignment now share one date-label button owner. It uses zero gap between the date and subtitle and can reserve the subtitle line, keeping the control height stable when relative context is hidden or unavailable.
