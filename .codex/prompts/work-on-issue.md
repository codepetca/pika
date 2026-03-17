Load a GitHub issue, explore affected code, and draft a plan before coding.

Takes the issue number as $ARGUMENTS.

Steps:
1) `gh issue view $ARGUMENTS --json number,title,body,labels,assignees`
2) Read docs: `docs/ai-instructions.md`, relevant sections of `docs/core/architecture.md`
3) Explore affected files (read only, no changes yet)
4) Draft plan: branch name, files to change, tests to write first, migration needed?
5) Present plan and wait for approval
6) After approval: set up worktree from hub (`export PIKA_WORKTREE="$HOME/Repos/pika"`)
   ```bash
   git -C "$HOME/Repos/pika" fetch origin
   git -C "$HOME/Repos/pika" worktree add "$HOME/Repos/.worktrees/pika/issue-$ARGUMENTS-<slug>" \
     -b "issue/$ARGUMENTS-<slug>" origin/main
   ```
   Then tell user: `pika codex issue-$ARGUMENTS-<slug>`
