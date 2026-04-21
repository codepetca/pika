# Repository Agent Guidelines (Pika)

## Start Here (MANDATORY)
- Read `.ai/START-HERE.md` at the start of every session.
- Read `.ai/CURRENT.md` as the default continuity file.
- **`docs/ai-instructions.md` is the authoritative source** for AI routing, task-based doc loading, and top-level coding invariants.
- **`docs/dev-workflow.md` is the authoritative source** for worktree usage and shared `.env.local` setup.
- Follow the startup contract in `.ai/START-HERE.md` before modifying code.

## UI/UX Changes: MUST Verify Visually (MANDATORY)

After any UI/UX change, you must:
1. Take screenshots and visually verify the result
2. Check both teacher and student views when both roles are affected
3. Iterate until the styling and layout are acceptable

Use `docs/guides/ai-ui-testing.md` and `.codex/prompts/ui-verify.md` for the actual procedure.

## Git Worktrees (Required Workflow)

- Never switch branches inside an existing feature checkout.
- Use one worktree per branch.
- Use `docs/dev-workflow.md` for creation, cleanup, and the `pika` command workflow.
- Avoid the legacy `scripts/wt-add.sh` helper.

## Environment Files (.env.local)

- Shared `.env.local` setup is defined in `docs/dev-workflow.md`.
- Default policy: worktrees share the canonical env file via symlink.
- Only use branch-specific env files when intentionally isolating backend state or secrets.

## Project Overview
- Next.js 14+ (App Router) + TypeScript
- Supabase (PostgreSQL) for data/storage
- Auth: email verification codes (signup/reset) + password login + `iron-session` cookies
- Styling: Tailwind CSS (no component libraries)
- Testing: Vitest + React Testing Library

## Core Commands
- Verify: `bash scripts/verify-env.sh` (optional: `--full`)
- Tests: `pnpm test` (watch: `pnpm test:watch`)
- Lint: `pnpm lint`
- Build: `pnpm build`

## AI Continuity Rules
- `.ai/CURRENT.md` is the default always-read AI context file.
- `.ai/JOURNAL.md` is append-only. Log meaningful work each session.
- `.ai/features.json` is append-only. Track **big epics only** and update status with `node scripts/features.mjs`.

## Non-Negotiable Constraints
- Keep business logic out of UI components; prefer `src/lib/*` and server-side code for logic.
- All deadline calculations use `America/Toronto` timezone.
- Do not introduce new dependencies unless explicitly approved.
- Do not commit secrets (`.env.local`, Supabase keys, session secrets).

## When Docs Conflict
1. `.ai/features.json` (status authority)
2. `.ai/CURRENT.md` (current-state summary)
3. `docs/core/architecture.md` (architecture invariants)
4. `docs/core/tests.md` (testing requirements)
5. `docs/core/design.md` (UI/UX rules)
6. `docs/core/project-context.md` (setup and commands)
7. `.ai/JOURNAL.md` + `docs/core/decision-log.md` (history/rationale)
