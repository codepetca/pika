Focus: managed-ID hot-archive deletion; leave #963 unchanged.
Worktrees: `$HOME/.codex/worktrees/pika/`, `$HOME/.codex/worktrees/<id>/pika`.
Env: maintainers use `$HOME/Repos/.env/pika/.env.local`; collaborators copy `.env.example`.
Migration 118 is draft/disabled. Local has the old body; hosted targets and
gates are untouched. Five high-risk review launches are clean after fixes for
safe retries, RPC-only ledgers, legacy-upgrade refusal, operational impact, and
cron compatibility. Exact-head DB CI is next. Applying 118 requires fresh
authorization.
