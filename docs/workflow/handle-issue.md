# Pika — GitHub Issue Workflow

Use the automated command for the full workflow:
- **Claude Code**: `/work-on-issue <N>`
- **Codex**: paste `.codex/prompts/work-on-issue.md`

## Quick Reference (if running manually)

1. `gh issue view <N> --json number,title,body,labels`
2. Read `docs/ai-instructions.md` + relevant core docs
3. Draft plan: branch name, files to change, tests to write first, migration needed?
4. **Wait for user approval** before writing any code
5. Create worktree: `issue/<N>-<slug>` (see `docs/dev-workflow.md`)
6. Follow TDD: tests first → implement → refactor
7. Create PR with "Closes #N"

## Critical Rules

- Write tests BEFORE implementation for core logic
- Make minimal, focused changes — do not modify unrelated files
- Follow the reading order to prevent drift
- Preserve existing patterns unless explicitly asked to change them
