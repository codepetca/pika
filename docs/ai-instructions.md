# AI Instructions for Pika

This is your **primary entry point** for working on the Pika project.

If you are starting a new session, **first read** `.ai/START-HERE.md` (environment check + journal + workflow), then come back here.

---

## Overview

**Pika** is a student daily log and attendance tracking application for an online high school course (GLD2O). Students submit daily journal entries before midnight (America/Toronto timezone), and teachers monitor attendance and read student submissions through a dashboard.

**Status**: Basic MVP complete - authentication, student experience, and teacher dashboard implemented. Currently adding comprehensive test coverage.

---

## Required Reading Order

When working on any task, read these files **in this exact order** to prevent architectural drift:

1. **[/docs/ai-instructions.md](/docs/ai-instructions.md)** (this file) — AI orchestrator
2. **[/docs/core/architecture.md](/docs/core/architecture.md)** — System architecture & patterns
3. **[/docs/core/design.md](/docs/core/design.md)** — UI/UX guidelines
4. **[/docs/core/project-context.md](/docs/core/project-context.md)** — Tech stack & setup
5. **[/docs/core/agents.md](/docs/core/agents.md)** — Multi-agent collaboration
6. **[/docs/core/tests.md](/docs/core/tests.md)** — TDD requirements
7. **[/docs/core/roadmap.md](/docs/core/roadmap.md)** — Current status

