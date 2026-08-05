Focus: verified managed-ID hot-archive deletion in draft PR #968; leave #963 unchanged.
Worktrees: `$HOME/.codex/worktrees/pika/`, `$HOME/.codex/worktrees/<id>/pika`.
Env: maintainers use `$HOME/Repos/.env/pika/.env.local`; collaborators copy `.env.example`.
Exact-head CI/review pass at `ab4ce5f6`, including replay, destructive/concurrency
fixtures, recovery rehearsal, and teacher/student UI. Migration 118 remains draft
and rollout-disabled; applying it requires fresh target-specific authorization.
