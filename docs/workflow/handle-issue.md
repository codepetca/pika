# Pika — GitHub Issue Workflow (Quick Pointer)

When the user says "work on issue #X", follow this sequence:

## 1. Fetch the GitHub Issue

```bash
gh issue view X --json number,title,body,labels
```

## 2. Read Required Documentation

1. Read `/.ai/START-HERE.md`
2. Read `docs/ai-instructions.md` and follow its required reading order
3. Follow `docs/issue-worker.md` (full protocol)

## 3. Summarize the Plan

Create a 5-10 bullet point summary covering:
- What will be implemented
- Which files will be modified/created
- Testing approach (TDD: write tests first!)
- Estimated complexity

## 4. Ask Clarifying Questions (if needed)

Ask **ONE** clarifying question only if absolutely necessary. Prefer making reasonable decisions.

## 5. Wait for Confirmation

Do not proceed with implementation until the user confirms the plan.

## 6. Implement Using TDD

After confirmation:

a. **Create a worktree (MANDATORY)**:

Use a dedicated worktree for the issue branch (see `docs/dev-workflow.md`).

Example (from the hub checkout `pika/`):

```bash
export PIKA_WORKTREE="$HOME/Repos/pika"
git -C "$PIKA_WORKTREE" fetch origin
git -C "$PIKA_WORKTREE" worktree add -b issue/X-<slug> $HOME/Repos/.worktrees/pika/issue-X-<slug> origin/main
pika claude issue-X-<slug>
```

b. **Follow TDD workflow**:
   - Write tests FIRST for core logic (utilities, business rules)
   - Implement the minimal code to pass tests
   - Refactor for clarity
   - For UI: keep views thin, test through underlying logic

c. **Adhere to architecture rules**:
   - Maintain pure functions for testability
   - Follow timezone handling rules (America/Toronto)
   - Preserve security patterns (hashing, rate limiting)
   - Keep UI minimal and mobile-first

d. **Update tests**:
   - Add/update unit tests for utilities
   - Add component tests where appropriate
   - Ensure existing tests still pass

e. **Produce git diff**:
   - Show clear, focused changes
   - No unrelated modifications

f. **Suggest commit message**:
   - Follow conventional commits format
   - Reference issue number

g. **Provide PR description**:
   - Include "Closes #X"
   - Summarize changes
   - List testing performed

## 7. Ask About Git Execution

Ask if git commands should be executed or if the user will handle them.

---

## Critical Rules

- **Do not modify unrelated files** or design/architecture unless required by the issue
- **Write tests BEFORE implementation** for core logic
- **Make minimal, focused changes**
- **Follow the reading order** to prevent drift
- **Preserve existing patterns** unless explicitly asked to change them
