# Submission area discussion

2026-08-31: User requested discussion of the busy required-submission editor, one prefilled editable text field per item, removal of Required, and a concise confirmation when an attachment is missing. This note records source findings and a proposed direction; no implementation in this pass.

## Current behavior

- AssignmentSubmissionRequirementsEditor renders label and instructions fields, a Required checkbox, and a link validation panel. Actual item types are Link, Repo and Image. Basic URL, Reachable page and Expected site are validation modes for Link, not item types.
- assignment-submission-validation validates URL format first. Basic stops there; Reachable checks whether Pika can access the page; Expected site also checks the host before and after redirects. Unreachable/login-like generic links yield a warning; domain mismatch is invalid. Repo has separate GitHub validation.
- image-upload allows PNG, JPEG, GIF and WebP up to 10 MB. The existing default image label is Screenshot.
- StudentAssignmentEditor has no submit confirmation; its ConfirmDialog is for history restore. StudentAssignmentsTab delegates Submit to that editor. Missing required artifacts currently disable Submit, and the submit API and database function private.validate_assignment_submission_requirements independently reject them (migration 099).
- StudentAssignmentSubmissionChecklist also displays required counts/badges and separate per-link Save controls. Pending local URL edits must be saved before computing a missing-attachment confirmation, so a freshly entered link is not incorrectly reported missing.

## Proposed direction

- Rename the area Attachments; retain only one editable item label, type icon and Remove action per row, plus the shared add-type menu. Prefill Link, Repo link or Image. Show actual image formats/size as static help, not a second text field.
- Remove the Required toggle and link-check chooser from normal authoring. Recommend automatic basic URL validation for ordinary links. Resolve existing non-default validation policies deliberately during implementation; do not silently discard them as part of a layout change.
- Treat configured attachments as expected. Missing items produce one concise confirmation, e.g. “Repo link is missing. Submit anyway?” with Go back / Submit anyway. Combine multiple missing labels into one prompt; do not stack confirmations. No prompt when everything expected is attached.
- Keep invalid-file/URL safety validation and save-failure protections. A user acknowledging a missing item must not bypass ownership, revision, submitted-document immutability or storage checks.

Implementation requires coordinated editor, checklist, API and database guard changes; a visual-only checkbox removal is insufficient. Any database rollout must follow the repository's explicit target/migration approval rule. This is not approval to apply a migration. Existing stored labels, instructions, attachment identities and grading records must be preserved.
