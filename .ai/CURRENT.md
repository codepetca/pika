Focus: draft PR #963 redesigns hot archived classroom deletion around explicit,
single-scope managed-file ownership. Review hardening now preserves immutable
Blueprint Versions, reconciles cold compaction/restore ownership, and adds a
guarded all-class readiness command. Migration 117 remains unapplied to any
persistent local or hosted target; generated types came from the exact-head CI
ephemeral replay. Every rollout gate remains disabled, and production remains
through 116.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
