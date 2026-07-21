# Page-State Conventions

Use `PageState` from `@/ui` when a route or primary work region is loading, failed, empty, or
unavailable. Keep small field errors, save status, modal progress, table rows, and transient refresh
feedback with their owning feature controls instead.

## State Decisions

| State | Meaning | Required behavior |
|---|---|---|
| `loading` | The initial read has not completed. | Use specific loading copy and `aria-busy`; do not show an empty state while the request is pending. |
| `error` | A required read failed. | Preserve the surrounding shell, explain that data was not changed, and offer a bounded retry when one is safe. |
| `empty` | A successful read returned no records. | Describe the first useful action. Never use empty copy as a fallback for a failed request. |
| `forbidden` | The current identity cannot use the surface. | Do not expose whether a protected resource exists. Provide a safe route away from the state. |

## Route Conventions

- Use App Router `loading.tsx` for route transitions and `error.tsx` for uncaught route failures.
- Keep `error.tsx` copy generic. Do not render raw exception or database messages.
- Call the error-boundary `reset()` callback for retry; invalidate an affected client cache before
  retrying a caught client read.
- Use `not-found.tsx` or generic unavailable copy when distinguishing missing from forbidden would
  disclose protected-resource existence.
- Preserve the normal app/classroom shell around route states so navigation and page dimensions do
  not jump.
- Use `PageState compact` only for a primary region inside an established split workspace. Do not
  put `PageState` inside another card.
- Keep successful zero-result handling separate from the `catch` path in client coordinators.
- Use `RefreshingIndicator` or `useOverlayMessage` for non-blocking refreshes after usable data is
  already visible.

## Accessibility

- Loading and empty states use polite status semantics.
- Error and forbidden states use assertive alert semantics.
- The state icon is decorative; the title and description carry the meaning in text.
- Retry and route-away actions remain normal keyboard-reachable controls with shared 44px targets.

## Reference Surfaces

- Classroom route: `src/app/classrooms/[classroomId]/loading.tsx`, `error.tsx`, and `not-found.tsx`
- Teacher utility: `src/app/teacher/dashboard/page.tsx`
- Student utility: `src/app/student/history/page.tsx`
