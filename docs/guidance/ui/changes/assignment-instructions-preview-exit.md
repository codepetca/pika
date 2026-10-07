# Assignment Instructions preview dismissal

Scope: teacher AssignmentModal Instructions ContentDialog only. Risk: workspace-state. Reference: canonical ContentDialog/ModalLayer opacity opt-in and Pattern Lab DialogEntryPattern, with actual AssignmentModal lifecycle evidence. This caller accepts retention of its static LimitedMarkdown renderer. No shared default or wider experimental canon promotion.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Brief visual exit | ContentDialog exitMotion opacity | reuse | Existing duration, easing, inertness, focus and reduced-motion contract |
| Feature caller and delayed title focus | AssignmentModal | extend | Cancel initial/post-create title callbacks for preview and session changes |
| Instructions and editor | LimitedMarkdown, AssignmentForm and Tiptap | reuse | Shared committed presentation retains outgoing text; editor identity/history remain owned by the feature |
| Actual owner evidence | Gated teacher-assignment-preview fixture | create | Deterministic test composition of the production owner, not a new shared UI component |

Teacher only; student n/a because the separate student instructions owner is unchanged. Desktop1440×900 and mobile390×844, light/dark, normal/reduced motion. States: open, header/Escape/backdrop dismissal, immediately available editor, draft/undo, retained outgoing instructions, rapid reopen, whole owner close/new session, assignment replacement while open, both100ms title-focus callbacks and preference change during exit. Primary signal: quiet opacity exit using the existing standard token. No entry, translation, scale, new layout, scrim, dependency, backend or generic editor/widget adoption.

Composite accessibility checklist reviewed: dialog naming, top-layer Escape, initial/final focus, immediate inert/hidden outgoing controls and parent editor interaction. Root CreationModalShell and schedule DialogPanel keep immediate removal. Root/editor DOM disappears on whole-owner close; Tiptap keeps its existing deferred cleanup tick rather than the preview lifetime.

Owner tests use the real editor, including transaction/history and Ctrl+Z. Three delayed focus races were reproduced against baseline before correction. The browser fixture uses fake fixed IDs and must be driven with all API traffic intercepted; it is never served in production. Browser evidence covers native input/undo and dialog commands. Local visual capture allows natural animation and brackets opacity midpoints without changing duration or pausing animation.

Existing create/save responses may still publish state after an external session change. This adoption guards delayed focus, not request/response publication or backend behavior. That pre-existing boundary is a separate follow-up; this evidence is not an authenticated classroom or persistence test. Wider generic-dialog adoption remains experimental and requires individual descendant/lifetime evidence.
