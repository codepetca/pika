# Pika — Issue Worker Protocol

Use this protocol whenever instructed to work on a GitHub issue.

## 1) Fetch the Issue
```bash
gh issue view <number> --json number,title,body,labels,comments
```

## 2) Load Context (MANDATORY)
1. Read `.ai/START-HERE.md`
2. Read `.ai/CURRENT.md`
3. Read `docs/ai-instructions.md` and load only the task-specific docs it routes you to.
3. Check `.ai/features.json` for any referenced feature IDs.
4. If the issue affects UI/UX, read `docs/guidance/ui/README.md` and `docs/guidance/ui/stable.md`.
5. If the issue affects teacher assignments, teacher quizzes, or teacher tests, also read `docs/guidance/ui/teacher-work-surfaces.md` and `docs/guidance/ui/audit-teacher-work-surfaces.md`.

## 3) Branch & PR Setup
- Create or bind a dedicated worktree using `docs/dev-workflow.md`.
- Prefer a draft PR early; include `Closes #<number>` in the body.

## 4) Plan Before Coding (MANDATORY)
Produce a short plan:
- Files to change/add
- Approach and edge cases
- Testing plan (`pnpm test` + targeted tests)

If the issue affects UI/UX, add a **UI guidance declaration**:
- guidance read
- stable guidance followed
- teacher work-surface canon followed: yes/no/not-applicable
- experimental guidance introduced: yes/no
- experimental draft file created or updated, if any
- human promotion needed: yes/no

Do not proceed until the user approves the plan.

## 5) Execute With Constraints
- Keep changes small and focused.
- Use TDD for core logic (`docs/core/tests.md`).
- Preserve security patterns (sessions, role checks, Supabase usage).
- Keep business logic out of UI components.
- Do not add dependencies without explicit approval.
- Stable UI guidance is the default for new UI work.
- AI may create or update experimental UI guidance entries when a new pattern is introduced.
- AI may add to legacy or open-question guidance when clearly justified.
- AI must not silently edit stable UI guidance as part of ordinary feature work.

## 6) AI UI Verification (MANDATORY for UI Changes)
- Use `docs/guides/ai-ui-testing.md` or `.codex/prompts/ui-verify.md`.
- Check the affected teacher and student views when both roles are impacted.
- Iterate on the UI until the verified screenshots are acceptable.

## 7) Update AI Continuity Layer
Before ending a session:
- Append to `.ai/JOURNAL.md` (append-only).
- Update `.ai/features.json` if feature status changed:
  ```bash
  node scripts/features.mjs pass <feature-id>
  node scripts/features.mjs fail <feature-id>
  ```

## 8) Validation
- Run: `pnpm test`
- If relevant: `pnpm lint`, `pnpm build`
- Confirm acceptance criteria are met and documented in the PR.
- If you grep for path conventions, exclude `.ai/JOURNAL.md` (append-only).
  Example: `rg -n "\\$HOME/repos/|/Users/stew/" --glob "!**/.ai/JOURNAL.md" docs/ .ai/ scripts/`
