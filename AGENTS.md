# Repository Agent Guidelines (Pika)

## Start Here (MANDATORY)
- Read `.ai/START-HERE.md` at the start of every session.
- Follow the required reading order in `docs/ai-instructions.md` before modifying code.

## Git Worktrees (MANDATORY)
- Never do branch work in the main repo directory (`pika/`).
- Any branch work must happen in a dedicated git worktree under `../worktrees/pika/`.
- Do not switch branches inside an existing working tree; create a new worktree instead.
- After a PR is merged, remove its worktree (see `docs/workflow/worktrees.md`).

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
