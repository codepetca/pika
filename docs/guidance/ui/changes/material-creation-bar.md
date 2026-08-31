# Material creation bar

User approved the Material-first proposal on 2026-08-31. Preview uses only an eye icon, with the accessible name and hover/focus tooltip “Preview”.

Reference: AssignmentForm's CreationModalTopRow and the Pattern Lab tall CreationModalShell example. Extend the approved composition to Material; keep Assignment and Survey unchanged in this pass.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Tall dialog and title row | CreationModalShell / CreationModalTopRow | extend | Opt-in visible heading and existing ModalLayer initial-focus marker; other consumers unchanged. |
| Preview control and overlay | IconButton / ContentDialog / RichTextViewer | reuse | Named eye control; viewer matches student material rendering. |
| Publication actions | SplitButton | reuse | Post/Save with Save draft choice; retain Delete for existing materials. |
| Material composer presentation | Existing inline TeacherMaterialDialog presentation | extend | Extract its presentation for production and deterministic Pattern Lab evidence; leave mutation ownership unchanged. |

Primary signal: one pinned top bar, title left, Preview next, publication action right. Mobile title occupies its own row; reserve Close space. Content scrolls within the existing tall shell. Remove redundant heading/subtitle and bottom publishing bar. Preserve manual saving, draft/post payloads, read-only and busy guards, and delete confirmation. No scheduling, autosave, date placeholder, new dependency, or changes to other classwork types.

Verification: teacher desktop/mobile, light/dark; empty/filled title, preview, tooltip/focus, dropdown keyboard, saving/error, read-only, long-content scrolling, close and focus return. Student authoring n/a; Preview reuses the student RichTextViewer and renders draft content locally without saving. Composite review required for SplitButton and nested preview. Experimental example pending acceptance before promoting broader shared guidance.

Risk profile: none (bounded presentation and local preview). Model recommendation: current Codex model for the implementation and verification.

## Implemented refinement and verification

Material now opts into a visible New Material / Material heading with the close control beside it; the Ungraded classwork subtitle is removed. This is the first example of the suggested heading convention, not a bulk change to all modals. Publication context is quiet Not posted / Draft / Posted text, never a false autosave indicator. Preview is an eye-only IconButton with hover/focus tooltip and accessible label Preview, opening current unsaved content in ContentDialog through the same RichTextViewer used by student materials. Preview width follows Assignment's bounded reading overlay.

Production retains its existing TeacherMaterialDialog state, POST/PATCH payloads, manual save and delete-confirmation callbacks. Only presentation moved into MaterialCreationDialog. Choosing Save draft changes the primary action; clicking that button confirms the save, matching the Assignment split-action model. Save/preview do not introduce scheduling. Closing still follows the existing manual-save behavior; discard-warning parity remains future work.

Pattern Lab includes a deterministic MaterialCreationPattern at #material-creation. It renders the production view and changes local sample state only. Assignment and Survey remain unchanged. Neither default heading visibility nor focus behavior changed for other CreationModalShell consumers.

Validation: 136 files / 1,341 tests passed in the focused suite. A final equivalent spacing-token correction was followed by 59 affected tests, architecture, UI/design policy, TypeScript and lint. Four browser contracts passed after the correction, covering teacher desktop/mobile and light/dark. Inspected editor, menu, preview and long-content/error screenshots; checked 44px Preview targets, title/close separation, pinned actions with 40 lines of content, tooltip, keyboard menu selection, nested Escape/focus return, validation and explicit draft confirmation. Busy/read-only/delete behavior is covered by component tests. Student authoring is n/a, and student rendering is unchanged; the preview directly reuses its content renderer.

Evidence: session visualization folder material-creation-bar, four viewport/theme subfolders. Logs: /tmp/pika-material-focused.log, /tmp/pika-material-unit-final.log, /tmp/pika-material-e2e-final.log, /tmp/pika-material-final-policy.log, /tmp/pika-material-types-final.log, /tmp/pika-material-lint.log. The focused runner stopped at the spacing policy before the correction; later checks passed individually rather than rerunning the entire suite for an equivalent utility token. Full Pattern Lab snapshot-baseline acceptance remains required before publication. No PR, commit or production merge.
