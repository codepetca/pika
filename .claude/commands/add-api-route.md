Scaffold a new API route at the given path with best-practice patterns.

Takes the route path as $ARGUMENTS (e.g. `teacher/widgets/[id]`).

Rules:
- Follow patterns from `docs/ai-instructions.md` and `docs/core/architecture.md`.
- Every handler MUST use `withErrorHandler` from `@/lib/api-handler`.
- Use Zod for request body validation.
- Use `requireRole` from `@/lib/auth` for authentication/authorization.

Steps:

1) Parse the target path
   - Compute full file path: `src/app/api/<path>/route.ts`
   - If the file already exists, stop and report.

2) Determine route characteristics
   - Path starts with `teacher/` → `requireRole('teacher')`
   - Path starts with `student/` → `requireRole('student')`
   - Path contains `[id]` → include `context.params` destructuring

3) Generate the route file:

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

4) Create parent directories if needed: `mkdir -p src/app/api/<path>`

5) Verify: `pnpm tsc --noEmit`
