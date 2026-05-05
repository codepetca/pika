# Pika — AI Agent Starting Ritual

**CRITICAL:** Follow this checklist at the start of **every** AI session.

**Automated alternative:** Run `/session-start` (Claude Code) or paste `.codex/prompts/session-start.md` (Codex).

---

## Quick Checklist

```
[ ] Verify worktree: echo $PIKA_WORKTREE (must NOT be $HOME/Repos/pika)
[ ] Run: bash "$PIKA_WORKTREE/scripts/verify-env.sh"
[ ] Check status: git -C "$PIKA_WORKTREE" status
[ ] Read: .ai/CURRENT.md
[ ] Read: docs/ai-instructions.md
[ ] Check features: node "$PIKA_WORKTREE/scripts/features.mjs" next
[ ] Load task-specific docs routed by docs/ai-instructions.md
[ ] Plan before coding: state task, propose approach, wait for approval
```

Do not start coding if verification fails.
Read `.ai/SESSION-LOG.md` only for recent handoff context; `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

---

## Worktree Rules (MANDATORY)

All agents are bound to exactly ONE worktree via `$PIKA_WORKTREE`.

- NEVER assume the shell cwd.
- ALL git commands MUST use: `git -C "$PIKA_WORKTREE"`.
- ALL file paths MUST be absolute or prefixed with `$PIKA_WORKTREE`.
- Never do branch work in `$HOME/Repos/pika/` (the hub).
- Worktree creation, cleanup, and shared `.env.local` setup live in `docs/dev-workflow.md`.
- For hub-level git commands (add/remove worktrees): `export PIKA_WORKTREE="$HOME/Repos/pika"`

---

## End of Session (MANDATORY)

1. Append a concise session entry to `$PIKA_WORKTREE/.ai/SESSION-LOG.md`.
2. Run `node "$PIKA_WORKTREE/scripts/trim-session-log.mjs"` to keep only the latest 20 entries.
3. Update `.ai/features.json` if anything changed:
   ```bash
   node "$PIKA_WORKTREE/scripts/features.mjs" pass <feature-id>
   node "$PIKA_WORKTREE/scripts/features.mjs" fail <feature-id>
   ```
4. Commit and push the session log + feature changes.
5. If work was merged, clean up:
   ```bash
   export PIKA_WORKTREE="$HOME/Repos/pika"
   git -C "$PIKA_WORKTREE" fetch origin
   git -C "$PIKA_WORKTREE" merge --ff-only origin/main
   git -C "$PIKA_WORKTREE" worktree remove "$HOME/Repos/.worktrees/pika/<branch-name>"
   git -C "$PIKA_WORKTREE" branch -D <branch-name>
   ```

---

## Document Hierarchy (When Conflicts Arise)

Trust in this order:
1. `.ai/features.json` — status authority
2. `.ai/CURRENT.md` — compact current-state context
3. `docs/core/architecture.md` — architecture and invariants
4. `docs/core/tests.md` — testing requirements
5. `docs/core/design.md` — UI/UX rules
6. `docs/core/project-context.md` — setup and commands
7. `docs/core/roadmap.md` — phase strategy
8. `docs/core/decision-log.md` — historical rationale
9. `.ai/SESSION-LOG.md` — recent handoff history (on demand)
10. `.ai/JOURNAL-ARCHIVE.md` — historical investigation only
