Commit staged/unstaged changes and create or update a PR.

This command operates on the current repo/worktree.

Rules:
- Run all commands directly.
- Never commit directly to `main` or `production`. If on these branches, stop and ask me to create a feature branch first.
- Never force-push.
- Generate commit message from diff using conventional commits format.

Steps:

1) Verify environment
   - Resolve the repo root with `git rev-parse --show-toplevel`.
   - If it equals `$HOME/Repos/pika` (hub), stop and ask me to create or open a worktree first.
   - Run: `git status -sb`, `git branch --show-current`
   - If `git branch --show-current` is empty, stop because detached HEAD is not safe for commit/push/PR flow.
   - If on `main` or `production`, stop and ask me to create a feature branch.
   - If no changes (staged or unstaged), stop and tell me.

2) Review changes
   - Run: `git diff --stat` and `git diff` to understand the changes.
   - Run: `git log --oneline -5` to understand commit message style.

3) Stage and commit
   - Stage all changes: `git add -A`
   - Generate a commit message from the diff using conventional commits (feat/fix/chore/docs/refactor/test).
   - Commit with the generated message using `git commit -m "..."`.
   - Include `Co-Authored-By: Claude <noreply@anthropic.com>` in the commit.

4) Push
   - If branch has no upstream, push with `git push -u origin <branch>`.
   - Otherwise, push with `git push`.

5) Create or update PR
   - Check if PR exists: `gh pr view --json url` (auto-detects repo from branch)
   - If PR exists: just show the PR URL (push already updated it).
   - If no PR exists: create one with `gh pr create`.
     - Title: derive from commit message or branch name.
     - Body: summarize the changes, include test plan checklist.
