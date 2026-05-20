Merge `main` into `production` using the protected PR workflow.
(Vercel production deploys from `production`.)

Use the repo helper and `docs/dev-workflow.md` as the canonical process. Do not
switch the hub checkout between `main` and `production`; the helper uses a
registered `production` worktree and creates one under
`$HOME/.codex/worktrees/pika/production` only when needed.

Rules:
- Run all commands directly.
- Never force-push.
- Never rewrite `main` or `production`.
- If conflicts occur, stop and ask for help resolving them in the production worktree.

Steps:

1) Confirm this task is specifically `main` into `production`.

2) Run the helper from the current Pika checkout:
   ```bash
   bash .codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh
   ```

3) If the helper creates a PR, report its URL and ask the user to merge it or confirm that you should merge it.

4) After the PR is merged, sync the local production worktree using the path printed by the helper:
   ```bash
   git -C <production-worktree> fetch origin production
   git -C <production-worktree> merge --ff-only origin/production
   ```

5) Report the final `origin/production` commit SHA.
