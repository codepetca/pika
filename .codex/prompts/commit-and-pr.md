Commit the current worktree changes and create or update the PR.

Use the bound-worktree rules from `docs/dev-workflow.md`. Task-specific safeguards:

- Never commit directly to `main` or `production`
- Never force-push
- Use a conventional-commit message derived from the diff

Steps:
1. Confirm the current branch and stop if it is `main` or `production`.
2. Review `git -C "$PIKA_WORKTREE" diff --stat`, `git -C "$PIKA_WORKTREE" diff`, and recent commit style.
3. Stage the intended files, generate a conventional-commit message, and commit.
4. Push the branch, setting upstream if needed.
5. If a PR already exists, report its URL. Otherwise create one with a concise summary and test plan.
