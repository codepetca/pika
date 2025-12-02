# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 📚 Documentation Structure

The project documentation follows a **multi-layer structure** organized in the `/docs` directory for clarity and maintainability, optimized for AI agent guidance.

### Primary Entry Point

**START HERE**: [docs/ai-instructions.md](docs/ai-instructions.md) — Your AI orchestrator!

This file provides:
- **Required reading order** (7 core files in sequence)
- **Architecture snapshot** (Next.js 14, Supabase, TDD-first)
- **Critical constraints** (MANDATORY and PROHIBITED sections)
- **Common workflows** (adding features, fixing bugs, working on issues)
- **Agent selection guide** (6 specialized agent personas)
- **Platform-specific usage notes** (Claude Code, Copilot, ChatGPT)

### Quick Links to Core Documentation

- **[docs/ai-instructions.md](docs/ai-instructions.md)** — AI orchestrator (START HERE)
- **[docs/README.md](docs/README.md)** — Documentation overview & structure
- **[docs/core/architecture.md](docs/core/architecture.md)** — System architecture & patterns
- **[docs/core/design.md](docs/core/design.md)** — UI/UX guidelines (mobile-first, Tailwind, accessibility)
- **[docs/core/project-context.md](docs/core/project-context.md)** — Tech stack, setup, commands
- **[docs/core/agents.md](docs/core/agents.md)** — Multi-agent collaboration (6 personas)
- **[docs/core/tests.md](docs/core/tests.md)** — TDD workflow & testing strategy
- **[docs/core/roadmap.md](docs/core/roadmap.md)** — Phase-based implementation tracking
- **[docs/guidance/](docs/guidance/)** — Feature specifications & domain guidance
- **[docs/workflow/](docs/workflow/)** — Development workflows & issue handling

---

## 🚀 Quick Start for AI Agents

**CRITICAL**: Read documentation in this exact order before modifying code:

1. **[docs/ai-instructions.md](docs/ai-instructions.md)** — AI orchestrator ⭐ **START HERE**
2. **[docs/core/architecture.md](docs/core/architecture.md)** — System architecture
3. **[docs/core/design.md](docs/core/design.md)** — UI/UX guidelines
4. **[docs/core/project-context.md](docs/core/project-context.md)** — Tech stack & setup
5. **[docs/core/agents.md](docs/core/agents.md)** — Multi-agent collaboration
6. **[docs/core/tests.md](docs/core/tests.md)** — TDD requirements
7. **[docs/core/roadmap.md](docs/core/roadmap.md)** — Current status

