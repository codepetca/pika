# Pika AI Start

Follow this at the start of every AI session.

Shortcut: run `/session-start` or paste `.codex/prompts/session-start.md`.

---

## Quick Checklist

```
[ ] Verify worktree: echo $PIKA_WORKTREE (must not be $HOME/Repos/pika)
[ ] Run: bash "$PIKA_WORKTREE/scripts/verify-env.sh"
[ ] Check status: git -C "$PIKA_WORKTREE" status
[ ] Read: .ai/CURRENT.md
[ ] Read: docs/ai-instructions.md
[ ] Check features: node "$PIKA_WORKTREE/scripts/features.mjs" next
[ ] Load task-specific docs routed by docs/ai-instructions.md
[ ] Plan before coding: state task, propose approach, wait for approval
```

Do not code if verification fails. Read `.ai/SESSION-LOG.md` only for recent handoff context; `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.

---

## Worktree Rules

Agents are bound to one worktree via `$PIKA_WORKTREE`.

- Never assume shell cwd.
- Git commands must use: `git -C "$PIKA_WORKTREE"`.
- File paths must be absolute or prefixed with `$PIKA_WORKTREE`.
- Never do branch work in `$HOME/Repos/pika/` (the hub).
- Worktree/shared `.env.local` setup lives in `docs/dev-workflow.md`.
- For hub-level worktree commands: `export PIKA_WORKTREE="$HOME/Repos/pika"`

---

## End Of Session

1. Append a concise session entry to `$PIKA_WORKTREE/.ai/SESSION-LOG.md`.
2. Run `node "$PIKA_WORKTREE/scripts/trim-session-log.mjs"`.
3. Update `.ai/features.json` if anything changed:
   ```bash
   node "$PIKA_WORKTREE/scripts/features.mjs" pass <feature-id>
   node "$PIKA_WORKTREE/scripts/features.mjs" fail <feature-id>
   ```
4. Commit and push the session log + feature changes.
5. If merged, clean up:
   ```bash
   export PIKA_WORKTREE="$HOME/Repos/pika"
   git -C "$PIKA_WORKTREE" fetch origin
   git -C "$PIKA_WORKTREE" merge --ff-only origin/main
   git -C "$PIKA_WORKTREE" worktree remove "$HOME/Repos/.worktrees/pika/<branch-name>"
   git -C "$PIKA_WORKTREE" branch -D <branch-name>
   ```

---

## Source Order

Trust in this order:
1. `.ai/features.json`
2. `.ai/CURRENT.md`
3. `docs/core/architecture.md`
4. `docs/core/tests.md`
5. `docs/core/design.md`
6. `docs/core/project-context.md`
7. `docs/core/roadmap.md`
8. `docs/core/decision-log.md`
9. `.ai/SESSION-LOG.md`
10. `.ai/JOURNAL-ARCHIVE.md`
