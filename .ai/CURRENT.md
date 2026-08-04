Focus: managed-ID hot-archive deletion; leave #963 unchanged.
Worktrees: `$HOME/.codex/worktrees/pika/`, `$HOME/.codex/worktrees/<id>/pika`.
Env: maintainers use `$HOME/Repos/.env/pika/.env.local`; collaborators copy `.env.example`.
Migration 118 is draft/disabled; local has the old body and hosted targets and
gates are untouched. PR #968 CI fails in managed-storage concurrency before the
purge fixture; diagnose next. Applying 118 requires fresh authorization.
