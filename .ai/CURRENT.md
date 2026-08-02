Focus: PR #967 managed storage; #963 unchanged. Migrations 115/116 exact; 117 unapplied.

## Context

- Status: `.ai/features.json`; design: `DESIGN.md`; workflow: `docs/dev-workflow.md`.
- Worktrees: `$HOME/.codex/worktrees/pika/` or `$HOME/.codex/worktrees/<id>/pika`.
- Env: `$HOME/Repos/.env/pika/.env.local`; collaborators copy `.env.example`.
- Toronto/server/`withErrorHandler`/semantic/human-migration invariants apply.
- Rollout: `docs/guidance/managed-storage-rollout.md`; enforcement, cleanup, and
  deletion are off. Shared local has PR #963's different 117.
