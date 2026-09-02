# Markdown menu entry points

2026-08-31: User requested Markdown editing in selected Test/Assignment and list More actions menus.

- Reference: selected Test More actions menu and Code editor; Pattern Lab controls/Page actions and teacher context bar. Preserve trailing More actions and centered primary controls.
- Reuse shared TeacherWorkSurfaceIconMenuButton, existing test Markdown editor and all-assignments bulk editor. Extend test dialog with initial view; extend AssignmentForm with a source-text view of its existing instructions Markdown and unchanged autosave owner.
- Teacher desktop/mobile, light/dark: menu open/focus/keyboard, selected entry, dialog close/reopen, disabled archived state. Student and unauthenticated n/a: teacher-only owners and controls.
- Primary signal: Code icon plus explicit Edit Markdown menu label; list bulk action names its all-assignments scope. No new shell, API, dependencies, permissions, publication or student-taking changes.
- Composite accessibility review required: shared menu-to-dialog focus, Escape and focus return. Preserve pending-Markdown and save-before-close guards.
- Risk: workspace-state. Owner identities remain classroom/test/assignment; opening mode must reset for each opening and item, without remounting active editors on summary updates.
- Tests list uses a shared DialogPanel picker for every listed test, then the existing Markdown authoring flow. There is no existing all-tests Markdown save path; the picker does not claim to edit tests together. Combined-document behavior was asked as a clarification and is not inferred.
- Native textarea exception: AssignmentForm source view uses the governed native-textarea category (no shared Textarea exists), shared FormField naming and semantic input/focus tokens; phase-3-assignments owns it.
- Model recommendation: GPT-5.6 Terra high for independent state/interaction review.

## 2026-09-02 rebase after #1121

- Preserve #1121's centered assignment grading controls, trailing utility menu, and summary Edit classwork toggle; add the selected Markdown action to that menu. The normal Edit Assignment action still opens the visual editor.
- Focused validation: 23 files / 373 tests, architecture, UI/design policy, TypeScript and lint pass. Pika audit covers all 17 changed TypeScript files.
- Browser evidence: teacher Tests/Classwork list and selected menus, test picker, source editors, normal-edit reset, keyboard activation and focus return pass at 1440×900 and 390×844, light/dark, reduced motion. Archived guards remain covered by component tests. No live data changes; close-save responses are simulated in the verification harness.
- Visual evidence: `/Users/stew/.codex/visualizations/2026/09/02/pr1138-rebase/`. Source captured from rebased `f25685f2`; subsequent changes are test expectation, reference baselines and this evidence record.
