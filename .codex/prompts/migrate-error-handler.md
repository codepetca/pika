Migrate the API route in `$ARGUMENTS` from manual `try/catch` handling to `withErrorHandler`.

Preserve business logic and response behavior. Only change the error-handling structure.

Steps:
1. Read the target file. If it already uses `withErrorHandler`, stop.
2. For each exported handler, remove the outer `try/catch` and keep the happy path unchanged.
3. Convert `export async function X(...)` to `export const X = withErrorHandler(...)`.
4. Add `import { withErrorHandler } from '@/lib/api-handler'` if missing.
5. If the old `catch` contained custom domain behavior, move it inline with `ApiError` or `apiErrors`.
6. Verify with `pnpm -C "$PIKA_WORKTREE" tsc --noEmit` and run nearby tests when available.
