# Legacy UI Guidance

These patterns still exist in the repo, but they should not be treated as defaults for new work.

## Legacy Patterns

### 1. `docs/design-system.md` as a co-equal source of truth

- The file still contains older raw-color and pre-token examples such as `bg-white`, `text-gray-900`, and hard-coded blue/gray styling guidance.
- Keep it as historical context only.
- New UI work should use `docs/core/design.md`, `src/ui/README.md`, and this UI canon instead.

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
