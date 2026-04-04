# Repository Agent Guidelines (Pika)

**Start here:** Read `.ai/START-HERE.md` before doing anything.

Full instructions: `docs/ai-instructions.md`

---

## Critical Rules (enforced by CI/ESLint)

### Always
- **API routes**: `export const GET = withErrorHandler('Name', async (req, ctx) => { ... })` — never manual try/catch
- **Client fetches**: `fetchJSONWithCache(key, fetcher, ttlMs)` from `@/lib/request-cache` — never raw `fetch()` in components
- **Tiptap content**: `import { parseContentField } from '@/lib/tiptap-content'` — never define it locally
- **UI colors**: semantic tokens (`bg-surface`, `text-text-default`, `border-border`) — never `dark:` classes or raw colors
- **UI imports**: `import { Button, Input, ... } from '@/ui'` — never from `@/components`

### Never
- Run `supabase db push` or any migration command — human applies migrations manually
- Commit `.env.local` — it is a symlink, not a real file
- Work in the hub repo (`$HOME/Repos/pika`) — your session is bound to a worktree under `.codex/worktrees/`

---

## Worktrees

Your session runs inside a worktree at `$HOME/Repos/pika/.codex/worktrees/<name>`. Use plain `git` commands (no `-C` flags needed — your CWD is the worktree).

**Safety check** — verify at session start:
```bash
git rev-parse --show-toplevel   # must contain .codex/worktrees/ or .claude/worktrees/
```

**Create a new worktree:**
```bash
git -C "$HOME/Repos/pika" worktree add .codex/worktrees/<name> -b <branch>
cd "$HOME/Repos/pika/.codex/worktrees/<name>"
bash scripts/setup-worktree.sh   # links .env.local
```

**Never work in the hub** (`$HOME/Repos/pika` itself).

---

## Environment Files

All worktrees share a single canonical `.env.local`:
```
$HOME/Repos/.env/pika/.env.local
```
Each worktree symlinks to it. If `.env.local` is missing: `bash scripts/setup-worktree.sh`.

---

## Session Log

`.ai/SESSION-LOG.md` — rolling 10-entry log. Append a summary at the end of each session, then trim:
```bash
node scripts/trim-session-log.mjs
```

---

## UI/UX Changes: MUST Verify Visually (MANDATORY)

After ANY UI/UX change:
1. Ensure dev server is running: `pnpm dev`
2. Refresh auth if needed: `pnpm e2e:auth`
3. Take screenshots:
```bash
npx playwright screenshot http://localhost:3000/classrooms /tmp/teacher-view.png \
  --load-storage .auth/teacher.json --viewport-size 1440,900

npx playwright screenshot http://localhost:3000/classrooms /tmp/student-view.png \
  --load-storage .auth/student.json --viewport-size 1440,900
```
4. Iterate until verified. See `docs/guides/ai-ui-testing.md` for patterns.

---

## Project Overview
- Next.js 14+ (App Router) + TypeScript
- Supabase (PostgreSQL) for data/storage
- Auth: email verification codes + password login + `iron-session` cookies
- Styling: Tailwind CSS (no component libraries)
- Testing: Vitest + React Testing Library

## Core Commands
- Verify env: `bash scripts/verify-env.sh`
- Tests: `pnpm test` (watch: `pnpm test:watch`)
- Lint: `pnpm lint`
- Build: `pnpm build`

## When Docs Conflict (priority order)
1. `.ai/features.json` (status authority)
2. `docs/core/architecture.md` (architecture invariants)
3. `docs/core/tests.md` (testing requirements)
4. `docs/core/design.md` (UI/UX rules)
5. `docs/core/project-context.md` (setup and commands)
6. `docs/core/decision-log.md` (historical rationale)
7. `.ai/SESSION-LOG.md` (recent session context)
