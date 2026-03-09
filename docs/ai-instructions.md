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

## Architecture Snapshot

### Tech Stack
- **Framework**: Next.js 14+ (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Email verification codes (signup/reset) + password login (**NO OAuth**)
- **Styling**: Tailwind CSS
- **Testing**: Vitest + React Testing Library
- **Deployment**: Vercel

### Key Characteristics
- **Timezone**: America/Toronto (hardcoded for all deadline calculations)
- **TDD-first**: Write tests before implementation for core logic
- **Pure functions**: Attendance logic has no side effects, fully testable
- **Mobile-first**: Student experience optimized for mobile devices
- **No component libraries**: Tailwind CSS only
- **Design system**: Import UI primitives from `@/ui`, use semantic tokens (see below)

---

## Core Loop

When building features or fixing bugs, follow this cycle:

1. **Load Context** — Read required documentation in order (see above)
2. **Understand Requirements** — Read issue or user prompt carefully
3. **Write Tests FIRST** — For core logic (utilities, business rules)
4. **Implement Minimal Code** — Pass the tests you wrote
5. **Refactor for Clarity** — Keep code simple and maintainable
6. **Keep UI Thin** — Move logic to utilities, not components

This TDD approach ensures code quality and prevents regressions.

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

## Common Workflows

### Workflow 1: Adding a Feature

1. Read ai-instructions.md (this file)
2. Read all required docs in sequence
3. Create a worktree for your branch (see `docs/dev-workflow.md`)
4. Identify which agent role to adopt (see agents.md)
5. Write tests FIRST for core logic
6. Implement minimal code to pass tests
7. Refactor for clarity
8. Update docs if architecture changes

### Workflow 2: Working on an Issue

1. Run: `gh issue view X --json number,title,body,labels`
2. Follow reading order above
3. Follow `docs/issue-worker.md` (protocol) and `docs/workflow/handle-issue.md` (quick pointer)
4. Create a worktree for `issue/X-slug` (see `docs/dev-workflow.md`)
5. Follow TDD workflow
6. Create PR with "Closes #X"

### Workflow 3: Load Context

1. Say "load context" or similar trigger
2. System loads ai-instructions.md (this file)
3. System loads all files in Required Reading Order
4. Confirm context loaded
5. Ready to work

### Workflow 4: Fixing a Bug

1. Read ai-instructions.md and relevant core docs
2. Create a worktree for your branch (see `docs/dev-workflow.md`)
3. Write a failing test that reproduces the bug
4. Fix code to pass the test
5. Refactor if needed
6. Verify all tests pass

### Workflow 5: AI UI Verification (MANDATORY for UI Changes)

**After ANY UI/UX change, you MUST visually verify using Playwright:**

1. Ensure dev server is running: `pnpm dev`
2. Generate auth states if needed: `pnpm e2e:auth`
3. Take screenshots for **BOTH roles** when applicable:
   ```bash
   # Teacher view
   npx playwright screenshot http://localhost:3000/<page> /tmp/teacher.png \
     --load-storage .auth/teacher.json --viewport-size 1440,900

   # Student view
   npx playwright screenshot http://localhost:3000/<page> /tmp/student.png \
     --load-storage .auth/student.json --viewport-size 1440,900
   ```
4. View the screenshots using the Read tool
5. **Iterate on aesthetics**: If something looks off, fix the code and take another screenshot
6. For automated verifications: `pnpm e2e:verify <scenario>`

**This is not optional.** UI changes must be visually confirmed before committing.

See `docs/guides/ai-ui-testing.md` for detailed patterns.

---

## Git Worktrees (Required Workflow)

`docs/dev-workflow.md` is the single source of truth for worktree setup and usage.

Summary:
- **Hub repo:** `$HOME/Repos/pika` (stays on `main`)
- **Worktrees:** `$HOME/Repos/.worktrees/pika/<branch>`
- Use `pika ls` and `pika claude <worktree>` or `pika codex <worktree>` to bind `PIKA_WORKTREE`
- All git commands must use `git -C "$PIKA_WORKTREE"` (set `PIKA_WORKTREE="$HOME/Repos/pika"` for hub-level commands)

See `docs/dev-workflow.md` for create/cleanup steps and `.env.local` symlinks.

### Main Merge Policy (MANDATORY)

- `main` is protected against merge commits.
- Do not push merge commits to `main`.
- Use one of these landing strategies:
  - PR **Squash and merge** (preferred)
  - Linear local integration (`rebase`, `cherry-pick`, or `merge --squash` + commit)

### Production Merge Policy (MANDATORY)

- `production` requires pull requests; direct pushes are blocked by branch rules.
- For `main` -> `production`:
  1. Ensure `production` worktree exists (prune stale entries and re-add if needed).
  2. Merge `origin/main` into local `production` worktree branch.
  3. Push that merge commit to a temporary branch.
  4. Open a PR with `base=production`.
  5. Merge via GitHub, then fast-forward local `production` to `origin/production`.
- When running `gh pr create`, prefer single-quoted title/body text (avoid shell-processed backticks).

---

## Environment Files (.env.local)

### Core Principle

`.env.local` contains real secrets and must NEVER be committed. All ACTIVE repos and worktrees must symlink `.env.local` from a single canonical location to avoid duplication and drift.

### File Locations

- **Canonical `.env.local`:** `$HOME/Repos/.env/pika/.env.local` (contains real secrets)
- **Example file (committed):** `.env.example` (in repo, no secrets)

### Symlink Setup

Each worktree must symlink `.env.local` to the canonical file:

```bash
ln -sf $HOME/Repos/.env/pika/.env.local <worktree>/.env.local
```

**Why symlinks:**
- Worktrees do not share gitignored files
- Symlinks avoid duplication and drift across branches
- `-s` = symbolic link, `-f` = force/replace existing file

See `docs/dev-workflow.md` for the recommended worktree setup flow.

### Branch-Specific Envs (Exceptions Only)

Use separate `.env.local` files ONLY in these cases:
- Running multiple Supabase/backend instances in parallel
- Destructive DB schema or migration experiments
- Different external API keys, models, or cost profiles

**Otherwise, shared `.env.local` is mandatory.**

---

## Archived Repos

- Repos under `$HOME/Repos/archive/<project>` are inactive
- Archived repos may have broken `.env.local` symlinks or missing worktrees
- This is acceptable and intentional
- Only active repos under `$HOME/Repos/` require valid env symlinks and worktrees

---

## When to Spawn Specialized Agents

See [/docs/core/agents.md](/docs/core/agents.md) for detailed agent definitions. Use these agents based on task type:

| Task Type | Agent to Use |
|-----------|--------------|
| System design changes | **Architect Agent** |
| Writing tests, TDD implementation | **Testing/QA Agent** |
| Building features with TDD | **Implementation Agent** |
| Database schema, migrations, RLS | **Data/Storage Agent** |
| Code cleanup, refactoring | **Refactor Agent** |
| UI components, visual design | **UI/UX Agent** |

**Multi-agent collaboration**: For complex features, spawn multiple agents in sequence (e.g., Architect → Testing/QA → Implementation → UI/UX).

---

## Platform-Specific Usage Notes

### Claude Code (CLI)
- Preferred tool for this project
- Use `/docs` commands to navigate documentation
- Follow TDD workflow with test:watch mode
- Use git integration for commits and PRs

### GitHub Copilot / Cursor
- Read this file and core docs in workspace
- Keep documentation open in editor
- Verify suggestions against architectural constraints
- Run tests frequently

### ChatGPT / Claude.ai
- Copy relevant docs into conversation context
- Request full file contents, not snippets
- Verify code against constraints before applying
- Test implementations manually

---

## Decision-Making Guidelines

When facing implementation choices:

1. **Follow existing patterns** — Check codebase for similar implementations
2. **Prefer simplicity** — Don't over-engineer or add unnecessary abstractions
3. **TDD-first** — Write tests to clarify expected behavior
4. **Consult docs** — Re-read architecture.md and design.md
5. **Document decisions** — Add comments for non-trivial logic
6. **Make reasonable assumptions** — Don't block on minor details
7. **Update docs** — If changing architecture, update relevant /docs files

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

---

## Maintaining This File

**When to update ai-instructions.md**:
- Core architecture changes
- New mandatory constraints added
- New agent types introduced
- Reading order changes
- Critical patterns change

**Who updates**:
- Project maintainer (human)
- AI agents should propose updates, not make them directly

---

## Next Steps

- **New to the project?** Continue reading in the order specified above
- **Working on an issue?** See [/docs/workflow/handle-issue.md](/docs/workflow/handle-issue.md)
- **Adding a feature?** See [/docs/guidance/](/docs/guidance/) for feature specs
- **Need technical details?** See [/docs/core/architecture.md](/docs/core/architecture.md)
- **Questions about testing?** See [/docs/core/tests.md](/docs/core/tests.md)
- **Agent collaboration?** See [/docs/core/agents.md](/docs/core/agents.md)

---

**Remember**: This file is your entry point. Read it first, then follow the reading order. This discipline prevents architectural drift and ensures consistent, high-quality implementations.
