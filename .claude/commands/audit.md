Pre-commit audit: scan changed files for common violations.

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Rules:
- ALL git commands MUST use: `git -C "$PIKA_WORKTREE"`
- ALL file paths MUST be absolute or prefixed with `$PIKA_WORKTREE`.
- Report ALL violations found, not just the first one.
- Exit with a summary: pass/fail + violation count.

Steps:

1) Get changed files
   - Run: `git -C "$PIKA_WORKTREE" diff --name-only HEAD` (staged + unstaged)
   - Also check: `git -C "$PIKA_WORKTREE" diff --name-only --cached` (staged only)
   - Combine both lists, deduplicate.
   - Filter to only `.ts` and `.tsx` files.
   - If no changed files, report "No TypeScript files changed" and stop.

2) Check each file for violations

   **Violation categories:**

   a) **Manual error handling** (API routes only — files under `src/app/api/`):
      - Pattern: `catch (error: any)` or `catch (error)` without `withErrorHandler`
      - Fix: use `/migrate-error-handler`

   b) **Direct dark: classes** (component/page files):
      - Pattern: `dark:` in className strings
      - Allowed: only in files under `src/ui/`
      - Fix: use semantic design tokens from `docs/core/design.md`

   c) **Duplicated parseContentField**:
      - Pattern: local function named `parseContentField` or `parseContent`
      - Fix: import from `@/lib/tiptap-content`

   d) **Missing withErrorHandler import** (API routes only):
      - Pattern: file has `export async function GET/POST/PATCH/PUT/DELETE` but no `withErrorHandler`
      - Fix: use `/migrate-error-handler`

   e) **Console.log in production code** (not test files):
      - Pattern: `console.log(` (not `console.error` or `console.warn`)
      - Allowed: in test files (`*.test.ts`, `*.spec.ts`)

   f) **Direct Supabase client creation in components**:
      - Pattern: `createClient(` in files under `src/components/` or `src/app/` (non-api)
      - Fix: use server actions or API routes

3) Report results
   - List each violation with: file path, line number, violation type, suggested fix.
   - Summary: total violations by category, overall pass/fail.
   - If all clear: "Audit passed - no violations found."