Then consult:
- **[/docs/guidance/*.md](/docs/guidance/)** — Feature specifications (as needed)
- **[/docs/workflow/handle-issue.md](/docs/workflow/handle-issue.md)** — Issue workflow (when working on issues)

**Only after reading these** should you inspect or modify source code.

---

## Architecture Snapshot

### Tech Stack
- **Framework**: Next.js 14+ (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Email verification codes (signup/reset) + password login (**NO OAuth**)
- **Styling**: Tailwind CSS
- **Testing**: Vitest + React Testing Library
- **Deployment**: Vercel

### Key Characteristics
- **Timezone**: America/Toronto (hardcoded for all deadline calculations)
- **TDD-first**: Write tests before implementation for core logic
- **Pure functions**: Attendance logic has no side effects, fully testable
- **Mobile-first**: Student experience optimized for mobile devices
- **No component libraries**: Tailwind CSS only

---

## Core Loop

When building features or fixing bugs, follow this cycle:

1. **Load Context** — Read required documentation in order (see above)
2. **Understand Requirements** — Read issue or user prompt carefully
3. **Write Tests FIRST** — For core logic (utilities, business rules)
4. **Implement Minimal Code** — Pass the tests you wrote
5. **Refactor for Clarity** — Keep code simple and maintainable
6. **Keep UI Thin** — Move logic to utilities, not components

This TDD approach ensures code quality and prevents regressions.

---

## Critical Constraints

### Platform Requirements (MANDATORY)

✅ **MUST USE**:
- Next.js App Router (NOT Pages Router)
- Supabase for database and storage
- America/Toronto timezone for all deadlines
- Email verification codes (signup/reset) + password login (NO OAuth providers)
- Tailwind CSS for styling
- Vitest + React Testing Library for tests

### Architecture Rules (PROHIBITED)

❌ **DO NOT**:
- Mix business logic with UI components
- Store plaintext login codes (always hash with bcrypt)
- Skip TDD workflow for core utilities
- Modify architecture without reading design docs first
- Use component libraries (Tailwind only)
- Implement features without tests for core logic
- Make changes to unrelated files
- Over-engineer or add unnecessary abstractions

### Security Requirements (MANDATORY)

🔒 **MUST IMPLEMENT**:
- Hash all login codes with bcrypt before storing
- Use HTTP-only, secure, SameSite cookies for sessions
- Validate email domains (check ALLOWED_EMAIL_DOMAIN)
- Rate limit auth endpoints (code requests and verifications)
- Protect routes by role (student vs teacher)
- Never expose session secrets or internal tokens

### Testing Requirements (MANDATORY)

🧪 **MUST TEST**:
- Core utilities: 100% coverage (attendance, timezone, auth, crypto)
- Data layer: 90%+ coverage (API routes with mocked Supabase)
- Pure functions: Test all edge cases
- Timezone handling: Test DST transitions
- Authentication: Code generation, hashing, verification

---

## Common Workflows

### Workflow 1: Adding a Feature

1. Read ai-instructions.md (this file)
2. Read all required docs in sequence
3. Create a worktree for your branch (see `docs/workflow/worktrees.md`)
4. Identify which agent role to adopt (see agents.md)
5. Write tests FIRST for core logic
6. Implement minimal code to pass tests
7. Refactor for clarity
8. Update docs if architecture changes

### Workflow 2: Working on an Issue

1. Run: `gh issue view X --json number,title,body,labels`
2. Follow reading order above
3. Follow `docs/issue-worker.md` (protocol) and `docs/workflow/handle-issue.md` (quick pointer)
4. Create a worktree for `issue/X-slug` (see `docs/workflow/worktrees.md`)
5. Follow TDD workflow
6. Create PR with "Closes #X"

### Workflow 3: Load Context

1. Say "load context" or similar trigger
2. System loads ai-instructions.md (this file)
3. System loads all files in Required Reading Order
4. Confirm context loaded
5. Ready to work

### Workflow 4: Fixing a Bug

1. Read ai-instructions.md and relevant core docs
2. Create a worktree for your branch (see `docs/workflow/worktrees.md`)
3. Write a failing test that reproduces the bug
4. Fix code to pass the test
5. Refactor if needed
6. Verify all tests pass

---

## When to Spawn Specialized Agents

See [/docs/core/agents.md](/docs/core/agents.md) for detailed agent definitions. Use these agents based on task type:

| Task Type | Agent to Use |
|-----------|--------------|
| System design changes | **Architect Agent** |
| Writing tests, TDD implementation | **Testing/QA Agent** |
| Building features with TDD | **Implementation Agent** |
| Database schema, migrations, RLS | **Data/Storage Agent** |
| Code cleanup, refactoring | **Refactor Agent** |
| UI components, visual design | **UI/UX Agent** |

**Multi-agent collaboration**: For complex features, spawn multiple agents in sequence (e.g., Architect → Testing/QA → Implementation → UI/UX).

---

## Platform-Specific Usage Notes

### Claude Code (CLI)
- Preferred tool for this project
- Use `/docs` commands to navigate documentation
- Follow TDD workflow with test:watch mode
- Use git integration for commits and PRs

### GitHub Copilot / Cursor
- Read this file and core docs in workspace
- Keep documentation open in editor
- Verify suggestions against architectural constraints
- Run tests frequently

### ChatGPT / Claude.ai
- Copy relevant docs into conversation context
- Request full file contents, not snippets
- Verify code against constraints before applying
- Test implementations manually

---

## Decision-Making Guidelines

When facing implementation choices:

1. **Follow existing patterns** — Check codebase for similar implementations
2. **Prefer simplicity** — Don't over-engineer or add unnecessary abstractions
3. **TDD-first** — Write tests to clarify expected behavior
4. **Consult docs** — Re-read architecture.md and design.md
5. **Document decisions** — Add comments for non-trivial logic
6. **Make reasonable assumptions** — Don't block on minor details
7. **Update docs** — If changing architecture, update relevant /docs files

---

## Quick Reference

### Key Files
- **Attendance logic**: `src/lib/attendance.ts` — Pure function, fully testable
- **Timezone utilities**: `src/lib/timezone.ts` — America/Toronto handling
- **Authentication**: `src/lib/auth.ts` — Session management
- **Crypto**: `src/lib/crypto.ts` — Code generation and hashing
- **Supabase client**: `src/lib/supabase.ts`

### Key Concepts
- **ClassDay**: A day when attendance is expected
- **Entry**: A student's journal submission for a day
- **AttendanceStatus**: `'present' | 'absent'` (on_time field in Entry)
- **on_time**: Calculated by comparing updated_at (Toronto time) to midnight

### Common Commands
```bash
npm run dev              # Start dev server
npm run test:watch       # TDD mode
npm run test:coverage    # Check coverage
gh issue view X          # View issue details
```

---

## Maintaining This File

**When to update ai-instructions.md**:
- Core architecture changes
- New mandatory constraints added
- New agent types introduced
- Reading order changes
- Critical patterns change

**Who updates**:
- Project maintainer (human)
- AI agents should propose updates, not make them directly

---

## Next Steps

- **New to the project?** Continue reading in the order specified above
- **Working on an issue?** See [/docs/workflow/handle-issue.md](/docs/workflow/handle-issue.md)
- **Adding a feature?** See [/docs/guidance/](/docs/guidance/) for feature specs
- **Need technical details?** See [/docs/core/architecture.md](/docs/core/architecture.md)
- **Questions about testing?** See [/docs/core/tests.md](/docs/core/tests.md)
- **Agent collaboration?** See [/docs/core/agents.md](/docs/core/agents.md)

---

**Remember**: This file is your entry point. Read it first, then follow the reading order. This discipline prevents architectural drift and ensures consistent, high-quality implementations.
