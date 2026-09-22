# Student editor image upload

2026-09-21: follow-up to the assignment-history compatibility fix in PR #1313.

## Change brief

- Surface: student Assignment rich-text editor.
- Reference: the existing editor toolbar and its paste/drop image behavior, which already inserts an image only after upload success. The submission checklist's explicit pending/failed upload recovery is the state-management reference.
- Affected roles: student. Teacher history remains unchanged and continues to render legacy unfinished uploads as a note.
- Viewports: desktop and mobile.
- Themes: light and dark.
- States: default, native picker cancellation, uploading/progress, failed/retry/remove, completed image, read-only legacy placeholder.
- Primary signal: one compact status row directly below the editor toolbar while an image needs attention.
- Must not add: a serializable upload placeholder, a modal, a second attachment system, or new persistent instructional copy.
- Composite widget accessibility review: yes. The toolbar action opens a labeled native file input; progress uses a polite status region; failures use an alert with keyboard-reachable Retry and Remove actions.

## Ownership decisions

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Image toolbar action | `ImageUploadButton` | extend | Keep the established icon, tooltip, shortcut, focus, and toolbar geometry while changing the action to picker-first. |
| Upload transport and managed image insertion | `RichTextEditor` upload/paste/drop path | reuse | It already uploads to the managed Assignment document and inserts only a completed `image` node. |
| Upload progress and recovery | `RichTextEditor` | extend | State is specific to the active editor and must stay outside serialized Tiptap JSON. |
| Submission gate | `StudentAssignmentEditor` state contract | extend | The owner already computes `canSubmit` and performs the imperative submit preflight. |
| Legacy unfinished upload display | `ReadOnlyImageUpload` | reuse | PR #1313 established the safe compatibility representation for old saved content. |

This is an interaction correction within the existing student editor, not a redesign. A picker cancel leaves the answer untouched; failure remains transient until retry or removal; only a completed managed image enters autosave and history.
