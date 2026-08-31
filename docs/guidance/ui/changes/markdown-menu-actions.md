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
