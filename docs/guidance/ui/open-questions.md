# Open UI Questions

These are active UX questions for the first governed slice. They are here so AI work can name the uncertainty instead of guessing silently.

## Open Questions

### 1. Should classroom-level page scaffolding be promoted?

The assignments and attendance tabs both rely on `PageLayout` and `PageActionBar`, but the repo has not decided whether those are permanent shared page primitives or just current implementation helpers.

### 2. Should dense data tables remain workflow-specific?

Attendance and teacher-assignment views use dense table patterns. The repo still needs a human decision on whether those tables are a stable classroom-wide pattern or a local fit for high-information teacher flows only.

### 3. How reusable is the student assignment summary card?

The current pressable card pattern works for assignments, but it is still unclear whether other student tab summaries should follow the same structure or whether it is too workflow-specific.

### 4. When should details live in a right sidebar versus inline content?

The classroom shell supports secondary inspection, but the product has not yet settled a universal rule for when information should move to the inspector versus remain inline, especially on smaller screens.

### 5. Which save-state language should become standard?

Assignments already communicate autosave and submission state clearly, but the repo has not yet chosen a stable cross-feature vocabulary for draft, saving, saved, submitted, graded, and returned states.
