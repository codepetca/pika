# AI Instructions for Pika

This is your **primary entry point** for working on the Pika project.

If you are starting a new session, **first read** `.ai/START-HERE.md` (environment check + journal + workflow), then come back here.

---

## Overview

**Pika** is a comprehensive online classroom management application for a Canadian high school course (GLD2O). Teachers manage classrooms with ~19 feature tabs: attendance, assignments, quizzes, tests, gradebook, announcements, resources, lesson plans, and more. Students submit journal entries, complete assignments, and take quizzes/tests.

**Tech**: Next.js 14 App Router + Supabase + Tailwind CSS + Vitest. Deployed on Vercel.

**Status**: Feature-rich application with AI-assisted grading (OpenAI `gpt-5-nano`), Tiptap-based rich text editing, assessment draft system (JSON Patch), and scheduled content release. Ongoing: test coverage expansion, component decomposition, and API route standardization.

---

## Required Reading Order

When working on any task, read these files **in this exact order** to prevent architectural drift:

1. **[/docs/ai-instructions.md](/docs/ai-instructions.md)** (this file) — AI orchestrator
2. **[/docs/core/architecture.md](/docs/core/architecture.md)** — System architecture & patterns
3. **[/docs/core/design.md](/docs/core/design.md)** — UI/UX guidelines
4. **[/docs/core/project-context.md](/docs/core/project-context.md)** — Tech stack & setup
5. **[/docs/core/agents.md](/docs/core/agents.md)** — Multi-agent collaboration
6. **[/docs/core/tests.md](/docs/core/tests.md)** — TDD requirements
7. **[/docs/core/roadmap.md](/docs/core/roadmap.md)** — Current status

