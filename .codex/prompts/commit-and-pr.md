Commit the current worktree changes and create or update the PR.

Use the dedicated-worktree rules from `docs/dev-workflow.md`. Task-specific safeguards:

- Never commit directly to `main` or `production`
- Never force-push
- Use a conventional-commit message derived from the diff

Steps:
1. Confirm the current branch. If `git branch --show-current` is empty, stop because detached HEAD is not safe for commit/push/PR flow. Stop if the branch is `main` or `production`.
2. Review `git diff --stat`, `git diff`, and recent commit style.
3. Stage the intended files, generate a conventional-commit message, and commit.
4. Push the branch, setting upstream if needed.
5. If a PR already exists, report its URL. Otherwise create one with a concise summary and test plan.
