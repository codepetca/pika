Help me merge `main` into `production` via a PR branch.
(Vercel production deploys from `production`.)

Rules:
- I may be in a git worktree — verify repo/worktree first.
- Do NOT run commands; output copy-pasteable commands only.
- Never force-push.
- Never rewrite `main` or `production`.
- If conflicts occur, stop and give minimal resolution steps.

Return a short checklist with commands.

1) Verify repo / worktree
```bash
pwd
git rev-parse --show-toplevel
git worktree list
git remote -v
git status -sb
git branch --show-current
```
If the repo root or `origin` looks wrong, stop and tell me what to fix.

2) Update branches
```bash
git fetch --all --prune
git switch main
git pull --ff-only origin main
git switch production
git pull --ff-only origin production
```

3) Create PR branch + merge
Branch name: `merge/main-to-production-YYYYMMDD`
```bash
git switch production
git switch -c merge/main-to-production-YYYYMMDD
git merge --no-ff main
```
If conflicts:
```bash
git status
# resolve conflicts
git add -A
git commit
```

4) Sanity check + push
```bash
git diff --stat origin/production...HEAD
git push -u origin merge/main-to-production-YYYYMMDD
```

5) Provide PR text
Title:
`Merge main into production (YYYY-MM-DD)`

Body:
- Purpose: deploy to Vercel production
- Summary of changes (`git diff --stat`)
- Verification run (tests/build if applicable)

Recommend merging with a **merge commit** (not squash).

6) Post-merge cleanup (after PR is merged)
```bash
git switch production
git pull --ff-only origin production
git branch -d merge/main-to-production-YYYYMMDD
git push origin --delete merge/main-to-production-YYYYMMDD
```