Then consult:
- **[/docs/guidance/*.md](/docs/guidance/)** — Feature specifications (as needed)
- **[/docs/workflow/handle-issue.md](/docs/workflow/handle-issue.md)** — Issue workflow (when working on issues)

**Only after reading these** should you inspect or modify source code.

---

## Core Loop

1. **Load Context** — Read required docs in order (above)
2. **Understand Requirements** — Read issue or user prompt
3. **Write Tests FIRST** — For core logic (utilities, business rules)
4. **Implement Minimal Code** — Pass the tests
5. **Refactor** — Keep code simple
6. **Keep UI Thin** — Logic in utilities, not components

---

## Critical Constraints

### Platform Requirements (MANDATORY)

✅ **MUST USE**:
- Next.js App Router (NOT Pages Router)
- Supabase for database and storage
- America/Toronto timezone for all deadlines
- Email verification codes (signup/reset) + password login (NO OAuth providers)
- Tailwind CSS for styling
- Vitest + React Testing Library for tests

### API Route Rules (MANDATORY)

🔌 **ALL API routes MUST use `withErrorHandler`** from `@/lib/api-handler`:
```ts
export const GET = withErrorHandler('GetResource', async (request, context) => {
  const user = await requireRole('teacher')
  // ... happy path only — errors auto-mapped to 401/403/400/500
})
```
- **Never** write `export async function GET(...)` with a manual `try/catch` in new routes.
- Use `/migrate-error-handler` slash command to convert existing routes.
- Use `ApiError` / `apiErrors` from `@/lib/api-handler` for domain errors.

### Client-Side Fetch Rules (MANDATORY)

📡 **Use `fetchJSONWithCache`** from `@/lib/request-cache` for repeated client-side API calls:
```ts
const data = await fetchJSONWithCache(
  `resource:${id}`,  // cache key
  () => fetch(`/api/.../resource`).then(r => r.json()),
  20_000  // TTL in ms
)
```
- Never make raw `fetch()` calls in components for data that is fetched repeatedly.
- Exception: one-off mutations (POST/PATCH/DELETE) do NOT need the cache wrapper.

### Tiptap Content Rule (MANDATORY)

📝 **Never define a local `parseContentField`** in route files. Import from `@/lib/tiptap-content`:
```ts
import { parseContentField } from '@/lib/tiptap-content'
const content = parseContentField(doc.content)  // handles string or object
```

### Architecture Rules (PROHIBITED)

❌ **DO NOT**:
- Mix business logic with UI components
- Store plaintext login codes (always hash with bcrypt)
- Skip TDD workflow for core utilities
- Modify architecture without reading design docs first
- Use component libraries (Tailwind only)
- Implement features without tests for core logic
- Make changes to unrelated files
- Over-engineer or add unnecessary abstractions
- **Use `dark:` classes in app code** (use semantic tokens instead)
- **Import UI primitives from `@/components`** (use `@/ui`)
- **Run or apply database migrations** (human applies migrations manually)
- **Write manual try/catch error handling in API routes** (use `withErrorHandler`)
- **Define `parseContentField` locally** (import from `@/lib/tiptap-content`)
- **Make raw `fetch()` calls in components for repeated data** (use `fetchJSONWithCache`)

### Database Migrations (MANDATORY)

🗄️ **AI may**:
- Create new migration files in `supabase/migrations/`
- Modify existing migration files (if not yet applied)
- Rename migration files to fix numbering conflicts

🗄️ **AI must NEVER**:
- Run `supabase db push`, `supabase db reset`, or any migration commands
- Apply migrations to any database (local or remote)
- Assume migrations have been applied

**The human will apply all migrations manually.** After creating/modifying migration files, inform the user that migrations need to be applied.

### Design System Rules (MANDATORY)

🎨 **UI Components**:
- Import `Button`, `Input`, `Select`, `FormField`, `AlertDialog`, `ConfirmDialog`, `Card`, `Tooltip` from `@/ui`
- Wrap all form controls with `<FormField>` for consistent label/error styling
- ESLint and CI enforce these import patterns

🎨 **Semantic Tokens** (instead of `dark:` classes):
```tsx
// CORRECT - semantic tokens
<div className="bg-surface text-text-default border-border">
<p className="text-text-muted">Secondary text</p>

// WRONG - dark: classes in app code
<div className="bg-white dark:bg-gray-900">  // ❌ Blocked by CI
```

Common tokens: `bg-page`, `bg-surface`, `bg-surface-2`, `text-text-default`, `text-text-muted`, `border-border`, `text-primary`, `text-danger`, `text-success`

See `/src/ui/README.md` for the full token reference.

### Security Requirements (MANDATORY)

🔒 **MUST IMPLEMENT**:
- Hash all login codes with bcrypt before storing
- Use HTTP-only, secure, SameSite cookies for sessions
- Validate email domains (check ALLOWED_EMAIL_DOMAIN)
- Rate limit auth endpoints (code requests and verifications)
- Protect routes by role (student vs teacher)
- Never expose session secrets or internal tokens

### Testing Requirements (MANDATORY)

🧪 **MUST TEST**:
- Core utilities: 100% coverage (attendance, timezone, auth, crypto)
- Data layer: 90%+ coverage (API routes with mocked Supabase)
- Pure functions: Test all edge cases
- Timezone handling: Test DST transitions
- Authentication: Code generation, hashing, verification

---

## Workflows — Use Slash Commands

| Task | Claude Code | Codex |
|---|---|---|
| Start a session | `/session-start` | `.codex/prompts/session-start.md` |
| Work on a GitHub issue | `/work-on-issue <N>` | `.codex/prompts/work-on-issue.md` |
| TDD implementation | `/tdd <feature>` | `.codex/prompts/tdd.md` |
| Verify UI changes (MANDATORY) | `/ui-verify <page>` | `.codex/prompts/ui-verify.md` |
| Pre-commit audit | `/audit` | `.codex/prompts/audit.md` |
| Migrate error handler | `/migrate-error-handler <file>` | `.codex/prompts/migrate-error-handler.md` |
| Scaffold API route | `/add-api-route` | `.codex/prompts/add-api-route.md` |

UI changes **must** be visually verified before committing. See `docs/guides/ai-ui-testing.md` for patterns.

---

## Git & Worktrees

Worktree rules are in `.ai/START-HERE.md`. Key points:
- All git commands: `git -C "$PIKA_WORKTREE"`
- All file paths: absolute or `$PIKA_WORKTREE`-prefixed
- Setup details: `docs/dev-workflow.md`

### Merge Policies (MANDATORY)

- **`main`**: No merge commits. Use PR **Squash and merge** (preferred) or linear rebase/cherry-pick.
- **`production`**: Direct push blocked. Use `/merge-main-into-production` command.

### Environment (.env.local)

- Never commit `.env.local` — it's symlinked from `$HOME/Repos/.env/pika/.env.local`
- Each worktree needs: `ln -sf $HOME/Repos/.env/pika/.env.local <worktree>/.env.local`
- See `docs/dev-workflow.md` for setup

---

## Specialized Agents

See [/docs/core/agents.md](/docs/core/agents.md) for details. For complex features, use agents in sequence: Architect → Testing/QA → Implementation → UI/UX.

| Task | Agent |
|---|---|
| System design | Architect |
| Tests / TDD | Testing/QA |
| Feature implementation | Implementation |
| Database / migrations | Data/Storage |
| Refactoring | Refactor |
| UI / visual design | UI/UX |

---

## Common AI Mistakes (Avoid These)

**Don't:**
- Work in `$HOME/Repos/pika` (the hub) — always use a worktree
- Manually edit `.ai/features.json` — use `node scripts/features.mjs pass/fail <id>`
- Commit `.env.local` or secrets — it's symlinked, not a real file
- Skip the reading order — architectural drift happens fast
- Start coding without a plan — state task, wait for approval
- Write `export async function GET(...)` with manual try/catch — use `withErrorHandler`
- Define `parseContentField` locally — import from `@/lib/tiptap-content`
- Make raw `fetch()` in components — use `fetchJSONWithCache` for repeated reads
- Use `dark:` Tailwind classes in app code — use semantic tokens (`bg-surface`, etc.)
- Import from `@/components` for UI primitives — use `@/ui`

**Recovery:**
- Worked in hub by mistake? `git stash`, create worktree, `git stash pop` in worktree
- Committed to wrong branch? `git reset --soft HEAD~1`, switch branches, recommit
- Need to update features.json? Use the script, not manual edits
- Added manual try/catch to a route? Run `/migrate-error-handler` on that file

---

## Anti-Drift Rules

These are the patterns that **most commonly drift** when AI agents add code. Check each one before committing.

| What to check | Required pattern | Violation flag |
|---|---|---|
| New API route handler | `export const X = withErrorHandler(...)` | `export async function X(...)` with try/catch |
| New client-side fetch in component | `fetchJSONWithCache(key, fetcher, ttl)` | raw `fetch()` in component body |
| Content field parsing | `import { parseContentField } from '@/lib/tiptap-content'` | local function definition |
| UI colors/themes | `bg-surface`, `text-text-default`, etc. | `bg-white dark:bg-gray-900` or raw colors |
| UI primitives | `import { Button } from '@/ui'` | `import { Button } from '@/components'` |
| New Supabase column check | `isMissing<Table>Error` guard + `TODO(cleanup-0XX)` | silent failure or permanent guard |

Run `/audit` before every commit to catch violations automatically.

---

## Quick Reference

### Key Files — Core
- **Error handling**: `src/lib/api-handler.ts` — `withErrorHandler`, `ApiError`, `apiErrors`
- **Client cache**: `src/lib/request-cache.ts` — `fetchJSONWithCache(key, fetcher, ttlMs)`
- **Auth**: `src/lib/auth.ts` — `requireRole('teacher' | 'student')`, session management
- **Design system**: `src/ui/` — UI primitives (import from `@/ui`)
- **Token definitions**: `src/styles/tokens.css` — CSS variables for theming
- **Types**: `src/types/index.ts` — centralized TypeScript types (no duplication)

### Key Files — Assessments
- **Tiptap utils**: `src/lib/tiptap-content.ts` — `parseContentField`, `extractPlainText`, etc.
- **Draft system**: `src/lib/server/assessment-drafts.ts` — unified quiz/test draft with JSON Patch
- **Scheduling**: `src/lib/scheduling.ts` — `combineScheduleDateTimeToIso`, `isScheduleIsoInFuture`
- **Quiz logic**: `src/lib/quizzes.ts` — `getStudentQuizStatus`, `getStudentTestStatus`
- **Test responses**: `src/lib/test-responses.ts` — `hasMeaningfulTestResponse`
- **AI grading**: `src/lib/ai-grading.ts` (assignments), `src/lib/ai-test-grading.ts` (tests)

### Key Files — Infrastructure
- **Attendance**: `src/lib/attendance.ts` — pure function, fully testable
- **Timezone**: `src/lib/timezone.ts` — America/Toronto handling
- **Crypto**: `src/lib/crypto.ts` — code generation and hashing

### Key Concepts
- **Assessment discrimination**: `assessment_type: 'quiz' | 'test'` on both quiz and test records
- **Tab mounting**: tabs mount once on first visit, then stay in DOM (persistent mounting)
- **Prefetching**: assignments + resources prefetched at idle; others on demand
- **Gradebook**: fetches on every student selection change (no caching currently — being fixed)
- **Migration shims**: `isMissing<Table>Error` guards removed after migration confirmed applied
- **ClassDay**: a day when attendance is expected
- **Entry**: a student's journal submission for a day

### Common Commands
```bash
pnpm dev                 # Start dev server
pnpm test:watch          # TDD mode
pnpm test:coverage       # Check coverage
gh issue view X          # View issue details
/audit                   # Pre-commit violation check
/migrate-error-handler   # Convert manual try/catch route to withErrorHandler
/add-api-route           # Scaffold new route with best practices
/session-start           # Validate environment + load context
/work-on-issue <N>       # Load issue N, explore, plan
/tdd <feature>           # Write tests first, then implement
/ui-verify <page>        # Take Playwright screenshots to verify UI
```

