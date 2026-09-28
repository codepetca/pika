# Classroom drafts guided by a Blueprint

## UI change brief

- Surface: teacher Classwork and Tests actions, a shared guided draft dialog, and a small source notice in each editor.
- Reference: development `/pattern-lab` Assignment dialog and Test edit surfaces, plus current teacher Classwork and Tests action bars.
- Affected roles: teacher. Student views must continue to display only the resulting assignment or test content.
- Viewports: desktop and mobile.
- Themes: light and dark.
- Key states: no saved Blueprint Version, choosing an assessment and unit, writing a request, generating, previewing and editing Markdown, creation in progress, recoverable error, and returned to the editor.
- Primary signal: the existing primary create action and a secondary "Draft with Blueprint" action. The dialog uses the existing form and preview hierarchy.
- Must not add: a new top-level classroom tab, student-facing guidance or source information, a second visual design language, or automatic publication.
- Composite widget accessibility review: yes. Check dialog focus and keyboard close, the unit selector, and editable preview.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Entry action | Classwork and Tests work-surface actions | extend | Keep familiar blank creation while adding a guided path at its point of use. |
| Guided draft preview | `ContentDialog`, `FormField`, `Select`, `Button`, and existing Markdown editor styling | create | One shared flow has two genuine adopters: assignments and tests. |
| Source after creation | Existing compact editor context notices | extend | Tell the teacher which frozen Blueprint Version guided the draft without showing private rules to students. |

## Acceptance

A teacher with a saved Blueprint Version can choose a unit, describe the assessment, generate an editable preview, and create an unpublished draft. The draft uses the frozen classroom Version rules, and its private source remains visible to the teacher after reload. If no Version exists, the guided action has a clear unavailable state. Existing blank creation remains available.

Verify teacher desktop/mobile light/dark and the states above. Verify a student cannot see the guidance, source, or preview. Check the new dialog against the Pattern Lab references and the composite widget accessibility checklist.
