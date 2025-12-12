# Pika Documentation Overview

This folder organizes all high-level guidance, architecture rules, feature specifications, and iteration workflows for the **Pika** student attendance tracking application.

The docs follow a strict multi-layer structure so that AI assistants can work consistently without drifting from architecture, design, or domain concepts.

---

## Quick Start for AI Agents

**START HERE**: [`/.ai/START-HERE.md`](/.ai/START-HERE.md)

Then read: [ai-instructions.md](ai-instructions.md) — Your primary entry point for project rules.

This file provides:
- Required reading order (7 core files)
- Architecture snapshot
- Critical constraints (MANDATORY and PROHIBITED)
- Common workflows
- Agent selection guide

**Or say "load context"** to load all core documentation automatically via [workflow/load-context.md](workflow/load-context.md).

---

## Folder Structure

```
/docs
├── ai-instructions.md          # AI orchestrator (entry point)
│
├── issue-author.md             # How to write implementation-ready issues
├── issue-worker.md             # How to execute issues safely (plan gating + TDD)
├── code-reviewer.md            # How to review PRs
│
├── /core                        # Stable, long-lived reference docs
│   ├── architecture.md         # System architecture & patterns
│   ├── design.md               # UI/UX guidelines
│   ├── project-context.md      # Tech stack & setup
│   ├── agents.md               # Multi-agent collaboration (6 personas)
│   ├── tests.md                # TDD philosophy & testing priorities
│   └── roadmap.md              # Phase-based implementation tracking
│   └── decision-log.md          # Durable summary of historical decisions
│
├── /guidance                    # Domain/feature-level guidance
│   └── assignments.md          # Assignments feature spec
│
├── /workflow                    # Development process docs
│   ├── handle-issue.md         # GitHub Issue workflow
│   └── load-context.md         # Context initialization
│
└── /issues                      # Task specifications
    ├── 02-core-utility-tests.md
    ├── 03-api-route-tests.md
    ├── 04-integration-tests.md
    └── 05-update-documentation.md
```

---

## Layer Purposes

### [ai-instructions.md](ai-instructions.md) — AI Orchestrator (Entry Point)

**Purpose**: Top-level AI guidance that synthesizes all documentation

**Contains**:
- Required reading order (enforced across all sessions)
- Architecture snapshot (Next.js, Supabase, TDD-first)
- Core loop (load → understand → test → implement → refactor)
- Critical constraints (MANDATORY: TDD, timezone, security | PROHIBITED: no OAuth, no component libs)
- Common workflows (adding features, fixing bugs, working on issues)
- When to spawn specialized agents
- Platform-specific usage notes

**When to read**: ALWAYS read this first when starting any task

---

### `/docs/core/` — Stable, Long-Lived Reference Docs

These define Pika's unchanging rules:

#### [architecture.md](core/architecture.md) — System Architecture
- Directory structure
- Key architectural patterns (auth flow, attendance logic, route protection)
- Data flow patterns
- API route structure
- Database schema & RLS policies
- Critical implementation details (timezone, security, pure functions)
- Middleware & utilities
- Deployment architecture

#### [design.md](core/design.md) — UI/UX Guidelines
- Design principles (mobile-first, minimal, accessible, performant)
- Visual design system (colors, typography, spacing, shadows)
- Component patterns (buttons, forms, cards, navigation)
- Layout patterns (containers, grids, flexbox)
- Page-specific patterns (student pages, teacher dashboard)
- Responsive breakpoints
- Accessibility guidelines
- Animation & transitions
- Performance optimization

#### [project-context.md](core/project-context.md) — Project Context
- What is Pika (overview, goals, users)
- Tech stack (Next.js 14, Supabase, Tailwind, Vitest)
- Getting started (prerequisites, setup, env vars)
- Development commands (dev, test, database, code quality)
- Key features overview
- Deployment guide (Vercel + Supabase)
- Troubleshooting

#### [agents.md](core/agents.md) — Multi-Agent Collaboration
- Agent activation guide (which agent for which task)
- 6 specialized agent personas:
  1. **Architect Agent** — System design, architectural decisions
  2. **Testing/QA Agent** — TDD implementation, test coverage
  3. **Implementation Agent** — Feature building with TDD
  4. **Data/Storage Agent** — Database, migrations, RLS
  5. **Refactor Agent** — Code quality, maintainability
  6. **UI/UX Agent** — Interface, visual design
- Agent collaboration patterns (new features, bug fixes, schema changes)
- General rules for all agents
- When to switch agents
- Anti-patterns to avoid

#### [tests.md](core/tests.md) — TDD Philosophy & Testing Priorities
- Testing strategy (100% core, 90%+ data layer, minimal UI)
- TDD development flow
- Test plan (core utilities, data layer, integration, UI)
- Coverage goals

