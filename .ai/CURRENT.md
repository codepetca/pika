Focus: deletion. Prod 001–121; managed storage enforced; hot Classroom and Pika
Blueprint deletion broadly enabled; canaries passed. Monitoring is deployed and
initially healthy. Cold Classroom deletion is implemented on
`codex/cold-archived-classroom-deletion`: migration 122 is locally applied and its
rollback-only DB rehearsal, full tests, build, lint, types, and desktop/mobile UI
verification pass. Its independent rollout gate defaults off; no remote migration
or rollout is authorized. Generic cleanup stays off. WT:
`$HOME/.codex/worktrees/pika/` or `$HOME/.codex/worktrees/<id>/pika`. Env:
`$HOME/Repos/.env/pika/.env.local` or collaborator `.env.example`. Next: reviewed
PR/merge for cold deletion; then separately audit and design individual-student purge.
