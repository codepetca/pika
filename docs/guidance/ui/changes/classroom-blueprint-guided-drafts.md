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

## Generated assignment Markdown correction (2026-09-30)

- Surface/reference: teacher assignment Instructions preview and student Classwork instructions, both using production `LimitedMarkdown`; the `/pattern-lab` assignment preview is the approved teacher reference.
- Roles and matrix: teacher and student, desktop 1440×900 and mobile 390×844, light and dark. Check the open/read state with Task, Coding reference, reserved Instructions heading, a four-backtick fence containing three backticks, a tilde fence, and prose after both code blocks.
- Primary signal: existing heading hierarchy and monospace code blocks; no new control, colour, divider styling, or student-facing source information.
- Composite widget review: no new interaction or ARIA behavior; the existing preview dialog focus contract remains unchanged.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Teacher and student instruction display | `LimitedMarkdown` | reuse | Both views already render through this production owner. |
| Valid backtick and tilde fence lengths | `parseLimitedMarkdownBlocks` | extend | The existing code-block presentation can render both without new styling. |
| Guided draft preview chrome | Pattern Lab assignment preview | reuse | The same open/read state supplies the visual reference. |

No experimental pattern or new shared component is needed. Verify the exact Markdown fixture in both roles before release; the first correction review found that nested fences and reserved headings previously rendered as literal text.

Local verification: the fixed Pattern Lab reference uses the production
`LimitedMarkdown` owner in teacher and student roles. Playwright passed all
eight desktop/mobile, light/dark captures; both roles show supported headings,
two legible code blocks, and prose after each block. The code text uses the
existing inverse text token on its existing dark surface. Captures are in the
guided-assignment worktree's `test-results/ui-pattern-lab-*guided-assignment*`
directories and were visually reviewed. No production classroom data was used.

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

- Initial review correction: the current-rules comparison label now uses the freshly fetched preview Version, independently of the open pane context. Verified an open Guidance Version 3 pane comparing current Version 4 against Draft 5 on desktop/mobile in both themes; inspected `teacher-*-fresh-preview.png` in the same evidence directory. Shared components, layout and keyboard behavior are unchanged.
