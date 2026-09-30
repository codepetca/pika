# Pika session start

Run every session; use `.codex/prompts/session-start.md`.

Flow: local app/DB checks → main → production; staging retired. See `docs/dev-workflow.md`.

## Checklist

```
git rev-parse --show-toplevel # must be a feature worktree, not $HOME/Repos/pika
bash scripts/verify-env.sh
git status --short --branch
# Maintainer env: $HOME/Repos/.env/pika/.env.local; collaborator: cp .env.example .env.local
# Read .ai/CURRENT.md, docs/ai-instructions.md; run node scripts/features.mjs next
# Load routed task docs, then state task, model, risk, approach, and approval needs
```

Do not code if verification fails. For read-only work, run
`bash .codex/skills/pika-session-start/scripts/session_start.sh --orient-only`.

## Worktree Rules (MANDATORY)

- Use the resolved git root; never edit in the hub.
- Worktrees, `.env.local`, detached HEAD recovery, cleanup: `docs/dev-workflow.md`.
- Run hub operations as `git -C "$HOME/Repos/pika" ...`.

## End of Session (MANDATORY)

1. Append to `.ai/SESSION-LOG.md` with a valid ISO-date heading (`## YYYY-MM-DD ...`).
   Run `node scripts/trim-session-log.mjs` immediately;
   `--check` validates empty entries, heading dates, order, and the cap.
2. Update `.ai/features.json` with `node scripts/features.mjs pass|fail <id>`
   on evidence changes.
3. Publish only when authorized. After merge, resolve the registered worktree
   before removal (see `docs/dev-workflow.md`):
   ```bash
   HUB="$HOME/Repos/pika"; BRANCH="<branch-name>"
   WT_PATH="$(git -C "$HUB" worktree list --porcelain | awk -v branch="$BRANCH" '/^worktree /{p=substr($0,10)} /^branch refs\/heads\// && substr($0,19)==branch{print p; exit}')"
   ```

## Document Hierarchy

Authority/routing: `docs/ai-instructions.md`; UI: `DESIGN.md`.
