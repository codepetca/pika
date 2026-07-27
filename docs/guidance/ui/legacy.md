# Legacy UI Guidance

These patterns still exist in the repo, but they should not be treated as defaults for new work.

## Legacy Patterns

### 1. The retired `docs/design-system.md` guidance

- The historical file was deleted after its still-useful density and product-character principles
  moved into [`DESIGN.md`](/DESIGN.md).
- Its raw-color examples, 36px interactive targets, pre-token component recipes, and completed
  migration checklist are obsolete and must not be restored or copied.
- Git history is the provenance source if the old document needs to be investigated. Do not create
  a searchable archive copy.
- New UI work uses `DESIGN.md`, `src/ui/README.md`, and this governed UI canon.

### 2. Feature-local surface styling that bypasses canonized primitives

- Some targeted workflow surfaces still style interactive containers directly instead of using a canonized shared primitive.
- Example: the student assignment summary cards in [`src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx`](/src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx) are locally styled `button` cards.
- This is acceptable to preserve current behavior, but it should not automatically become a new default pattern.

### 3. Compatibility imports for the canonical page primitives

- `PageLayout`, `PageHeading`, `PageActionBar`, `PageContent`, and `PageStack` are canonical in
  `@/ui`.
- `src/components/PageLayout.tsx` remains only as a compatibility export for active callers that
  have not been migrated yet.
- New work imports the page primitives from `@/ui`; migrate compatibility imports when their
  owning surface is deliberately touched instead of creating an all-at-once churn PR.
- `DataTable` and other workflow-specific composition helpers remain outside `@/ui` until their
  separate Phase 2 contracts are decided.

## Legacy Guidance Rule

If a pattern is listed here:

- preserve it when necessary to avoid churn
- avoid spreading it into unrelated screens
- promote it only after a human intentionally moves it into stable guidance