Then consult:
- **[docs/guidance/*.md](docs/guidance/)** — Feature specifications (as needed)
- **[docs/workflow/handle-issue.md](docs/workflow/handle-issue.md)** — Issue workflow (when working on issues)

**Or say "load context"** to load all core documentation automatically via [docs/workflow/load-context.md](docs/workflow/load-context.md).

This reading order prevents architectural drift and ensures consistency.

---

## 🔑 Key Concepts

### What Makes This Documentation Different

1. **AI-First Design**: [ai-instructions.md](docs/ai-instructions.md) serves as top-level orchestrator with prescriptive reading order and constraint-first documentation

2. **Separation of Concerns**:
   - **Architecture** (system patterns) vs **Design** (UI/UX) split into separate files
   - **Project context** (setup, commands) extracted from agents guide
   - **Agent personas** (6 specialized roles) with clear boundaries

3. **Multi-Agent Collaboration**: 6 specialized agent personas in [agents.md](docs/core/agents.md):
   - Architect Agent — System design, architectural decisions
   - Testing/QA Agent — TDD implementation, test coverage
   - Implementation Agent — Feature building with TDD
   - Data/Storage Agent — Database, migrations, RLS
   - Refactor Agent — Code quality, maintainability
   - UI/UX Agent — Interface, visual design

4. **Constraint-First**: Clear MANDATORY and PROHIBITED sections prevent common mistakes

5. **Reading Order Discipline**: Same order enforced across all documentation prevents drift

---

## 🎯 Core Constraints (Quick Reference)

### MANDATORY ✅
- **TDD-first** for core logic (write tests before implementation)
- **America/Toronto timezone** for all deadline calculations
- **Next.js App Router** (not Pages Router)
- **Supabase** for database
- **Passwordless email codes** (custom, NO OAuth)
- **Tailwind CSS** only (NO component libraries)
- **Pure functions** for business logic (testable, no side effects)
- **100% coverage** for core utilities
- **Hash login codes** with bcrypt (NEVER plaintext)
- **HTTP-only, secure cookies** for sessions

### PROHIBITED ❌
- **NO OAuth providers** (custom email codes only)
- **NO component libraries** (Chakra UI, Material-UI, etc.)
- **NO mixing business logic** with UI components
- **NO skipping TDD workflow** for core logic
- **NO modifying architecture** without reading docs first
- **NO plaintext storage** of sensitive data
- **NO over-engineering** or unnecessary abstractions

---

## 📖 Documentation Layers

### Layer 1: Core (Stable, long-lived)
[/docs/core/](docs/core/) — Unchanging architectural rules and patterns

### Layer 2: Guidance (Feature-level)
[/docs/guidance/](docs/guidance/) — Domain concepts and feature specifications

### Layer 3: Workflow (Process-level)
[/docs/workflow/](docs/workflow/) — Development processes and task workflows

### Layer 4: Issues (Task-level)
[/docs/issues/](docs/issues/) — Specific task specifications with acceptance criteria

---

## 🛠️ Common Workflows

### Adding a Feature
1. Read ai-instructions.md and core docs
2. Choose appropriate agent role (see agents.md)
3. Write tests FIRST for core logic (TDD)
4. Implement minimal code to pass tests
5. Refactor for clarity
6. Update docs if architecture changes

### Fixing a Bug
1. Write failing test that reproduces bug
2. Fix code to pass test
3. Refactor if needed
4. Verify all tests pass

### Working on an Issue
1. Run: `gh issue view X --json number,title,body,labels`
2. Follow reading order above
3. Follow [docs/workflow/handle-issue.md](docs/workflow/handle-issue.md)
4. Create branch: `issue/X-slug`
5. Implement with TDD
6. Create PR with "Closes #X"

---

## 🚦 When to Use Which Agent

See [docs/core/agents.md](docs/core/agents.md) for full details.

| Task Type | Agent to Use |
|-----------|--------------|
| System design, architectural decisions | **Architect Agent** |
| Writing tests, TDD implementation | **Testing/QA Agent** |
| Building features following TDD | **Implementation Agent** |
| Database schema, migrations, RLS | **Data/Storage Agent** |
| Code cleanup, refactoring | **Refactor Agent** |
| UI components, visual design | **UI/UX Agent** |

---

## 💡 Tips for Success

1. **Always start with ai-instructions.md** — It's your map
2. **Follow the reading order** — Knowledge builds incrementally
3. **Choose the right agent** — Stay within agent boundaries
4. **TDD-first for core logic** — Tests before implementation
5. **Keep UI thin** — Business logic in utilities, not components
6. **Document decisions** — Add comments for non-trivial logic
7. **Update docs** — When changing architecture or patterns

---

## 📞 Need Help?

- **Understanding the project?** Read [docs/core/project-context.md](docs/core/project-context.md)
- **Confused about architecture?** Read [docs/core/architecture.md](docs/core/architecture.md)
- **Not sure which agent to use?** Read [docs/core/agents.md](docs/core/agents.md)
- **Testing questions?** Read [docs/core/tests.md](docs/core/tests.md)
- **UI/UX patterns?** Read [docs/core/design.md](docs/core/design.md)

---

**Remember**: This file serves as a pointer to comprehensive documentation in `/docs`. All detailed information has been migrated there for better organization and AI agent guidance.
