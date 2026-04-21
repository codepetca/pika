# Experimental UI Guidance

Experimental guidance holds candidate UI patterns that are reviewable and reusable, but not yet promoted to stable guidance.

## Rules

- Experimental guidance must be clearly marked as experimental.
- AI may draft or update experimental entries.
- Experimental entries do not override stable guidance.
- Promotion into stable guidance requires human review.

## When To Create An Experimental Entry

Create or update an experimental entry when:

- a task introduces a new UI pattern that is likely to be reused
- a current feature-level pattern looks promising but is not yet broad enough to canonize
- a change needs a human review point before the pattern should spread further

Quick draft command:

```bash
node scripts/ui-guidance-candidate.mjs --scope assignments --files src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx src/components/AssignmentModal.tsx
```

## Required Frontmatter

Every experimental entry should include:

- `status: experimental`
- `scope`
- `source_files`
- `human_review_required: true`

## Promotion Criteria

Promote an experimental pattern only when a human agrees that it:

- has been used across multiple screens or flows
- survived iteration without obvious regressions
- improves clarity, usability, or implementation consistency
- is ready to become a default rather than a local exception

Use `legacy.md` when an experimental direction fails or when an older pattern remains in code but should not be reused.
