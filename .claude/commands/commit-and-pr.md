Complete staged/unstaged changes through Pika's automatic draft-first PR lifecycle.

This command operates on the current repo/worktree.

Rules:
- Run all commands directly.
- Never commit directly to `main` or `production`. If on these branches, stop and ask me to create a feature branch first.
- Never force-push.
- Generate commit message from diff using conventional commits format.
- Keep the PR draft until independent review and batched remediation are complete.
- Mark ready only when the reviewed head SHA is stable.

Steps:

1) Verify environment
   - Resolve the repo root with `git rev-parse --show-toplevel`.
   - If it equals `$HOME/Repos/pika` (hub), stop and ask me to create or open a worktree first.
   - Run: `git status -sb`, `git branch --show-current`
   - If `git branch --show-current` is empty, stop because detached HEAD is not safe for commit/push/PR flow.
   - If on `main` or `production`, stop and ask me to create a feature branch.
   - If no changes (staged or unstaged), stop and tell me.

2) Review changes
   - Run: `git diff --stat` and `git diff` to understand the changes.
   - Run: `git log --oneline -5` to understand commit message style.
   - Run: `pnpm check:focused -- --base origin/main` plus every routed feature-specific check.

3) Stage and commit
   - Stage all changes: `git add -A`
   - Generate a commit message from the diff using conventional commits (feat/fix/chore/docs/refactor/test).
   - Commit with the generated message using `git commit -m "..."`.
   - Include `Co-Authored-By: Claude <noreply@anthropic.com>` in the commit.

4) Push
   - If branch has no upstream, push with `git push -u origin <branch>`.
   - Otherwise, push with `git push`.

5) Create or update a draft PR
   - Check if PR exists: `gh pr view --json url` (auto-detects repo from branch)
   - If an existing PR is ready but review or fixes remain, run `gh pr ready --undo` before pushing changes.
   - If no PR exists: create one with `gh pr create --draft`.
     - Title: derive from commit message or branch name.
     - Body: summarize the changes, include test plan checklist.

6) Review and batch remediation
   - Run the smallest risk-appropriate independent review wave on the complete diff.
   - Validate findings and fix accepted blockers together; do not push one commit per finding.
   - Run affected local checks, commit and push the batch while the PR remains draft, and use targeted re-review.
   - Complete any required final cumulative review and record the reviewed head SHA.

7) Request CI and finish
   - Run `gh pr ready` only after the reviewed SHA is stable.
   - Wait for `PR Gate` on that exact SHA.
   - If CI fails, return the PR to draft before pushing a correction, then repeat only targeted review/checks.
   - Merge only when `PR Gate`, review, conflict, sensitive-data, and authority gates all pass.

Lifecycle measurement is automatic for AI-authored development PRs. Once the PR
number exists, record the tracking-start (`started`), `implementation`, and
`draft-created` events with
`pnpm record:ai-pr-lifecycle event --pr <PR> --event <stage>`. Record
`independent-review`, each batched `remediation`, `ready-for-ci`, the final CI
result (with separately observed queue/run seconds), and `merged`. Add active
time and token counts only when directly attributable; never infer them from
open-to-merge time. Finish with `pnpm record:ai-pr-lifecycle summary --pr <PR>`.
