Focus: stage managed Blueprint deletion safely. Prod has migrations 117–120;
all deletion/cleanup gates are off. Local 001–120 replay, generated types, seed,
managed-storage checks, and Blueprint purge fixture pass.
WT: `$HOME/.codex/worktrees/pika/` or `$HOME/.codex/worktrees/<id>/pika`.
Env: `$HOME/Repos/.env/pika/.env.local` or collaborator `.env.example`.
Every unclosed copy intent blocks purge, with guarded operator recovery.
Production Blueprint deletion is installed but rollout-disabled; no purge ran.
