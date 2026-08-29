Merge `main` into `production` using the protected PR workflow.
(Vercel production deploys from `production`.)

Use the repo helper and `docs/dev-workflow.md` as the canonical process. Do not
switch the hub checkout between `main` and `production`; the helper creates a
fresh ephemeral detached worktree from `origin/production`.

Rules:
- Run all commands directly.
- Never force-push.
- Never rewrite `main` or `production`.
- If conflicts occur, stop and report the preserved ephemeral worktree path.

Steps:

1) Confirm this task is specifically `main` into `production`.

2) Run the helper from the current Pika checkout:
   ```bash
   bash .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh
   ```

3) Reuse the helper's created or updated draft PR; never open a second promotion PR. Complete cumulative review, record the reviewed SHA, mark it ready, and wait for `PR Gate`.

4) After the reviewed batch is merged, confirm the ephemeral worktree was
removed. No persistent local `production` branch should be advanced.

5) Report the final `origin/production` commit SHA.
