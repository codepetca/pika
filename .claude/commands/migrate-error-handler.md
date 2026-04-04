Migrate an API route from manual try/catch error handling to `withErrorHandler`.

Takes the file path as $ARGUMENTS (relative to repo root).

Rules:
- Preserve all existing business logic exactly.
- Do NOT change response shapes, status codes, or behavior.
- Only refactor the error handling wrapper.

Migration pattern:

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

Steps:
1) Read the target file. If it already uses `withErrorHandler`, stop.
2) For each exported handler (GET, POST, PATCH, PUT, DELETE):
   - Remove the outer try/catch block.
   - Keep the happy-path body unchanged.
   - Change `export async function X(...)` to `export const X = withErrorHandler(...)`
   - Ensure handler signature includes `context` param.
   - Derive route name from file path in PascalCase.
3) Add `import { withErrorHandler } from '@/lib/api-handler'` if not present.
4) If catch block has custom error handling beyond auth/500, convert to `ApiError` inline.
5) Verify: `pnpm tsc --noEmit` and run any existing tests.
