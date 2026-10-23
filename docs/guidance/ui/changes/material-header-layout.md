# Assignment and Material authoring header

Owner approved the interactive `material-header-prototype/editors/editor.html`
reference on 2026-10-22. Scope: teacher Assignment and Material dialogs, extending
Pattern Lab `assignment-edit-split` and `material-creation`. Risk profile: none.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Separate context header | CreationModalContextHeader | extend | Opt-in 76px row with 24px item type and fading classroom context |
| Accessible title | FormField / Input | reuse | Title placeholder and hidden label below the context header |
| Content modes and saving | MarkdownAuthoringEditor / SaveStatus | reuse | Shared Write / Markdown controls and quiet saving indicator |
| Material source compatibility | MaterialCreationDialog and limited-markdown | extend | Store exact source in document attrs; retain legacy rich content until an edit |
| Close, preview, publishing | CreationModalShell, ContentDialog, SplitButton | reuse | Preserve dismissal, explicit save, nested overlay and scheduling owners |

The left header is separate from the muted details body. Right-pane saving,
Write / Markdown and the panel-owned X share the existing top row. No visible
Title or Unsaved label. Material source edits persist exact source in
`content.attrs.authoring_markdown` alongside derived reader-compatible nodes.
Opening, selecting modes, previewing and title-only saves preserve legacy JSON.
Legacy rich edits enter the Markdown compatibility boundary and report conversion
warnings. Material preview and student reading treat persisted authoring source as
authoritative through LimitedMarkdown; legacy documents retain ManagedImage
rendering. Assignment instruction readers use the same Markdown image boundary. No new dependencies or automatic publication.

Verification matrix: teacher new/existing/draft/posted/scheduled, empty/long title,
long classroom, Write/Markdown, editing, preview, saving, read-only, failure,
keyboard/focus; 1440×900 and 390×844, light/dark. Student authoring n/a; existing
student material and assignment reading remain in the parent verification scope.
Composite review: inherited mode selector, toolbar, publishing menu and nested
preview/schedule overlays. Final visual verification and policy checks are owned
by the coordinating task. No stable guidance promotion is introduced.
