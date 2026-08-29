Merge `main` into `production` using the protected PR workflow.

Use the dedicated repo skill and `docs/dev-workflow.md` as the canonical process reference.
Do not switch the hub checkout between `main` and `production`; the helper uses
a registered production worktree.

Primary command:
```bash
bash .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh
```

After the script:
1. Reuse the created or updated draft PR; never open a second promotion PR.
2. Complete cumulative review, record the reviewed SHA, mark ready, and wait for `PR Gate`.
3. Merge the reviewed batch.
4. Fast-forward the local production worktree to `origin/production`.
5. Report the final `origin/production` commit SHA.
6. Stop and ask for direction if conflicts appear at any stage.
