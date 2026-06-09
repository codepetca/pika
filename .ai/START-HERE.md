# Pika — AI Agent Starting Ritual

**CRITICAL:** Follow this at the start of **every** AI session.

**Automated:** `/session-start` or `.codex/prompts/session-start.md`.

---

## Quick Checklist

```
[ ] Resolve repo root: git rev-parse --show-toplevel
[ ] Verify repo root is a feature worktree, not $HOME/Repos/pika for branch work
[ ] Ensure .env.local symlinks to $HOME/Repos/.env/pika/.env.local
[ ] Run: bash scripts/verify-env.sh
[ ] Check status: git status --short --branch
[ ] Read: .ai/CURRENT.md
[ ] Read: docs/ai-instructions.md
[ ] Check features: node scripts/features.mjs next
[ ] Load task-specific docs routed by docs/ai-instructions.md
[ ] Plan before coding: task, model, approach, approval
```

Do not code if verification fails. Read `.ai/SESSION-LOG.md` only for recent handoff context; `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

---

## Worktree Rules (MANDATORY)

All agents operate from exactly one current repo checkout/worktree.

- Resolve the repo root with `git rev-parse --show-toplevel` before acting.
- Use that resolved root consistently for git commands and file paths.
- Never do branch work in `$HOME/Repos/pika/` (the hub).
- If the current root is the hub and the task needs edits, create or open a dedicated worktree first.
- Worktree creation, cleanup, and shared `.env.local` setup live in `docs/dev-workflow.md`.
- Hub-level git commands for adding/removing worktrees must use `git -C "$HOME/Repos/pika" ...`.

---

## End of Session (MANDATORY)

1. Append a concise session entry to `.ai/SESSION-LOG.md`.
2. Immediately run `node scripts/trim-session-log.mjs` in the same change. CI caps the log at 60; default trim keeps 40. Use `node scripts/trim-session-log.mjs --check` to verify the cap.
3. Update `.ai/features.json` if anything changed:
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

---

## Document Hierarchy (When Conflicts Arise)

Trust in order: `.ai/features.json`, `.ai/CURRENT.md`, core docs
(`architecture`, `tests`, `design`, `project-context`, `roadmap`,
`decision-log`), `.ai/SESSION-LOG.md` on demand, then
`.ai/JOURNAL-ARCHIVE.md` only for historical investigation.
