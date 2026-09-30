# Blueprint authoring workspace inspection

Date: 2026-09-28. Status: inspection followed by implementation on
`codex/blueprint-authoring-ux`; not yet merged or promoted to stable UI guidance.
Inspection source checkout: `0f5c7dd5`.

## Evidence

Inspected the production teacher Blueprints page at `/teacher/blueprints`,
selected `ICS3U-4`, and opened Tests and AI Drafting. Reviewed a desktop,
dark-theme screenshot plus the visible controls and current source. No course
content was edited, no generation action was run, and no publication or editor
authority setting was changed. Other themes, mobile, and keyboard interaction
were not tested in this inspection.

- Blueprints already has a main navigation destination beside Classrooms and
  Calendar. There is no Authoring Guidance section inside a blueprint.
- The selected blueprint shows metadata fields, save controls, editor authority,
  and package-format information above its content navigation and editor.
- Thirteen peer buttons wrap across rows: Overview, Outline, Resources,
  Assignments, Tests, Lesson Plans, Materials, Surveys, Grading, AI Drafting,
  Publish, Classroom Updates, and Proposals.
- Those buttons are hand-built controls rather than the shared Tabs/TabPanel
  owner. Selected section state is local React state, so there is no section
  URL to bookmark or restore on reload.
- The Tests surface exposes a Markdown editor. AI Drafting has a section picker,
  a one-off Direction input, and preview/proposal actions. The suggestion helper
  currently builds fixed templates; it does not load persistent authoring rules.
- The existing product-experience audit already records the legacy Blueprint
  shell/tab parity gap. Runtime/versioning improvements do not resolve it.

## Proposed direction

Give Authoring Guidance its own teacher-only tab within each blueprint. Treat
this as part of improving the current workspace rather than appending a
fourteenth peer button to the existing layout.

Candidate top-level organization:

| Tab | Contents |
| --- | --- |
| Overview | Course summary and reusable-content overview |
| Content | Outline, resources, assignments, tests, lessons, materials, and surveys |
| Authoring Guidance | Shared course expectations, test rules, assignment rules, unit exceptions, and guidance history |
| Updates | Classroom changes and proposals awaiting review |
| Settings | Course metadata, grading defaults, editor authority, and planned-site sharing |

Keep export/import in page actions, provide distinguishable create actions, and
show the selected course title above the working area. Move drafting entry
points to the content being authored, where applicable guidance can be shown.
The content grouping and exact labels remain a design proposal.

Use an ordinary rich-text editor for guidance with optional Markdown source,
clear save state, and explicit teacher-only visibility. Guidance persistence,
version/package support, and authoring-context consumption must be implemented
before the UI claims that rules are remembered or applied.

## Component candidates

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Page framing and actions | Shared PageLayout/PageActionBar in `@/ui` | reuse | Established teacher-page geometry and responsive behavior |
| Section navigation | Tabs/TabPanel in `@/ui` | reuse | Shared keyboard, selected-state, target-size, and overflow behavior |
| Guidance editing | MarkdownContentEditor used by CourseGuidePanel | reuse | Existing rich-text/Markdown authoring mechanism |
| Save feedback | SaveStatus and existing blueprint dirty-section tracking | extend | Guidance needs the same saved baseline and guarded transitions |

Before implementation, inspect the relevant live Pattern Lab examples and
confirm these candidates at the target viewport. This inspection has not
completed that implementation prerequisite.

## Suggested sequence and acceptance

1. Refine Blueprint navigation and page hierarchy using existing content and
   save/authority contracts. Keep section URLs stable and protect unsaved edits.
2. Add the complete Authoring Guidance feature: teacher-only storage, editor,
   version/package transfer, and context supplied during authoring.
3. Add feedback-to-rule proposals and the ability to try a changed rule on a draft.

For implementation, use Course Guide editing and the canonical teacher page
shell as reference surfaces. Verify teacher desktop/mobile, light/dark, loading,
empty, selected, edit, save error, unsaved navigation, repository-managed state,
and keyboard tab navigation. For the guidance feature also verify student and
public-site exclusion. Use one active-tab accent as the main navigation signal;
review composite-widget accessibility. Avoid introducing global design-system
changes for this feature.

## Implementation outcome

The worktree groups the former peer sections into Overview, Content, Authoring
Guidance, Updates, and Settings using the shared Tabs and TabPanel controls.
The selected section is reflected in the URL. A teacher can edit course and
unit rules with rich text or Markdown, review old and proposed wording, reject
or apply a change, inspect private revision history, and try unsaved rules on a
temporary test or assignment preview. Saved guidance enters immutable Versions,
change proposals, and course packages. The AI Drafting test and assignment
path supplies the selected approved rules to the model and shows the exact
revision and wording beside the editable preview.

Pattern Lab controls and teacher page framing were checked before editing.
Desktop and mobile light/dark screenshots were reviewed; a teacher interaction
check covered the review comparison and an unsaved trial preview. A student
session was redirected away from the teacher Blueprint route. Live save and
history still require the new migration, so they have not been claimed as
end-to-end verified yet. This is branch evidence, not a deployed feature.
