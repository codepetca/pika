# Classroom drafts guided by a Blueprint

## UI change brief

- Surface: teacher Classwork and Tests actions, a shared guided draft dialog, a small source notice in each editor, and a Blueprint tab in the teacher classroom shell.
- Reference: development `/pattern-lab` Assignment dialog and Test edit surfaces, plus current teacher Classwork and Tests action bars.
- Affected roles: teacher. Student views must continue to display only the resulting assignment or test content.
- Viewports: desktop and mobile.
- Themes: light and dark.
- Key states: no saved Blueprint Version, linked Version overview/content/guidance, choosing an assessment and unit, writing a request, generating, previewing and editing Markdown, creation in progress, recoverable error, and returned to the editor.
- Primary signal: the existing primary create action and a secondary "Draft with Blueprint" action. The dialog uses the existing form and preview hierarchy.
- Must not add: student-facing guidance or source information, a second visual design language, or automatic publication.
- Composite widget accessibility review: yes. Check dialog focus and keyboard close, the unit selector, and editable preview.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Entry action | Classwork and Tests work-surface actions | extend | Keep familiar blank creation while adding a guided path at its point of use. |
| Guided draft preview | `ContentDialog`, `FormField`, `Select`, `Button`, and existing Markdown editor styling | create | One shared flow has two genuine adopters: assignments and tests. |
| Source after creation | Existing compact editor context notices | extend | Tell the teacher which frozen Blueprint Version guided the draft without showing private rules to students. |
| Classroom Blueprint navigation | Existing classroom sidebar and Settings segmented navigation | extend | Keep the Version reference inside the teacher's classroom workspace, with Overview, Content, and Authoring Guidance at the top of the pane. |

The Blueprint sidebar entry uses the Lucide Factory icon. Its three sections use the same top control and URL-backed section selection as classroom Settings. The control remains available while the saved Version loads and when the classroom has no linked Version.

## Acceptance

A teacher with a saved Blueprint Version can choose a unit, describe the assessment, generate an editable preview, and create an unpublished draft. The draft uses the frozen classroom Version rules, and its private source remains visible to the teacher after reload. If no Version exists, the guided action has a clear unavailable state. Existing blank creation remains available.

Verify teacher desktop/mobile light/dark and the states above. Verify a student cannot see the guidance, source, or preview. Check the new dialog against the Pattern Lab references and the composite widget accessibility checklist.

## Explicit guidance adoption

- Surface/reference: existing teacher Blueprint Authoring Guidance pane, Settings top navigation, Blueprint guidance comparison, and Pattern Lab Dialog/Form/Button owners.
- Matrix: teacher desktop/mobile, light/dark; current rules, unchanged Draft, comparison, pending update, success and stale/error states. Student exclusion remains mandatory.
- Primary signal: separate Content Version and Guidance Version, with Review guidance update followed by explicit Update guidance confirmation.
- Boundary: only future private authoring rules change. Course outline and copied artifacts retain their Content Version.
- Composite review: shared dialog focus, Escape, focus return and footer visibility.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Version labels and update entry | Teacher Blueprint pane | extend | Distinguish structural content from adopted rules. |
| Preview and confirmation | ContentDialog and Button | reuse | Existing overlay and action contracts fit the flow. |
| Current/proposed rules | Feature MarkdownSection and existing guidance cards | reuse | Preserve readable rules and unit exceptions across themes. |
| Navigation | Settings-style SegmentedControl and Factory sidebar entry | reuse | Existing pane navigation remains the approved reference. |

No new shared component is required. Guidance-card duplication is local to this feature; extraction into a shared owner would need a second durable consumer.

## Adoption verification (2026-09-29)

- Local worktree implementation on `codex/classroom-blueprint-guidance-updates`, base `a324081`; Playwright captures at `http://localhost:3012` used deterministic teacher guidance responses with the actual classroom shell and production components. They are fixture evidence, not deployed ICS3U data.
- Evidence: `/tmp/pika-guidance-adoption-visual/`; teacher 1440×900 and 390×844, light/dark, current guidance, comparison and updated split Versions. Student 1440×900 and 390×900 excludes Blueprint guidance; the private update preview endpoint returns 403.
- Reference: `/pattern-lab` shared Dialog/Form/Button and existing teacher Blueprint pane. Mobile comparison stacks current then proposed rules within the shared scrolling dialog; footer actions remain visible.
- Composite checklist reviewed: yes. Escape closes the comparison and returns focus to its trigger; role/name/state assertions and stale/unchanged-rule behavior have component coverage.
- Screenshots were visually inspected. Long mobile subtitle copy was shortened and the content-preservation boundary moved into the dialog body before final captures.
