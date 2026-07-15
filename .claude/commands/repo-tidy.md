Report and clean up repo cruft: stale branches, worktrees, and idle PRs.

This command operates on the current repo/worktree.

Rules:
- Resolve the current repo root with `git rev-parse --show-toplevel`.
- The report script is read-only; all deletions happen in a second, explicit step.
- Never delete anything holding unique work (dirty worktrees, branches with
  unpushed commits, branches without a merged/closed PR) without showing the
  user what it contains and getting confirmation.
- `main` and `production` are never touched.

Steps:

1) Run the report
   - `bash scripts/repo-tidy.sh`
   - Summarize the findings for the user grouped by risk:
     - **Safe**: remote branches whose PR is merged/closed (restorable from the
       PR page), local branches with deleted upstreams, clean worktrees.
     - **Needs a decision**: dirty worktrees, branches with commits that exist
       nowhere else, branches with no PR, idle open PRs.

2) Clean the safe group (after confirming with the user, or immediately if they
   asked for cleanup up front)
   - Delete merged/closed-PR remote branches: `git push origin --delete <branch>...`
   - Delete gone-upstream local branches: `git branch -D <branch>...`
   - Remove clean worktrees: `git worktree remove <path>` then `git worktree prune`

3) Present the decision group
   - For each item, show what it contains (diff stat, last commit, PR link) and
     recommend one of: rescue to a PR, tag-rescue then delete
     (`git tag rescue/<name> <branch>` before `git branch -D`), or keep.
   - For idle PRs, recommend close vs revive based on age and drift from main.

4) Exit with a summary: items cleaned, items awaiting decision, items kept.
