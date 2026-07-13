# Pika Current Context

Read this at the start of every AI session. Use `.ai/SESSION-LOG.md` only for recent handoff context and `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## Current Focus

- Product status: core classroom, assignment, quiz/test, and auth flows are live.
- Maintenance focus: coverage expansion, API-route standardization, UI decomposition, and AI-guidance cleanup.
- Feature inventory: `.ai/features.json` is the status authority for big epics; check it directly for current pass/fail state.
- Classroom archives: migrations 082/083 provide gated verified export/restore. A stacked pure Gradex transformer exists, but runtime upload/retention, cold compaction, UI, and production canaries remain unfinished.

## Environment And Workflow Facts

- Main hub checkout: `$HOME/Repos/pika`
- New named Pika worktrees: `$HOME/.codex/worktrees/pika/<branch-name>`
- Codex Desktop may also use app-managed worktrees: `$HOME/.codex/worktrees/<id>/pika`
- Maintainer shared env file: `$HOME/Repos/.env/pika/.env.local`; worktrees on that setup symlink `.env.local` to it before running the app
- Collaborator setup may keep a checkout-local `.env.local` copied from `.env.example`
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

- Do not work in the hub checkout for non-trivial changes; create or open a dedicated worktree first
- Do not tail `.ai/JOURNAL-ARCHIVE.md` by default; it is intentionally large
- Keep `.ai/SESSION-LOG.md` rolling; immediately run `node scripts/trim-session-log.mjs` after each append
- Do not run `supabase db push`, `supabase db reset`, or other migration-application commands as an AI agent
- `main` accepts linear history only; `production` merges go through the protected PR flow
