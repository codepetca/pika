Merge `main` into `production` via the protected PR flow.

Rules:
- Direct pushes to `production` are rejected by branch protection (`GH013`) — always use a PR.
- If merge conflicts occur, stop and ask for resolution direction.

Steps:

1) Preflight (run from hub):
   ```bash
   REPO="$HOME/Repos/pika"
   git -C "$REPO" fetch origin
   git -C "$REPO" worktree prune
   if [ ! -d "$REPO/.claude/worktrees/production" ]; then
     git -C "$REPO" worktree add "$REPO/.claude/worktrees/production" production
   fi
   ```

2) Merge in production worktree:
   ```bash
   PROD="$HOME/Repos/pika/.claude/worktrees/production"
   git -C "$PROD" fetch origin main production
   git -C "$PROD" merge --ff-only origin/production
   git -C "$PROD" merge origin/main
   ```

3) Open PR:
   ```bash
   MERGE_BRANCH="merge-main-into-production-$(date +%Y%m%d)"
   git -C "$PROD" push origin HEAD:"refs/heads/$MERGE_BRANCH"
   gh pr create \
     --repo codepetca/pika \
     --base production \
     --head "$MERGE_BRANCH" \
     --title "Merge main into production ($(date +%Y-%m-%d))" \
     --body 'Merge latest main into production.'
   ```

4) After merge, sync:
   ```bash
   gh pr merge <pr-number> --repo codepetca/pika --merge
   git -C "$PROD" fetch origin production
   git -C "$PROD" merge --ff-only origin/production
   ```

5) Report final `origin/production` commit SHA.
