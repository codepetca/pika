Load a GitHub issue, set up a worktree, and prepare a plan before coding.

Takes the issue number as $ARGUMENTS (e.g. `382`).

This command operates on the current repo/worktree.

Rules:
- Resolve the current repo root with `git rev-parse --show-toplevel`.
- Use the hub path only for creating a new worktree.
- Plan before coding — wait for my approval before writing any files.

Steps:

1) Load the issue
   - Run: `gh issue view $ARGUMENTS --json number,title,body,labels,assignees,milestone`
   - Read and summarize: title, description, acceptance criteria, affected areas.

2) Read relevant docs
   - `docs/ai-instructions.md` (if not already read this session)
   - `docs/core/architecture.md` (relevant sections)
   - Any guidance doc under `docs/guidance/` related to the issue.

3) Explore affected code
   - Identify which files will likely change (API routes, components, lib utilities, tests).
   - Read those files to understand current state.
   - Note: do NOT modify anything yet.

4) Draft a branch name and plan
   - Branch name: `issue/<number>-<kebab-slug>` (e.g. `issue/382-fix-gradebook-cache`)
   - Plan:
     - What is the root cause / goal?
     - What files will change and how?
     - What tests will you write first (TDD)?
     - Any migration required? (NEVER apply migrations — human does this)
     - Any UI changes? (will need /ui-verify after)

5) Present plan and wait for approval
   - Show the plan clearly.
   - Do NOT start writing code until I confirm.

6) After approval: set up worktree (if not already on correct branch)
   ```bash
   HUB="$HOME/Repos/pika"
   git -C "$HUB" fetch origin
   git -C "$HUB" worktree add "$HOME/.codex/worktrees/pika/issue-$ARGUMENTS-<slug>" -b "issue/$ARGUMENTS-<slug>" origin/main
   ```
   Then open the new worktree before editing.
