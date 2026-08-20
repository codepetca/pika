# Pika session start

Follow this at every AI session start. Automate with `/session-start` or
`.codex/prompts/session-start.md`.

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

- Resolve and use the git root consistently. Never edit in the hub checkout.
- Worktree creation, shared `.env.local`, detached HEAD recovery, and cleanup
  are canonical in `docs/dev-workflow.md`.
- Run hub operations as `git -C "$HOME/Repos/pika" ...`.

## End of Session (MANDATORY)

1. Append to `.ai/SESSION-LOG.md` with a valid ISO-date heading (`## YYYY-MM-DD ...`).
   Run `node scripts/trim-session-log.mjs` immediately;
   `--check` validates empty entries, heading dates, order, and the cap.
2. Update `.ai/features.json` with `node scripts/features.mjs pass|fail <id>`
   when evidence changes.
3. Publish only when authorized. After merge, resolve the registered worktree
   before removal (full procedure in `docs/dev-workflow.md`):
   ```bash
   HUB="$HOME/Repos/pika"; BRANCH="<branch-name>"
   WT_PATH="$(git -C "$HUB" worktree list --porcelain | awk -v branch="$BRANCH" '/^worktree /{p=substr($0,10)} /^branch refs\/heads\// && substr($0,19)==branch{print p; exit}')"
   ```

## Document Hierarchy

Trust: `.ai/features.json`, `.ai/CURRENT.md`,
`docs/core/architecture.md`, `docs/core/tests.md`, root `DESIGN.md`, then
`docs/core/project-context.md`, `docs/core/roadmap.md`,
`docs/core/decision-log.md`, session log, then journal archive.
