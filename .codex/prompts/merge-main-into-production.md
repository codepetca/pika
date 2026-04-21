Merge `main` into `production` using the protected PR workflow.

Use the dedicated repo skill and `docs/dev-workflow.md` as the canonical process reference.

Primary command:
```bash
bash .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh
```

After the script:
1. Merge the created PR.
2. Fast-forward the local production worktree to `origin/production`.
3. Report the final `origin/production` commit SHA.
4. Stop and ask for direction if conflicts appear at any stage.
