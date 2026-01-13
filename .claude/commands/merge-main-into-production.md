Merge `main` into `production` via a PR branch.
(Vercel production deploys from `production`.)

This is a **hub-level operation** — it must run from the hub repo, not a worktree.

Note: Hub path is assumed to be `$HOME/Repos/pika`.

Rules:
- Run all commands directly (do not output copy-pasteable commands).
- ALL git commands MUST use: `git -C "$HOME/Repos/pika"`
- Never force-push.
- Never rewrite `main` or `production`.
- If conflicts occur, stop and ask for help resolving them.

Steps:

1) Verify hub environment
   - Verify this is the hub: `echo $PIKA_WORKTREE`
   - If `$PIKA_WORKTREE` is set to a worktree path (not `$HOME/Repos/pika`), stop and tell me to run this from the hub instead.
   - Run: `git -C "$HOME/Repos/pika" remote -v`, `git -C "$HOME/Repos/pika" status -sb`
   - If `origin` doesn't point to the expected repo, stop and tell me what to fix.

2) Update branches
   - `git -C "$HOME/Repos/pika" fetch --all --prune`
   - `git -C "$HOME/Repos/pika" switch main && git -C "$HOME/Repos/pika" pull --ff-only origin main`
   - `git -C "$HOME/Repos/pika" switch production && git -C "$HOME/Repos/pika" pull --ff-only origin production`

3) Create PR branch + merge
   - Branch name: `merge/main-to-production-YYYYMMDD` (use today's date)
   - `git -C "$HOME/Repos/pika" switch production`
   - `git -C "$HOME/Repos/pika" switch -c merge/main-to-production-YYYYMMDD`
   - `git -C "$HOME/Repos/pika" merge --no-ff main`
   - If conflicts occur, run `git -C "$HOME/Repos/pika" status`, stop, and ask me for help.

4) Sanity check + push
   - Show: `git -C "$HOME/Repos/pika" diff --stat origin/production...HEAD`
   - `git -C "$HOME/Repos/pika" push -u origin merge/main-to-production-YYYYMMDD`

5) Create PR with `gh pr create`
   - Title: `Merge main into production (YYYY-MM-DD)`
   - Body: Purpose is to deploy to Vercel production. Include summary of changes from diff stat.
   - Recommend merging with a **merge commit** (not squash).

6) Post-merge cleanup (tell me to run this after PR is merged)
   - `git -C "$HOME/Repos/pika" switch production`
   - `git -C "$HOME/Repos/pika" pull --ff-only origin production`
   - `git -C "$HOME/Repos/pika" branch -d merge/main-to-production-YYYYMMDD`
   - `git -C "$HOME/Repos/pika" push origin --delete merge/main-to-production-YYYYMMDD`
