# Pika Current Context

Read this file at the start of every AI session. It is the compact continuity layer for current repo state. Use `.ai/SESSION-LOG.md` only for recent handoff context and `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## Current Focus

- Product status: core classroom, assignment, quiz/test, and auth flows are live.
- Maintenance focus: coverage expansion, API-route standardization, UI decomposition, and AI-guidance cleanup.
- Feature inventory: `.ai/features.json` is the status authority for big epics; check it directly for current pass/fail state.

## Environment And Workflow Facts

- Main hub checkout: `$HOME/Repos/pika`
- Feature worktrees: `$HOME/Repos/.worktrees/pika/<branch-name>`
- Shared env file: `$HOME/Repos/.env/pika/.env.local`
- Runtime and package-manager requirements live in `.nvmrc`, `package.json`, and `scripts/verify-env.sh`
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
- Do not tail `.ai/JOURNAL-ARCHIVE.md` by default; it is intentionally large
- Keep `.ai/SESSION-LOG.md` as a rolling recent log and run `node scripts/trim-session-log.mjs` after appending
- Do not run `supabase db push`, `supabase db reset`, or other migration-application commands as an AI agent
- `main` accepts linear history only; `production` merges go through the protected PR flow

## Recent Architectural Direction

- Session startup now centers on `.ai/START-HERE.md`, this file, `docs/ai-instructions.md`, and `.ai/features.json`
- `docs/dev-workflow.md` is the canonical source for worktrees and shared `.env.local` setup
- The design system expects semantic tokens in app code and `@/ui` imports for primitives
- Route and content drift hotspots are `withErrorHandler`, `fetchJSONWithCache`, and `parseContentField`
