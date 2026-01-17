# Repository Agent Guidelines (Pika)

## Start Here (MANDATORY)
- Read `.ai/START-HERE.md` at the start of every session.
- **`docs/ai-instructions.md` is the authoritative source** for repository layout, worktree usage, and environment file handling.
- Follow the required reading order in `docs/ai-instructions.md` before modifying code.

## UI/UX Changes: MUST Verify Visually (MANDATORY)

**After ANY UI/UX change, you MUST:**

1. Take a screenshot and visually verify the change
2. Check BOTH teacher AND student views (if applicable)
3. Iterate on aesthetics/styling until it looks good

```bash
# 1. Ensure dev server is running
pnpm dev

# 2. Refresh auth if needed (uses teacher@example.com / student1@example.com)
pnpm e2e:auth

# 3. Take screenshot as teacher
npx playwright screenshot http://localhost:3000/classrooms /tmp/teacher-view.png \
  --load-storage .auth/teacher.json --viewport-size 1440,900

# 4. Take screenshot as student
npx playwright screenshot http://localhost:3000/classrooms /tmp/student-view.png \
  --load-storage .auth/student.json --viewport-size 1440,900

# 5. View the screenshot (use Read tool on the image file)
```

**Iterate until satisfied:** If something looks off, fix the code and take another screenshot.

See: `docs/guides/ai-ui-testing.md` for detailed usage.

## Git Worktrees (Required Workflow)

**Core Principle:** Never switch branches in an existing working directory. For any non-trivial task, ALWAYS create a git worktree.

**Rules:**
- One worktree == one branch
- Treat branch switching as directory switching
- Main repo lives at: `$HOME/Repos/pika` (hub checkout, stays on `main`)
- Worktrees live under: `$HOME/Repos/.worktrees/pika/<branch-name>`

**Quick start (existing worktree):**
```bash
pika ls
pika claude <worktree>
# or
pika codex <worktree>
```

**Creating a new worktree:**
- Follow `docs/dev-workflow.md` (authoritative)

**Cleanup:**
- After PR is merged, remove the worktree and delete the local branch.
- Use the safe patterns in `docs/dev-workflow.md` (all git commands via `git -C "$PIKA_WORKTREE"`).

**Legacy Helper Script (avoid):**
- `bash scripts/wt-add.sh <branch-name>` (superseded by `docs/dev-workflow.md`)

## Environment Files (.env.local)

**Core Principle:** All worktrees share a single canonical `.env.local` file to avoid duplication and drift.

**Canonical Location:**
```
$HOME/Repos/.env/pika/.env.local
```

**Symlink Setup:**
Each worktree must symlink `.env.local` to the canonical file:
```bash
ln -sf $HOME/Repos/.env/pika/.env.local <worktree>/.env.local
```

**Why Symlinks:**
- Worktrees do not share gitignored files
- Symlinks avoid duplication and drift across branches
- `-s` = symbolic link, `-f` = force/replace existing file

**Workflow Reference:**
- See `docs/dev-workflow.md` for the recommended setup flow

### When Branch-Specific Envs Are Allowed (Exceptions Only)

Use separate `.env.local` files ONLY in these cases:
- Running multiple Supabase/backend instances in parallel
- Destructive DB schema or migration experiments
- Different external API keys, models, or cost profiles

**Otherwise, shared `.env.local` is mandatory.**

## Project Overview
- Next.js 14+ (App Router) + TypeScript
- Supabase (PostgreSQL) for data/storage
- Auth: email verification codes (signup/reset) + password login + `iron-session` cookies
- Styling: Tailwind CSS (no component libraries)
- Testing: Vitest + React Testing Library

## Core Commands
- Verify: `bash scripts/verify-env.sh` (optional: `--full`)
- Tests: `npm test` (watch: `npm run test:watch`)
- Lint: `npm run lint`
- Build: `npm run build`

## AI Continuity Rules
- `.ai/JOURNAL.md` is append-only. Log meaningful work each session.
- `.ai/features.json` is append-only. Track **big epics only** and update status with `node scripts/features.mjs`.

## Non-Negotiable Constraints
- Keep business logic out of UI components; prefer `src/lib/*` and server-side code for logic.
- All deadline calculations use `America/Toronto` timezone.
- Do not introduce new dependencies unless explicitly approved.
- Do not commit secrets (`.env.local`, Supabase keys, session secrets).

## When Docs Conflict
1. `.ai/features.json` (status authority)
2. `docs/core/architecture.md` (architecture invariants)
3. `docs/core/tests.md` (testing requirements)
4. `docs/core/design.md` (UI/UX rules)
5. `docs/core/project-context.md` (setup and commands)
6. `.ai/JOURNAL.md` + `docs/core/decision-log.md` (history/rationale)
