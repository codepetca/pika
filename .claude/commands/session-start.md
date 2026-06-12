Start a new AI session: validate environment, load context, identify next task.

This command implements the `.ai/START-HERE.md` ritual as an automated checklist.

Rules:
- Resolve the current repo root with `git rev-parse --show-toplevel`.
- Stop if the resolved root is `$HOME/Repos/pika` for branch work.
- Stop and report clearly if any check fails.

Steps:

1) Verify worktree environment
   - Run: `git rev-parse --show-toplevel`
   - If it equals `$HOME/Repos/pika`: STOP — tell me to open or create a feature worktree first.
   - Ensure `.env.local` symlinks to `$HOME/Repos/.env/pika/.env.local`.
   - Run: `bash scripts/verify-env.sh`
   - If verify-env.sh fails: STOP — report the failure.
   - For report-only, docs-only, or review work, use `bash .codex/skills/pika-session-start/scripts/session_start.sh --orient-only` instead so startup stays read-only.

2) Recover recent context
   - Run: `git log --oneline -10`
   - Run: `git status -sb`
   - Read `.ai/CURRENT.md`.
   - Read `.ai/SESSION-LOG.md` only if recent handoff context is needed.
   - Summarize: current branch or detached HEAD state, last few commits, uncommitted changes.

3) Load documentation
   - Read in order:
     1. `.ai/START-HERE.md`
     2. `.ai/features.json`
     3. `docs/ai-instructions.md`
     4. Task-specific docs routed by `docs/ai-instructions.md`
   - Briefly confirm: current feature area being developed.

4) Check feature inventory
   - Run: `node scripts/features.mjs summary`
   - Run: `node scripts/features.mjs next`

5) Identify task
   - Priority: GitHub issue ($ARGUMENTS if given) → next failing feature → ask me.
   - If $ARGUMENTS has an issue number: `gh issue view $ARGUMENTS --json number,title,body,labels`
   - State the identified task clearly and propose an implementation approach.
   - Wait for my approval before writing any code.
