# Pika — AI Agent Starting Ritual

**CRITICAL:** Follow this checklist at the start of **every** AI session.

---

## Quick Checklist

```
[ ] Confirm worktree: git rev-parse --show-toplevel  (must contain .claude/worktrees/)
[ ] Run: bash scripts/verify-env.sh
[ ] Check recent sessions: cat .ai/SESSION-LOG.md
[ ] Check status: git status
[ ] Read: docs/ai-instructions.md (then follow its reading order)
[ ] Identify task: GitHub issue, features.json, or ask user
[ ] Plan before coding: state task, propose approach, wait for approval
```

Do not start coding if verification fails.

---

## Worktree Rule (MANDATORY)

Your session is bound to the worktree directory it was opened in. **Never navigate up to `$HOME/Repos/pika`** (the hub) and work there. If you need hub-level git operations (worktree add/remove, branch cleanup), use `git -C "$HOME/Repos/pika" <command>`.

If `.env.local` is missing: `bash scripts/setup-worktree.sh`

---

## End of Session (MANDATORY)

1. Append a session entry to `.ai/SESSION-LOG.md`, then trim:
   ```bash
   node scripts/trim-session-log.mjs
   ```
2. Update `.ai/features.json` if anything changed:
   ```bash
   node scripts/features.mjs pass <feature-id>
   node scripts/features.mjs fail <feature-id>
   ```
3. Commit and push the session log + feature changes.

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
8. `.ai/SESSION-LOG.md` — recent session context
