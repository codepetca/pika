# Classwork creation: audit and proposed shared UI

Status: proposal only, not implemented or promoted to stable guidance. 2026-08-31.

## Sync

Synced `codex/standardize-page-action-icons` from main to `de3f73cd` (#1132). Preserved all local page-action/status changes. Resolved the Pattern Lab import conflict by retaining both the new creation-shell reference and StatusPatterns. Preserved both session-history contributions. Safety stash: `0950d7fb9e39a22396597f222e00d4992e06ee1d` (kept, already applied; do not apply again).

Focused validation: 135 files / 1,338 tests; architecture, UI policy, design policy, TypeScript and lint all passed. Log: `/tmp/pika-classwork-sync-check.log`. No PR, commit, production merge, migration, or dependency change.

## Evidence and findings

Reviewed the local teacher Test Classroom in the in-app browser. Used an existing empty assignment draft; no new draft was created and no content was changed or published. Material and survey dialogs were inspected and cancelled. Dark desktop captures only; mobile, light theme, student rendering and end-to-end publication were not audited in this pass. Browser captures with clipped/blank content were rejected in favor of full-page captures.

1. **Assignment draft — strongest common-bar reference.** Title and Saved indicator sit left; Preview, Due date and Post split button sit right. Schedule and Draft are menu choices. The editor has clear framing and required submissions. Code confirms new assignments create a draft on entry, autosave changes, and flush on close. The visible Saved label does not itself tell teachers whether students can see the item. Recommend separate quiet publication state and save feedback; change Draft action to Save draft.

![Assignment dialog](/Users/stew/.codex/visualizations/2026/08/31/01a055fd-39bd-7b22-a8be-a1935c68be3a/classwork-creation-audit/01-assignment-full.png)

![Assignment publishing choices](/Users/stew/.codex/visualizations/2026/08/31/01a055fd-39bd-7b22-a8be-a1935c68be3a/classwork-creation-audit/02-assignment-actions.png)

2. **Material creation — useful matching shell, inconsistent controls.** Same tall shell as Assignment, but adds a separate heading/subtitle, full-width title, and bottom Cancel / Save Draft / Post Material buttons. No Preview or date control. Code confirms explicit saving and only draft/immediate-post support; adding Schedule is a behavior/API change, not just a menu item. Title is required by the handler but lacks the matching required-field treatment. Closing does not autosave.

![Material dialog](/Users/stew/.codex/visualizations/2026/08/31/01a055fd-39bd-7b22-a8be-a1935c68be3a/classwork-creation-audit/03-material.png)

3. **Survey creation — clear small setup form, fragmented authoring.** Title and Create plus two settings. Creation opens a separate question editor; that editor has Preview. Existing survey actions are Open poll / Close poll, and a draft with no questions cannot be opened. Scheduling is not exposed. The initial Create label obscures that the next step is editing questions, not release to students.

![Survey dialog](/Users/stew/.codex/visualizations/2026/08/31/01a055fd-39bd-7b22-a8be-a1935c68be3a/classwork-creation-audit/04-survey.png)

The Pattern Lab creation example renders the shared tall shell with long content and a fixed footer. It establishes sizing and containment, but does not demonstrate an approved common publishing bar. The proposal below extends the existing Assignment composition; the reference does not establish that all item types have identical publication semantics.

## Proposed UI

Use the same tall authoring shell, padding, title width, editor framing and pinned top bar for all full editors. Keep the content area scrolling independently.

| Left | Middle utilities | Right |
|---|---|---|
| Title with quiet publication/save feedback | Preview; relevant date only | Primary publishing action and its dropdown; close in a reserved corner |

- **Assignment:** Preview, explicitly labeled Due date, Post with Schedule… / Save draft choices. Due date and release time remain distinct; schedule details keep the existing Toronto date/time picker and validation.
- **Material:** Preview, Post with Save draft. No due-date placeholder. Add scheduling only as a separately scoped behavior change. Move footer publishing controls into the shared top bar and remove redundant heading/subtitle chrome.
- **Survey:** eventually open directly into the question builder inside the same shell, with title/settings, questions, Preview and Open survey. Keep the distinction between starting response collection and posting reading material. In a small first pass, use Continue in the existing setup dialog; do not pretend it publishes a complete survey. Retain the no-questions guard.
- **Saving:** use Save draft consistently as an action and Draft as a state. Do not show Saved or imply autosave on material/survey fields until persistence supports it. Align close behavior later: successful save/flush, or a clear discard warning for unsaved edits. Never silently discard material content while the neighboring assignment editor saves on close.
- **Mobile:** title on its own row, utilities/actions beneath; preserve control order, visible labels where needed, 44px targets, keyboard focus and no overlap with Close. This requires fresh verification rather than copying the desktop row unchanged.
- Keep Post / Schedule / Save draft explicit text in confirmation controls; '+' remains the creation entrypoint only.

## Reuse decisions

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Dialog containment and size | CreationModalShell / DialogPanel | reuse | Shared ownership already exists for all three entry forms. |
| Title and pinned utility/action bar | CreationModalTopRow / AssignmentForm | extend | All three full editors need stable slots; current feature wrappers cause drift. |
| Publication choices | SplitButton | reuse | Shared accessible menu; each feature supplies supported actions. |
| Assignment scheduling | ScheduleDateTimePicker / assignment scheduling hook | reuse | Keep Toronto validation and assignment-specific release rules. |
| Save feedback | SaveStatus | reuse | Use only where actual persistence can substantiate the state. |
| Student preview | Assignment preview, material RichTextViewer, TeacherSurveyPreview | extend | Consistent location and overlay; preserve each domain's real rendered content. |

No generic business-logic publishing engine is proposed. Material dialog extraction from TeacherClassroomView is a focused refactor candidate if it adopts the shared bar; keep its persistence outside src/ui.

## Suggested order

1. Material first: align its top bar, add Preview, preserve manual save semantics; compare side-by-side with Assignment in Pattern Lab.
2. Apply agreed spacing, labels and state treatment to Assignment without changing scheduling or autosave behavior.
3. Consolidate Survey setup and question editing after the shared bar is accepted; preserve response lifecycle rules.
4. Treat material/survey scheduling and autosave parity as explicit follow-up features.

For implementation, verify teacher desktop/mobile × light/dark, empty/filled/validation/saving/error states, dropdown keyboard interactions, close/focus return, long editor scrolling and preview. Student view is n/a for shell-only changes; rendered student previews must match their real student counterpart. Snapshot baseline acceptance remains required before publishing the existing accumulated UI changes.

Risk profile: workspace-state for the sync; none for the read-only product audit. Model recommendation: current Codex model for this bounded comparison; no separate agent work needed.
