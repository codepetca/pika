# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 🚨 CRITICAL: Start of Session Protocol (MANDATORY)

**STOP. Before doing ANYTHING else in this session:**

### Step 1: Read `.ai/START-HERE.md` FIRST
This is **NOT OPTIONAL**. Read it now: `.ai/START-HERE.md`

### Step 2: Verify Worktree Environment
**NEVER work in the hub repo** (`$HOME/Repos/pika`). Always verify:

```bash
# Check if PIKA_WORKTREE is set
echo $PIKA_WORKTREE

# If empty or points to hub repo, STOP
# Ask user: "Which worktree should I use? Run: pika ls"
```

### Step 3: If No Worktree Exists
If the user wants you to work on a feature:
- Ask: "Should I create a worktree for this? What branch name?"
- Create worktree following `docs/dev-workflow.md`
- Symlink `.env.local`

### Step 4: Only Then Proceed
After verifying you're in a worktree, follow the required reading order in `docs/ai-instructions.md`.

**Violation of this protocol is a critical error that wastes user time.**

---

## 📚 Documentation Structure

Pika uses two complementary layers:

- **`.ai/`**: session continuity (starting ritual, journal, big-epic feature inventory)
- **`/docs`**: stable architecture, constraints, and workflows

### Primary Entry Points
1. `.ai/START-HERE.md` — environment check + continuity + “plan before coding”
2. `docs/ai-instructions.md` — AI orchestrator (required reading order + constraints)

### Quick Links
- `docs/README.md` — documentation map
- `docs/core/architecture.md` — architecture invariants
- `docs/core/tests.md` — testing rules
- `docs/issue-worker.md` — issue execution protocol
- `.ai/features.json` — status authority (“what is done?”)
- `.ai/JOURNAL.md` — session history (append-only)

---

## 🎯 Core Constraints (Quick Reference)

### MANDATORY ✅
- **Next.js App Router** (not Pages Router)
- **Supabase** for database/storage
- **America/Toronto timezone** for all deadline calculations
- **Email verification codes + password login** (NO OAuth)
- **Tailwind CSS only** (NO component libraries)
- **Dark mode on ALL components** (light + dark modes required)
- **TDD-first** for core logic (write tests before implementation)
- **Keep UI thin** (business logic in utilities/server code)
- **Hash verification/reset codes and passwords** with bcrypt (never plaintext)
- **HTTP-only, secure cookies** for sessions (`iron-session`)

### PROHIBITED ❌
- OAuth providers
- Component libraries (Chakra/MUI/etc.)
- Business logic embedded in UI components
- Skipping tests for core logic
- Committing secrets (`.env.local`, keys, tokens)
- Over-engineering or unnecessary abstractions
- **Shipping UI components without dark mode support**

---

## 🔄 Worktree Workflow Rules (MANDATORY)

### During Every Session
1. **All git commands MUST use**: `git -C "$PIKA_WORKTREE"`
2. **All file paths MUST be absolute** or prefixed with `$PIKA_WORKTREE`
3. **Before any `git checkout -b`**: Verify you're in a worktree, not hub repo
4. **Before any commit**: Double-check you're committing in the worktree

### Red Flags (STOP if you see these)
- Running `git checkout -b` without checking `$PIKA_WORKTREE`
- Current directory is `$HOME/Repos/pika` and you're not on main branch
- About to commit to a feature branch in the hub repo

### Recovery if You Make a Mistake
If you realize you worked in the hub repo:
1. Stash changes: `git stash push -u -m "description"`
2. Create proper worktree
3. Pop stash in worktree
4. Commit there instead

