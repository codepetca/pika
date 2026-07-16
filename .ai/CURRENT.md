# Pika Current Context

Read this at the start of every AI session. Use `.ai/SESSION-LOG.md` only for recent handoff context and `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

## Current Focus

- Product status: core classroom, assignment, quiz/test, and auth flows are live.
- Maintenance focus: coverage expansion, API-route standardization, UI decomposition, and AI-guidance cleanup.
- Feature inventory: `.ai/features.json` is the status authority for big epics; check it directly for current pass/fail state.
- Classroom archives: production migrations 001-098, hosted audits, and the named round-trip canary
  are verified. The archive was retained and the classroom restored hot; source and Gradex cleanup
  remain disabled.
- Product experience architecture program: Phase 1 audit and evidence are in
  `docs/guidance/ui/product-experience-audit-2026-07.md`. The next reviewed slice is the Safety Wave
  guard against permanent hot-archive deletion; shared foundation and product phases 2-6 remain active.

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
- AI applies migrations only with one-time permission naming the target and migration

## Known Hazards

- Do not work in the hub checkout for non-trivial changes; create or open a dedicated worktree first
- Do not tail `.ai/JOURNAL-ARCHIVE.md` by default; it is intentionally large
- Keep `.ai/SESSION-LOG.md` rolling; immediately run `node scripts/trim-session-log.mjs` after each append
- Migration approval never covers reset, repair, rollback, seeding, or cleanup
- `main` accepts linear history only; `production` merges go through the protected PR flow
