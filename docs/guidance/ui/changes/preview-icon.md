# Shared Preview icon

2026-08-31: User approved Eye as the common Preview icon, including Tests.

- Reference: existing AssignmentForm and MaterialCreationDialog eye-only IconButton controls, visible in Pattern Lab's creation examples.
- Surface: teacher Tests list, TeacherTestAuthoringDialog and TestDetailPanel's supported standalone toolbar; shared Pattern Lab catalog and icon guidance. Current authoring dialogs hide the standalone toolbar, whose behavior is covered by component tests.
- Reuse IconButton + Lucide Eye; extend the existing catalogs. No new primitive is needed.
- Roles: teacher production controls; teacher/student Pattern Lab references. Student test-taking controls are unchanged.
- Matrix: desktop/mobile, light/dark; default, hover/focus, activation, disabled/loading. Keep contextual accessible names, tooltips, and 44px targets.
- Primary signal: Eye without visible Preview text. ExternalLink remains reserved for external destinations; opening a preview in a new window does not change its icon.
- Exclusions: no preview routing, autosave, exam, submission, permissions, or attachment-policy changes. Preserve existing callbacks and pending-markdown guard.
- Composite-widget review: no new composite model; verify the existing button/tooltip focus contract and the editor's unchanged preview-before-save behavior.
- Risk profile: none (control presentation only). Model recommendation: GPT-5.6 Terra for a bounded consistency review.