#### [roadmap.md](core/roadmap.md) — Phase-Based Implementation Tracking
- Current status (MVP complete, tests in progress)
- Completed phases (setup, auth, student experience, teacher dashboard)
- Future features
- Deployment strategy

**These should change only when the overall system changes.**

---

### `/docs/guidance/` — Domain/Feature-Level Conceptual Guidance

These files explain **how major concepts work** and guide implementation across multiple iterations.

Current files:
- **[assignments.md](guidance/assignments.md)** — Assignments & Online Editor feature specification

Future additions may include:
- attendance-guidance.md
- classroom-guidance.md
- timezone-guidance.md

**These evolve more slowly than issue files.**

---

### `/docs/workflow/` — Iteration-Level Task Workflows

These files describe **how to work with the project** as an AI agent or developer.

Current files:
- **[handle-issue.md](workflow/handle-issue.md)** — GitHub Issue workflow for AI agents
- **[load-context.md](workflow/load-context.md)** — Context initialization instructions

**These guide the development process and prevent architectural drift.**

---

### `/docs/issues/` — Task Specifications

Individual task files with acceptance criteria:
- **02-core-utility-tests.md** — Add unit tests for src/lib/ files
- **03-api-route-tests.md** — Add API route tests with mocked Supabase
- **04-integration-tests.md** — Add E2E tests with Playwright
- **05-update-documentation.md** — Update roadmap and feature docs

**These are created as needed for specific tasks.**

---

## Reading Order for AI Agents

Before modifying code, any AI assistant must read these **in this exact order**:

0. **[/.ai/START-HERE.md](/.ai/START-HERE.md)** — session ritual (verify env, journal, feature status)
1. **[/docs/ai-instructions.md](/docs/ai-instructions.md)** — AI orchestrator ⭐ START HERE
2. **[/docs/core/architecture.md](/docs/core/architecture.md)** — System architecture
3. **[/docs/core/design.md](/docs/core/design.md)** — UI/UX guidelines
4. **[/docs/core/project-context.md](/docs/core/project-context.md)** — Tech stack & setup
5. **[/docs/core/agents.md](/docs/core/agents.md)** — Multi-agent collaboration
6. **[/docs/core/tests.md](/docs/core/tests.md)** — TDD requirements
7. **[/docs/core/roadmap.md](/docs/core/roadmap.md)** — Current status

Optional (as needed):
8. **[/docs/core/decision-log.md](/docs/core/decision-log.md)** — Historical decisions and rationale

Then consult:
8. Relevant **[/docs/guidance/*.md](/docs/guidance/)** files (feature specs as needed)
9. **[/docs/workflow/handle-issue.md](/docs/workflow/handle-issue.md)** (when working on issues)

**Only after these are read** should the AI inspect or modify source code.

This **prevents architectural drift** and preserves the integrity of the application.

---

## Workflow Summary

### For Humans (Maintainers)
1. Update conceptual docs in `/docs/guidance/` when adding new features
2. Create task specs as GitHub issues or `/docs/issues/*.md` files
3. Update core architecture when system patterns change
4. Review and approve AI-generated code changes

### For AI Agents
1. Read [ai-instructions.md](ai-instructions.md) (or say "load context")
2. Read required docs in order
3. Choose appropriate agent role (see [agents.md](core/agents.md))
4. Follow TDD workflow from [tests.md](core/tests.md)
5. Apply required changes
6. Update tests and documentation

### For Both
- Completed work is verified and merged
- Documentation stays in sync with code
- Architecture remains consistent

---

## Key Differences from Traditional Docs

### 1. AI-First Design
- **ai-instructions.md** serves as AI orchestrator (not just for humans)
- Prescriptive reading order enforced
- Constraint-first documentation (MANDATORY and PROHIBITED sections)
- Multi-agent collaboration patterns

### 2. Separation of Concerns
- **Architecture** (system patterns) vs **Design** (UI/UX) split into separate files
- **Project context** (setup, commands) extracted from agents guide
- **Agent personas** (6 specialized roles) with clear boundaries

### 3. Reading Order Discipline
- Same reading order mentioned in ai-instructions.md, load-context.md, README.md, and CLAUDE.md
- Prevents architectural drift
- Builds knowledge incrementally

---

## Notes

- **Do not add implementation details here** (those belong in code comments)
- **Do not store assets** or large media in `/docs`
- **Keep conceptual guidance crisp and minimal**
- **Focus on preventing drift** and maintaining consistency
- **Update docs when architecture changes** (not just code)

---

## Next Steps

- **New to Pika?** Read [ai-instructions.md](ai-instructions.md) first
- **Setting up locally?** See [project-context.md](core/project-context.md)
- **Working on an issue?** Follow [handle-issue.md](workflow/handle-issue.md)
- **Understanding architecture?** See [architecture.md](core/architecture.md)
- **Building UI?** See [design.md](core/design.md)
- **Writing tests?** See [tests.md](core/tests.md)
