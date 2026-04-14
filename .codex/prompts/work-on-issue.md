Load a GitHub issue, explore affected code, and draft a plan before coding.

Takes the issue number as $ARGUMENTS.

Steps:
1) `gh issue view $ARGUMENTS --json number,title,body,labels,assignees`
2) Read docs: `docs/ai-instructions.md`, relevant sections of `docs/core/architecture.md`
3) If the issue affects UI/UX, also read `docs/guidance/ui/README.md` and `docs/guidance/ui/stable.md`
4) Explore affected files (read only, no changes yet)
5) Draft plan: branch name, files to change, tests to write first, migration needed?
6) For UI/UX work, include a UI guidance declaration:
   - guidance read
   - stable guidance followed
   - experimental guidance introduced: yes/no
   - experimental draft file created or updated, if any
   - human promotion needed: yes/no
7) Present plan and wait for approval
8) After approval: set up worktree from hub (`export PIKA_WORKTREE="$HOME/Repos/pika"`)
   ```bash
   git -C "$HOME/Repos/pika" fetch origin
   git -C "$HOME/Repos/pika" worktree add "$HOME/Repos/.worktrees/pika/issue-$ARGUMENTS-<slug>" \
     -b "issue/$ARGUMENTS-<slug>" origin/main
   ```
   Then tell user: `pika codex issue-$ARGUMENTS-<slug>`

Default rule for UI/UX work:
- stable guidance is the default
- AI may create or update experimental guidance
- AI may add to legacy or open-question guidance when justified
- AI must not silently edit stable guidance during feature work
