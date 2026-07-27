Focus: PR #952 is rebased; Pal owns migration 111 and Blueprint is 112. Shared
local still maps an earlier Blueprint draft to 111; do not push, reset, or
repair it without separate explicit authorization.

## Current Context

- `DESIGN.md` is canonical; product status: `.ai/features.json`.
- Pal remains disabled; its widget package is an external dependency.
- Worktrees: `$HOME/.codex/worktrees/pika/` or
  `$HOME/.codex/worktrees/<id>/pika`; maintainer env:
  `$HOME/Repos/.env/pika/.env.local`; collaborators may copy `.env.example`.
- Toronto deadlines, server logic, `withErrorHandler`, semantic tokens, and
  human-controlled migrations are invariants. Workflow: `docs/dev-workflow.md`.
- Trim session logs after updates. `production` uses the protected PR flow.
