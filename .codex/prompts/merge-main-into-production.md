Merge `main` into `production` via the protected PR flow.

Use the repository skill:

- Skill: `.codex/skills/pika-main-to-production-merge`
- Script: `.codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh`

Rules:
- Run commands directly (do not return copy/paste-only guidance).
- Respect worktree rules (`git -C "$PIKA_WORKTREE"` for repo worktree operations).
- Expect direct pushes to `production` to be rejected by branch protection (`GH013`).
- If merge conflicts occur, stop and ask for resolution direction.

Execution steps:
1. Run preflight + merge branch + PR creation:
   - `bash .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh`
2. Merge the created PR.
3. Fast-forward local production worktree:
   - `git -C "$HOME/Repos/.worktrees/pika/production" fetch origin production`
   - `git -C "$HOME/Repos/.worktrees/pika/production" merge --ff-only origin/production`
4. Report final `origin/production` commit SHA.
