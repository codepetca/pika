# Pika Current Context

Read this at session start. `.ai/features.json` is the epic status authority; `.ai/SESSION-LOG.md` holds recent handoff context.

## Current Focus

- Core classroom, assignment, test, and auth flows are live.
- Production migrations 001-098 and the named archive round-trip canary are verified. The classroom is hot-restored; source and Gradex cleanup remain disabled.
- The product-experience program is tracked in `.ai/features.json`; Phase 1 evidence is in `docs/guidance/ui/product-experience-audit-2026-07.md`.
- Phase 2 assignment integrity is active in PR #891 on `codex/assignment-submit-save-integrity`: atomic writes, recovery-safe retries, artifact cleanup evidence, concurrency gates, and local teacher/student visual verification are green. Production remains at migration 098.
- Before merge: finish PR CI and review. Apply and verify migration 099 before deploying the app version.

## Environment

- Hub: `$HOME/Repos/pika`
- Named worktrees: `$HOME/.codex/worktrees/pika/<branch-name>`
- App-managed worktrees: `$HOME/.codex/worktrees/<id>/pika`
- Maintainer env: symlink `.env.local` to `$HOME/Repos/.env/pika/.env.local`
- Collaborators may copy `.env.example` to a checkout-local `.env.local`
- Full worktree/env rules: `docs/dev-workflow.md`

## Invariants And Hazards

- Use `America/Toronto` for deadline/attendance cutoffs; keep business logic in `src/lib/*` or server modules.
- API routes use `withErrorHandler`; app UI uses semantic tokens and `@/ui`.
- Migration application needs one-time permission naming target and migration; it never authorizes reset, repair, rollback, seeding, or cleanup.
- Use a dedicated worktree for non-trivial changes. Keep the session log bounded with `node scripts/trim-session-log.mjs` after appending.
- `main` accepts linear history; `production` uses the protected PR flow.
