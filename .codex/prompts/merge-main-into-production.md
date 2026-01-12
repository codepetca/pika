Merge `main` into `production` via a PR branch.
(Vercel production deploys from `production`.)

Rules:
- Run all commands directly (do not output copy-pasteable commands).
- I may be in a git worktree — verify repo/worktree first.
- Never force-push.
- Never rewrite `main` or `production`.
- If conflicts occur, stop and ask for help resolving them.

Steps:

1) Verify repo / worktree
   - Run: `pwd`, `git rev-parse --show-toplevel`, `git worktree list`, `git remote -v`, `git status -sb`, `git branch --show-current`
   - If the repo root or `origin` looks wrong, stop and tell me what to fix.

2) Update branches
   - `git fetch --all --prune`
   - `git switch main && git pull --ff-only origin main`
   - `git switch production && git pull --ff-only origin production`

3) Create PR branch + merge
   - Branch name: `merge/main-to-production-YYYYMMDD` (use today's date)
   - `git switch production`
   - `git switch -c merge/main-to-production-YYYYMMDD`
   - `git merge --no-ff main`
   - If conflicts occur, run `git status`, stop, and ask me for help.

4) Sanity check + push
   - Show: `git diff --stat origin/production...HEAD`
   - `git push -u origin merge/main-to-production-YYYYMMDD`

5) Create PR with `gh pr create`
   - Title: `Merge main into production (YYYY-MM-DD)`
   - Body: Purpose is to deploy to Vercel production. Include summary of changes from diff stat.
   - Recommend merging with a **merge commit** (not squash).

6) Post-merge cleanup (tell me to run this after PR is merged)
   - `git switch production`
   - `git pull --ff-only origin production`
   - `git branch -d merge/main-to-production-YYYYMMDD`
   - `git push origin --delete merge/main-to-production-YYYYMMDD`
