Load a GitHub issue, explore affected code, and draft a plan before coding.

Takes the issue number as $ARGUMENTS.

Steps:
1) Fetch issue: `gh issue view $ARGUMENTS --json number,title,body,labels,assignees`
2) Read docs: `docs/ai-instructions.md`, relevant sections of `docs/core/architecture.md`
3) Explore affected files (read only — no changes yet)
4) Draft plan:
   - Branch name: `issue/$ARGUMENTS-<short-slug>`
   - Files to change
   - Tests to write first
   - Migration needed?
5) Present plan and wait for approval.
6) After approval, create a worktree from the hub:
   ```bash
   REPO="$HOME/Repos/pika"
   git -C "$REPO" fetch origin
   git -C "$REPO" worktree add \
     "$REPO/.codex/worktrees/issue-$ARGUMENTS-<slug>" \
     -b "issue/$ARGUMENTS-<slug>" origin/main
   cd "$REPO/.codex/worktrees/issue-$ARGUMENTS-<slug>"
   bash scripts/setup-worktree.sh
   ```
7) Open the new worktree in Codex/Claude and begin implementation.
