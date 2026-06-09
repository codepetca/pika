# Creation Modal Shell Candidate Guidance

status: experimental
human_review_required: true

## Summary

Creation modals for classroom work items should share one compact, authoring-first shell. The current reference is assignment creation: no visible header chrome above the title row, an absolute borderless close control in the upper-right corner, and the primary creation action on the same row as the title.

## Affected Screens / Files

- `src/components/AssignmentModal.tsx`
- `src/components/AssignmentForm.tsx`
- test creation/editing surfaces
- `src/components/surveys/SurveyCreationModal.tsx`
- `src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`
- `src/components/creation/CreationModalShell.tsx`

## Observed Pattern

Teachers create assignments, tests, and surveys from the same classroom workstream. The older assessment setup shell used a visible modal title bar and footer actions, while assignment creation moved toward a faster single-row start: title, scheduling or compact metadata when relevant, and the primary action.

## Proposed Guidance

- Use `CreationModalShell` for creation flows that benefit from assignment-style authoring.
- Use `CreationModalTopRow` for title-first creation rows.
- Keep the close button absolute and borderless so it does not consume layout width.
- Put the primary creation action in the top row.
- Keep feature-specific settings, validation, scheduling, markdown editing, and save behavior outside the shared shell.
- Keep compact edit/settings modals separate unless the edit workflow genuinely matches the creation flow.

## Why This Is Experimental

The shell now covers assignment, test, and survey creation, but it has not yet been reviewed as a stable app-wide modal standard for every creation flow.

## Human Review Required

Confirm whether this shell should be promoted for all classroom creation modals or remain limited to classwork item creation.

## Promotion Criteria

- Assignment, test, and survey creation screenshots look coherent together on desktop and mobile.
- The shell does not force sparse or awkward layouts for simple creation forms.
- Users can complete creation faster than with the old header/footer assessment setup shell.
