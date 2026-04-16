# Pika Current Context

Read this file at the start of every AI session. It is the compact continuity layer for current repo state. Use `.ai/JOURNAL.md` only when you need historical detail.

## Current Focus

- Product status: core classroom, assignment, quiz/test, and auth flows are live.
- Maintenance focus: coverage expansion, API-route standardization, UI decomposition, and AI-guidance cleanup.
- Feature inventory: `.ai/features.json` is the status authority for big epics. All listed epics currently pass.

## Environment And Workflow Facts

- Main hub checkout: `$HOME/Repos/pika`
- Feature worktrees: `$HOME/Repos/.worktrees/pika/<branch-name>`
- Shared env file: `$HOME/Repos/.env/pika/.env.local`
- Package manager: `pnpm` via Corepack (`packageManager: pnpm@10.25.0`)
- Node baseline: `24.x`; `.nvmrc` currently points to `v24.12.0`
- Worktree and shared-env setup are defined only in `docs/dev-workflow.md`

## Repo Invariants

- All deadline and attendance cutoffs use `America/Toronto`
- Keep business logic out of UI components; prefer `src/lib/*` and server-side modules
- API routes use `withErrorHandler` from `@/lib/api-handler`
- Repeated client-side reads use `fetchJSONWithCache` from `@/lib/request-cache`
- Tiptap content parsing uses `parseContentField` from `@/lib/tiptap-content`
- App code uses semantic tokens and `@/ui` primitives, not raw `dark:` classes or `@/components` UI imports
- AI may create or edit migration files, but humans apply migrations manually

## Known Hazards

- Do not work in the hub checkout for non-trivial changes; bind to a worktree first
- Do not tail `.ai/JOURNAL.md` by default; it is intentionally large and should be consulted on demand
- Do not run `supabase db push`, `supabase db reset`, or other migration-application commands as an AI agent
- `main` accepts linear history only; `production` merges go through the protected PR flow

## Recent Architectural Direction

- Session startup now centers on `.ai/START-HERE.md`, this file, `docs/ai-instructions.md`, and `.ai/features.json`
- `docs/dev-workflow.md` is the canonical source for worktrees and shared `.env.local` setup
- The design system expects semantic tokens in app code and `@/ui` imports for primitives
- Route and content drift hotspots are `withErrorHandler`, `fetchJSONWithCache`, and `parseContentField`
