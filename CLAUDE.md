# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⚠️ Start of Session (MANDATORY)

1. Read `.ai/START-HERE.md` and follow the starting ritual.
2. Follow the required reading order in `docs/ai-instructions.md` before modifying code.

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

