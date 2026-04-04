Commit staged/unstaged changes and create or update a PR.

Rules:
- Never commit directly to `main` or `production` — stop and ask for a feature branch first.
- Never force-push.
- Generate commit message from diff using conventional commits format.

Steps:

1) Verify environment
   - Confirm worktree: `git rev-parse --show-toplevel` (must contain `.codex/worktrees/` or `.claude/worktrees/`)
   - Run: `git status -sb`, `git branch --show-current`
   - If on `main` or `production`, stop and ask for a feature branch.
   - If no changes, stop and say so.

2) Review changes
   - Run: `git diff --stat` and `git diff` to understand the changes.
   - Run: `git log --oneline -5` to understand commit message style.

3) Stage and commit
   - Stage all changes: `git add -A`
   - Generate a commit message using conventional commits (feat/fix/chore/docs/refactor/test).
   - Commit: `git commit -m "..."` — include `Co-Authored-By: Claude <noreply@anthropic.com>`.

4) Push
   - No upstream: `git push -u origin <branch>`
   - Has upstream: `git push`

5) Create or update PR
   - Check if PR exists: `gh pr view --json url`
   - If PR exists: show the URL (push already updated it).
   - If no PR: `gh pr create` with title from commit and body summarising changes + test plan checklist.
