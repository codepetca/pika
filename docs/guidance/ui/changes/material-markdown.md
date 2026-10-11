# Material Markdown editing

Surface: teacher Classwork Material dialog. Reference: the production-owned
Material creation example in `/pattern-lab#material-creation`, with the existing
Tests/Surveys explicit Apply Markdown behavior. This extends that owner, not the
application shell. No new shared primitive or stable design rule is introduced.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Material authoring and save actions | MaterialCreationDialog | extend | Keep material persistence and permissions with its caller |
| Mode selection | SegmentedControl | reuse | Shared pressed state, targets and roving keyboard navigation |
| Review | ContentDialog, RichTextViewer | reuse | Existing overlay/focus and student rendering owners |
| Content conversion | limited-markdown | reuse | Match assignment instructions and safe-link parsing |

Primary signal: named Visual / Markdown mode and explicit Apply Markdown action.
Must not add: a new assistant, automatic posting, schema changes, alternate save
routes, decorative chrome, or an unrelated cross-feature refactor. Markdown edits
remain local until Apply; persistence still requires Save/Post/Save draft. Opening
Markdown or discarding it must not replace rich content. A lossy conversion shows
a warning and requires acknowledgment before Apply. Editor state resets when the
dialog closes or its classroom/material identity changes.

Matrix: teacher default/Markdown/pending/review/applied/discard/empty/read-only/
saving/failure; desktop 1440×900 and mobile 390×844, light/dark. Student rendering
is verified using the existing RichTextViewer with the applied document; student
editing controls are not added. Existing draft vs posted visibility is unchanged.
Composite checklist: yes; pressed states, arrow-key navigation, nested preview
Escape and focus return are tested. No motion contract changes.

Nearby duplication: Tests and Surveys own different structured import formats.
Any future shared AI review owner needs real cross-feature proposal/adoption
contracts; this change does not extract one based only on visual similarity.

Verification receipts and review revision are recorded in the PR and session log.
