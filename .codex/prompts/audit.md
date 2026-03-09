Pre-commit audit: scan changed files for common violations.

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Rules:
- ALL git commands MUST use: `git -C "$PIKA_WORKTREE"`
- Report ALL violations found, not just the first one.

Steps:

1) Get changed `.ts`/`.tsx` files from `git diff --name-only HEAD`.
2) Check each file for violations:
   a) **Manual error handling** (API routes under `src/app/api/`): `catch (error` without `withErrorHandler`
   b) **Direct dark: classes** (outside `src/ui/`): `dark:` in className strings
   c) **Duplicated parseContentField**: local function named `parseContentField`
   d) **Missing withErrorHandler** (API routes): `export async function GET/POST/PATCH/PUT/DELETE` without wrapper
   e) **Console.log in production** (not test files): `console.log(`
   f) **Direct Supabase in components**: `createClient(` in `src/components/` or non-api `src/app/`
3) Report: file path, line number, violation type, suggested fix.
4) Summary: total violations, pass/fail.

Alternatively, run the audit script directly:
```bash
bash "$PIKA_WORKTREE/.codex/skills/pika-audit/scripts/audit.sh"
```
