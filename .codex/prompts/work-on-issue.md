Load a GitHub issue, inspect affected code, and draft a plan before coding.

Assume the startup context from `.ai/START-HERE.md` is already loaded. If not, run `/session-start` first.

Steps:
1. Run `gh issue view $ARGUMENTS --json number,title,body,labels,assignees`.
2. Read `docs/workflow/handle-issue.md` plus the task-specific docs selected by `docs/ai-instructions.md`.
   - For UI work, include a UI guidance declaration.
   - Record: stable guidance followed
   - Record: experimental guidance introduced: yes/no
   - Record: human promotion needed: yes/no
3. Inspect the affected files and the nearest tests without editing anything yet.
4. Draft the plan: worktree or branch name, files to change, tests to write first, and whether a migration file is needed.
5. Present the plan and wait for approval.
6. After approval, create or bind the worktree using `docs/dev-workflow.md`, then continue the work from that bound worktree.
