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

### 3. Shared classroom composition that lives outside `@/ui`

- Attendance and teacher-assignment workflows rely on `PageLayout`, `PageActionBar`, `DataTable`, and related helpers in `src/components/`.
- Those building blocks are useful, but they are not yet canonized at the same level as `@/ui`.
- Preserve them when working inside those workflows, but do not assume they are promoted shared truth.

## Legacy Guidance Rule

If a pattern is listed here:

- preserve it when necessary to avoid churn
- avoid spreading it into unrelated screens
- promote it only after a human intentionally moves it into stable guidance
