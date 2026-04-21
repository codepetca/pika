# Pika — GitHub Issue Workflow

Use the automated command for the full workflow:
- **Claude Code**: `/work-on-issue <N>`
- **Codex**: paste `.codex/prompts/work-on-issue.md`

## Quick Reference (if running manually)

1. `gh issue view <N> --json number,title,body,labels`
2. Read `.ai/START-HERE.md`, `.ai/CURRENT.md`, and `docs/ai-instructions.md`
3. If the issue touches UI/UX, also read `docs/guidance/ui/README.md` and `docs/guidance/ui/stable.md`
4. If the issue touches teacher assignments, teacher quizzes, or teacher tests, also read `docs/guidance/ui/teacher-work-surfaces.md` and `docs/guidance/ui/audit-teacher-work-surfaces.md`
5. Draft plan: branch name, files to change, tests to write first, migration needed?
6. For UI/UX work, include a UI guidance declaration:
   - guidance read
   - stable guidance followed
   - teacher work-surface canon followed: yes/no/not-applicable
   - experimental guidance introduced: yes/no
   - experimental draft file created/updated, if any
   - human promotion needed: yes/no
7. **Wait for user approval** before writing any code
8. Create worktree: `issue/<N>-<slug>` (see `docs/dev-workflow.md`)
9. Follow TDD: tests first → implement → refactor
10. Create PR with "Closes #N"

## Critical Rules

- Write tests BEFORE implementation for core logic
- Make minimal, focused changes — do not modify unrelated files
- Follow the routed doc-loading flow in `docs/ai-instructions.md`
- Preserve existing patterns unless explicitly asked to change them
- Stable UI guidance is the default for new UI work
- AI may draft experimental UI guidance, but may not silently edit stable UI guidance during feature work
