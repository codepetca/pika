STOP and re-read the workflow docs before continuing.

Steps:
1) Confirm worktree: `git rev-parse --show-toplevel` — must contain `.codex/worktrees/` (or `.claude/worktrees/`)
2) Read: `.ai/START-HERE.md`
3) Read: `docs/dev-workflow.md`

Key rules:
- Your session CWD is the worktree — use `git` and relative paths directly
- Never navigate to or work in `$HOME/Repos/pika` (the hub)
- Hub-level git operations: `git -C "$HOME/Repos/pika" <command>`

After reading, confirm:
1. What directory are you in (`git rev-parse --show-toplevel`)?
2. What branch are you on (`git branch --show-current`)?
3. What task are you working on?
