Focus: finish migration-118/119 reconciliation; #968 merged, #963 held.
Worktrees: `$HOME/.codex/worktrees/pika/`, `$HOME/.codex/worktrees/<id>/pika`.
Env: maintainers use `$HOME/Repos/.env/pika/.env.local`; collaborators copy
`.env.example`. Prod: migrations 117–119; managed Storage enforced. Canaries
deleted 210 rows/four files; inventory is 140/140 ready. The canary Blueprint
and users are preserved. Canary targets a deleted Classroom; cleanup and global
rollout are disabled. Follow-up: prove Classroom creation from that Blueprint,
then add durable Blueprint/managed-file deletion. Production changes require
authorization.
