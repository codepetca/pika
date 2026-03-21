# Pika — AI Agent Starting Ritual

**CRITICAL:** Follow this checklist at the start of **every** AI session.

**Automated alternative:** Run `/session-start` (Claude Code) or paste `.codex/prompts/session-start.md` (Codex).

---

## Quick Checklist

```
[ ] Verify worktree: echo $PIKA_WORKTREE (must NOT be $HOME/Repos/pika)
[ ] Run: bash "$PIKA_WORKTREE/scripts/verify-env.sh"
[ ] Check journal: tail -40 "$PIKA_WORKTREE/.ai/JOURNAL.md"
[ ] Check status: git -C "$PIKA_WORKTREE" status
[ ] Read: docs/ai-instructions.md (then follow its reading order)
[ ] Identify task: GitHub issue, features.json, or ask user
[ ] Plan before coding: state task, propose approach, wait for approval
```

Do not start coding if verification fails.

---

## Worktree Rules (MANDATORY)

All agents are bound to exactly ONE worktree via `$PIKA_WORKTREE`.

- NEVER assume the shell cwd.
- ALL git commands MUST use: `git -C "$PIKA_WORKTREE"`.
- ALL file paths MUST be absolute or prefixed with `$PIKA_WORKTREE`.
- Never do branch work in `$HOME/Repos/pika/` (the hub). Use worktrees under `$HOME/Repos/.worktrees/pika/`.
- For hub-level git commands (add/remove worktrees): `export PIKA_WORKTREE="$HOME/Repos/pika"`
- Creating worktrees: see `docs/dev-workflow.md`

---

## End of Session (MANDATORY)

1. Append a session entry to `$PIKA_WORKTREE/.ai/JOURNAL.md`.
2. Update `.ai/features.json` if anything changed:
   ```bash
   node "$PIKA_WORKTREE/scripts/features.mjs" pass <feature-id>
   node "$PIKA_WORKTREE/scripts/features.mjs" fail <feature-id>
   ```
3. Commit and push the journal + feature changes.
4. If work was merged, clean up:
   ```bash
   export PIKA_WORKTREE="$HOME/Repos/pika"
   git -C "$PIKA_WORKTREE" worktree remove "$HOME/Repos/.worktrees/pika/<branch-name>"
   git -C "$PIKA_WORKTREE" branch -D <branch-name>
   ```

---

## Document Hierarchy (When Conflicts Arise)

Trust in this order:
1. `.ai/features.json` — status authority
2. `docs/core/architecture.md` — architecture and invariants
3. `docs/core/tests.md` — testing requirements
4. `docs/core/design.md` — UI/UX rules
5. `docs/core/project-context.md` — setup and commands
6. `docs/core/roadmap.md` — phase strategy
7. `docs/core/decision-log.md` — historical rationale
8. `.ai/JOURNAL.md` — session history
