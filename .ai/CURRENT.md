Focus: managed-storage ownership foundation is implemented on
`codex/managed-storage-ownership-foundation` from `origin/main` without changing
draft PR #963. Production history 115/116 is preserved byte-for-byte; new
migration 117 remains unapplied pending exact target authorization.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- `managed_storage_objects` is the proposed sole file lifecycle authority.
  Enforcement and generic cleanup remain off; permanent classroom deletion is
  intentionally absent. Rollout: `docs/guidance/managed-storage-rollout.md`.
- The shared local database currently contains PR #963's unrelated migration
  117. Do not replay or alter it without exact authorization and an isolated
  target; CI owns the fresh 115-117 replay fixture for this branch.
- Trim session logs after updates. `production` uses the protected PR flow.
