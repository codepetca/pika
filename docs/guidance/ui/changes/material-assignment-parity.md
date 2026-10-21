# Material assignment parity

Surface: teacher Classwork material creation/editing and teacher/student Calendar
material publication chips. Approved reference: `/pattern-lab#assignment-creation`
and `#assignment-edit-split`, both using the production AssignmentForm desktop split.
The deterministic MaterialCreationPattern renders the production material owner.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Split details/content layout | AssignmentForm desktop composition | reuse | Same one-third/two-thirds layout and mobile stack |
| Formatted content | RichTextEditor, ContentField | reuse | Same toolbar preset as assignments; retain material JSON without conversion |
| Preview and publishing | ContentDialog, RichTextViewer, SplitButton, ScheduleDateTimePicker | reuse | Existing rendering, focus, action and Toronto schedule contracts |
| Material composition and calendar links | MaterialCreationDialog, LessonDayCell | extend | Material-specific persistence and publication navigation remain with existing owners |

Primary signal: single formatted editor in the right pane; title, labeled Preview,
publication status and Post/Schedule/Save draft actions in the left pane. No
Visual/Markdown switch, conversion, Apply/Discard step, due date, submission fields,
new dependency or shared mega-form. Existing rich documents retain their stored
shape. Both editors share a toolbar preset, while material persistence stays JSON.

Matrix: teacher new/existing/draft/posted/scheduled, editing, preview, scheduling,
read-only, saving, error, menu keyboard/focus and long content; desktop1440x900 and
mobile390x844, light/dark. Student authoring is n/a (teacher-only permission);
student material rendering and exact Calendar chip navigation use the existing
RichTextViewer and are checked in both viewports/themes. Calendar conflict
resolution preserves the current main lesson text anchors and edit transitions.

Composite review: SplitButton keyboard/menu retirement, nested overlays, Escape,
focus return and 44px targets. No new primitive or motion contract. Nearby layout
duplication with AssignmentForm is intentional: their persistence/content and
publication lifecycles differ. A shared layout owner would need a separate narrow
contract with both genuine adopters. Verification and review receipts are retained
with PR1639 and the session log.
