Complete the current worktree through Pika's automatic draft-first PR lifecycle.

Use the dedicated-worktree rules from `docs/dev-workflow.md`. Task-specific safeguards:

- Never commit directly to `main` or `production`
- Never force-push
- Use a conventional-commit message derived from the diff
- Keep the PR draft until independent review and batched remediation are complete
- Mark ready only when the reviewed head SHA is stable

Steps:
1. Resolve the repo root with `git rev-parse --show-toplevel`. If it equals `$HOME/Repos/pika` (the hub), stop and ask me to create or open a worktree first. Confirm the current branch. If `git branch --show-current` is empty, stop because detached HEAD is not safe for commit/push/PR flow. Stop if the branch is `main` or `production`.
2. Review `git diff --stat`, `git diff`, and recent commit style. Run `pnpm check:focused -- --base origin/main` plus every routed feature-specific check.
3. Stage the intended files, generate a conventional-commit message, and commit.
4. Push the branch, setting upstream if needed. If no PR exists, create it with `gh pr create --draft` and a concise summary/test plan. If an existing PR is ready but review or fixes remain, run `gh pr ready --undo` before pushing changes.
5. Run the smallest risk-appropriate independent review wave on the full diff. Validate findings and batch accepted fixes into one remediation pass; do not push one fix per finding.
6. Run affected local checks, commit and push the batch while the PR is draft, and use targeted re-review. Complete any required final cumulative review.
7. Record the final reviewed SHA in the PR, run `gh pr ready`, and wait for `PR Gate` on that exact SHA. If CI fails, return the PR to draft before correcting it and repeat only the targeted review/check cycle.
8. Merge only when `PR Gate`, review, conflict, sensitive-data, and authority gates all pass. Otherwise leave the PR open and report the exact blocker.

Lifecycle measurement is automatic for AI-authored development PRs. Once the PR
number exists, record the tracking-start (`started`), `implementation`, and
`draft-created` events with
`pnpm record:ai-pr-lifecycle event --pr <PR> --event <stage>`. Record
`independent-review`, each batched `remediation`, `ready-for-ci`, the final CI
result (with separately observed queue/run seconds), and `merged`. Add active
time and token counts only when directly attributable; never infer them from
open-to-merge time. Finish with `pnpm record:ai-pr-lifecycle summary --pr <PR>`.
