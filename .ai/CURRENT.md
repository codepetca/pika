Prod 001–123. Individual-student purge enabled; cold Classroom deletion and
generic cleanup off. Migration 124 local-only on `codex/cron-run-ledger`: a
service-only durable ledger for `/api/cron/cleanup-history`; no new schedule or
purge authority. Fresh local 001–124 replay, fixtures, types, 4,239 tests, build,
lint, and audit pass. Next: PR/review, compatible deploy, then separately
authorize prod 124. Follow up migration-123 ambiguous retry count separately.
WT: `$HOME/.codex/worktrees/pika/cron-run-ledger`.
Env: `$HOME/Repos/.env/pika/.env.local`.
