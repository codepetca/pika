Commit staged/unstaged changes and create or update a PR.

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Rules:
- Run all commands directly.
- ALL git commands MUST use: `git -C "$PIKA_WORKTREE"`
- Never commit directly to `main` or `production`. If on these branches, stop and ask me to create a feature branch first.
- Never force-push.
- Generate commit message from diff using conventional commits format.

Steps:

1) Verify environment
   - Verify `$PIKA_WORKTREE` is set: `echo $PIKA_WORKTREE`
   - If not set or equals `$HOME/Repos/pika` (hub), stop and tell me to bind a worktree first (`pika claude <worktree>`).
   - Run: `git -C "$PIKA_WORKTREE" status -sb`, `git -C "$PIKA_WORKTREE" branch --show-current`
   - If on `main` or `production`, stop and ask me to create a feature branch.
   - If no changes (staged or unstaged), stop and tell me.

2) Review changes
   - Run: `git -C "$PIKA_WORKTREE" diff --stat` and `git -C "$PIKA_WORKTREE" diff` to understand the changes.
   - Run: `git -C "$PIKA_WORKTREE" log --oneline -5` to understand commit message style.

3) Stage and commit
   - Stage all changes: `git -C "$PIKA_WORKTREE" add -A`
   - Generate a commit message from the diff using conventional commits (feat/fix/chore/docs/refactor/test).
   - Commit with the generated message using `git -C "$PIKA_WORKTREE" commit -m "..."`.
   - Include `Co-Authored-By: Claude <noreply@anthropic.com>` in the commit.

4) Push
   - If branch has no upstream, push with `git -C "$PIKA_WORKTREE" push -u origin <branch>`.
   - Otherwise, push with `git -C "$PIKA_WORKTREE" push`.

5) Create or update PR
   - Check if PR exists: `gh pr view --json url` (auto-detects repo from branch)
   - If PR exists: just show the PR URL (push already updated it).
   - If no PR exists: create one with `gh pr create`.
     - Title: derive from commit message or branch name.
     - Body: summarize the changes, include test plan checklist.
