Migrate an API route from manual try/catch error handling to `withErrorHandler`.

Takes `$ARGUMENTS` as the file path to migrate (relative to `$PIKA_WORKTREE` or absolute).

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Rules:
- ALL file paths MUST be absolute or prefixed with `$PIKA_WORKTREE`.
- Preserve all existing business logic exactly.
- Do NOT change response shapes, status codes, or behavior.
- Only refactor the error handling wrapper.

Steps:

1) Resolve and read the target file
   - If `$ARGUMENTS` is relative, prepend `$PIKA_WORKTREE/`.
   - Read the file contents.
   - If it already uses `withErrorHandler`, stop and tell me.
   - Count how many exported handler functions exist (GET, POST, PATCH, PUT, DELETE).

2) For each handler, apply the migration pattern

   **Before (manual):**
   ```typescript
   export async function GET(request: NextRequest) {
     try {
       const user = await requireRole('teacher')
       // ... business logic ...
       return NextResponse.json(data)
     } catch (error: any) {
       if (error.name === 'AuthenticationError') {
         return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
       }
       if (error.name === 'AuthorizationError') {
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
       }
       console.error('...', error)
       return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
     }
   }
   ```

   **After (withErrorHandler):**
   ```typescript
   export const GET = withErrorHandler('GetResource', async (request, context) => {
     const user = await requireRole('teacher')
     // ... business logic (unchanged) ...
     return NextResponse.json(data)
   })
   ```

3) Migration rules
   - Remove the outer `try { ... } catch (error: any) { ... }` block.
   - Keep the happy-path body unchanged.
   - Change `export async function GET(...)` to `export const GET = withErrorHandler(...)`.
   - Ensure handler signature includes `context` param: `async (request, context) => { ... }`.
   - Derive route name from file path in PascalCase (e.g. `teacher/tests/[id]` -> `'GetTeacherTest'`).
   - Add `import { withErrorHandler } from '@/lib/api-handler'` if not already imported.
   - If the catch block has custom error handling beyond auth/500 (e.g. checking for specific Supabase errors), keep that logic inline in the happy path using `ApiError` or `apiErrors` from `@/lib/api-handler`.
   - Remove unused error-related imports after migration.

4) Handle edge cases
   - If the route returns custom error responses for specific business conditions (not in the catch block), leave those as-is.
   - If the catch block handles `ZodError` manually, remove that — `withErrorHandler` handles it automatically.
   - If the route has multiple handlers (GET + POST + PATCH etc.), migrate ALL of them.

5) Verify
   - Run: `pnpm tsc --noEmit` to confirm no type errors.
   - If there are existing tests for this route, run them: `pnpm vitest run <test-file>`.
   - Report: number of handlers migrated, any edge cases encountered.
