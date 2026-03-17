Scaffold a new API route at the given path with best-practice patterns.

Takes the route path as an argument (e.g. `teacher/widgets/[id]`).

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Rules:
- ALL file paths MUST be absolute or prefixed with `$PIKA_WORKTREE`.
- Follow patterns from `docs/ai-instructions.md` and `docs/core/architecture.md`.
- Every handler MUST use `withErrorHandler` from `@/lib/api-handler`.
- Use Zod for request body validation.
- Use `requireRole` from `@/lib/auth` for authentication/authorization.
- Import Supabase client from `@/lib/supabase-server` (service role) or `@/lib/supabase-route` (user context).

Steps:

1) Parse the target path
   - Extract the route path from arguments (e.g. `teacher/widgets/[id]`).
   - Compute full file path: `$PIKA_WORKTREE/src/app/api/<path>/route.ts`.
   - If the file already exists, stop and report.

2) Determine route characteristics
   - If path starts with `teacher/` -> use `requireRole('teacher')`.
   - If path starts with `student/` -> use `requireRole('student')`.
   - Otherwise -> default to generic auth check.
   - If path contains `[id]` or similar dynamic segments -> include `context.params` destructuring.

3) Generate the route file using this template:

   ```typescript
   import { NextRequest, NextResponse } from 'next/server'
   import { withErrorHandler } from '@/lib/api-handler'
   import { requireRole } from '@/lib/auth'
   import { createSupabaseServer } from '@/lib/supabase-server'

   export const GET = withErrorHandler('Get<Resource>', async (request, context) => {
     const { id } = await context.params
     const user = await requireRole('teacher')
     const supabase = createSupabaseServer()

     // TODO: implement
     return NextResponse.json({ id })
   })
   ```

   - Include GET handler by default.
   - Use PascalCase for the route name in `withErrorHandler`.

4) Create parent directories if needed with `mkdir -p`.

5) Verify with `pnpm tsc --noEmit`.
