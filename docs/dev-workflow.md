# Pika Development Workflow

Pika is developed using git worktrees and parallel feature branches with AI agents (Claude, Codex).

---

## Worktrees

Claude Desktop and Codex automatically create and bind sessions to worktrees under:

```
<repo>/.claude/worktrees/<name>
```

**To create a worktree manually:**
```bash
cd $HOME/Repos/pika
git worktree add .claude/worktrees/<name> -b <branch>
cd .claude/worktrees/<name>
bash scripts/setup-worktree.sh   # links .env.local
```

**Rules:**
- Never do feature work directly in `$HOME/Repos/pika` (the hub)
- One worktree per feature branch
- `git status`, `git push`, etc. run without `-C` flags — your session CWD is the worktree

---

## Environment files

All worktrees share a single canonical `.env.local`:

```
$HOME/Repos/.env/pika/.env.local
```

New worktrees need a symlink. Claude Desktop and Codex don't do this automatically — run once:

```bash
bash scripts/setup-worktree.sh
```

---

## Landing changes to `main` (no merge commits)

`main` rejects merge commits. Use linear history only.

**Preferred:** open a PR → **Squash and merge**.

If landing from local CLI:
```bash
cd $HOME/Repos/pika
git fetch origin
git checkout main
git pull --ff-only origin main

# Option A: squash feature branch
git merge --squash origin/<feature-branch>
git commit -m "<summary>"
git push origin main

# Option B: cherry-pick
git cherry-pick <sha> [<sha>...]
git push origin main
```

Avoid:
```bash
git merge --no-ff <branch>   # creates merge commit — rejected
```

---

## Merging `main` into `production` (PR required)

Use `/merge-main-into-production` in Claude Code, or manually:

### 1) Prepare

```bash
REPO="$HOME/Repos/pika"
git -C "$REPO" fetch origin
git -C "$REPO" worktree prune

if [ ! -d "$REPO/.claude/worktrees/production" ]; then
  git -C "$REPO" worktree add "$REPO/.claude/worktrees/production" production
fi
```

### 2) Merge

```bash
PROD="$HOME/Repos/pika/.claude/worktrees/production"
git -C "$PROD" fetch origin main production
git -C "$PROD" merge --ff-only origin/production
git -C "$PROD" merge origin/main
```

### 3) Open PR

```bash
MERGE_BRANCH="merge-main-into-production-$(date +%Y%m%d)"
git -C "$PROD" push origin HEAD:"refs/heads/$MERGE_BRANCH"

gh pr create \
  --repo codepetca/pika \
  --base production \
  --head "$MERGE_BRANCH" \
  --title "Merge main into production ($(date +%Y-%m-%d))" \
  --body 'Merge latest main into production.'
```

### 4) After merge

```bash
gh pr merge <pr-number> --repo codepetca/pika --merge
git -C "$PROD" fetch origin production
git -C "$PROD" merge --ff-only origin/production
```

### Known pitfalls

- `production` worktree missing from disk but listed in metadata: run `git -C "$HOME/Repos/pika" worktree prune` then re-add.
- Push rejected with `GH013`: expected — open a PR instead of direct push.
