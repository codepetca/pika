# Pika session start

Follow this at every AI session start. Automate with `/session-start` or
`.codex/prompts/session-start.md`.

## Quick Checklist

```
Resolve repo root: git rev-parse --show-toplevel
Verify feature worktree; do not branch in $HOME/Repos/pika
Ensure .env.local exists (shared: $HOME/Repos/.env/pika/.env.local; collaborator: cp .env.example .env.local)
Run: bash scripts/verify-env.sh
Check: git status --short --branch
Read: .ai/CURRENT.md and docs/ai-instructions.md
Check: node scripts/features.mjs next
Load task docs routed by docs/ai-instructions.md
Plan: task, model, approach, approval
```

Do not code if verification fails. Session log is for recent handoff; journal archive is historical only.
For docs-only or review work, use `bash .codex/skills/pika-session-start/scripts/session_start.sh --orient-only`.

## Worktree Rules (MANDATORY)

- Resolve the repo root with `git rev-parse --show-toplevel` before acting.
- Use that resolved root consistently for git commands and file paths.
- Never do branch work in `$HOME/Repos/pika/` (the hub).
- If the current root is the hub and the task needs edits, create or open a dedicated worktree first.
- Worktree creation, cleanup, and shared `.env.local` setup live in `docs/dev-workflow.md`.
- Hub-level git commands for adding/removing worktrees must use `git -C "$HOME/Repos/pika" ...`.

## End of Session (MANDATORY)

1. Append to `.ai/SESSION-LOG.md` with a valid ISO-date heading (`## YYYY-MM-DD ...`).
2. Immediately run `node scripts/trim-session-log.mjs` in the same change. CI caps the log at 60; default trim keeps 40. Use `node scripts/trim-session-log.mjs --check` for empty entries, heading dates, order, and the cap.
3. Update `.ai/features.json` when needed:
   ```bash
   node scripts/features.mjs pass <feature-id>
   node scripts/features.mjs fail <feature-id>
   ```
4. Commit and push the session log + feature changes.
5. If work was merged, clean up:
   ```bash
   HUB="$HOME/Repos/pika"
   BRANCH="<branch-name>"
   git -C "$HUB" fetch origin
   git -C "$HUB" merge --ff-only origin/main
   WT_PATH="$(git -C "$HUB" worktree list --porcelain | awk -v branch="$BRANCH" '/^worktree /{p=substr($0,10)} /^branch refs\/heads\// && substr($0,19)==branch{print p; exit}')"
   [ -z "$WT_PATH" ] || git -C "$HUB" worktree remove "$WT_PATH"
   git -C "$HUB" branch -D "$BRANCH"
   ```

## Document Hierarchy

Trust: `.ai/features.json`, `.ai/CURRENT.md`,
`docs/core/architecture.md`, `docs/core/tests.md`, root `DESIGN.md`, then
`docs/core/project-context.md`, `docs/core/roadmap.md`,
`docs/core/decision-log.md`, session log, then journal archive.
