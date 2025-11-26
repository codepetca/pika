# AI Agent Guide

This document provides instructions for AI coding assistants working on the **Pika** project.

---

## Project Overview

**Pika** is a student daily log and attendance tracking application for an online high school course (GLD2O). Students submit daily journal entries before midnight (America/Toronto timezone), and teachers monitor attendance and read student submissions through a dashboard.

**Status**: Basic MVP complete - authentication, student experience, and teacher dashboard implemented.

---

## Tech Stack

- **Framework**: Next.js 14+ (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Passwordless email codes (custom implementation)
- **Styling**: Tailwind CSS
- **Testing**: Vitest + React Testing Library
- **Deployment**: Vercel

---

## Recommended File Reading Order

When starting any task, AI agents must read these files **in order** to prevent architectural drift:

1. **[design.md](design.md)** — Architecture patterns, directory structure, UI/UX guidelines
2. **[agents.md](agents.md)** (this file) — AI agent instructions and workflows
3. **[tests.md](tests.md)** — TDD workflow and testing requirements
4. **[roadmap.md](roadmap.md)** — Current implementation status
5. **Relevant guidance files** — e.g., [/docs/guidance/assignments.md](../guidance/assignments.md)
6. **Issue or workflow file** — e.g., [/docs/workflow/handle-issue.md](../workflow/handle-issue.md)

Only after reading these should you inspect or modify source code.

---

## Development Commands

```bash
# Development
npm run dev              # Start dev server on localhost:3000
npm run build            # Production build
npm start                # Run production build locally

# Testing
npm run test             # Run all tests
npm run test:watch       # Watch mode (for TDD)
npm run test:ui          # Vitest UI
npm run test:coverage    # Coverage report

# Database (if using local Supabase)
supabase start           # Start local instance
supabase db reset        # Reset and re-run migrations
supabase migration new <name>  # Create new migration
```

---

## Environment Variables

Required in `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=  # New format: sb_publishable_...
SUPABASE_SECRET_KEY=                   # New format: sb_secret_...

# Email (for sending codes)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Auth
DEV_TEACHER_EMAILS=                    # Comma-separated list for development
SESSION_SECRET=
SESSION_MAX_AGE=604800

# Dev flags
ENABLE_MOCK_EMAIL=true
```

**Note**: Supabase now uses publishable/secret keys (starting with `sb_publishable_` and `sb_secret_`) instead of the legacy anon/service_role keys. The code supports both formats.

---

## Agent Roles & Workflows

### Testing/QA Agent

**Focus**: Ensuring correctness via TDD approach.

**Responsibilities**:
- Design and maintain unit tests for:
  - `computeAttendanceStatusForStudent()` and attendance logic
  - Timezone handling (`isOnTime()`)
  - Authentication (code generation, hashing, verification)
- Follow the **TDD Development Flow** defined in [tests.md](tests.md):
  - Models → Core Utilities (TDD) → Data Layer (TDD) → UI (thin) → Integration
- Keep core logic small, deterministic, and easy to test
- Propose lightweight UI tests where valuable

**Must NOT**:
- Change user-visible behavior without coordination
- Skip writing tests before implementation for core logic

### Implementation Agent

**Focus**: Building features while maintaining architectural integrity.

**Responsibilities**:
- Follow TDD workflow from [tests.md](tests.md)
- Write tests FIRST for core utilities and data layer
- Maintain pure functions for testability
- Follow existing patterns in the codebase
- Update documentation when making architectural changes

**Must NOT**:
- Implement features without reading required docs first
- Modify unrelated files or architecture without justification
- Skip the TDD workflow for core logic

---

## Critical Rules for AI Agents

### When Asked to Build or Extend Features

1. **Read documentation first** - follow the reading order above
2. **Follow TDD workflow** - write tests before implementation for core logic
3. **Do not ask follow-up questions** - make reasonable decisions and document them
4. **Generate complete, working code** - ensure all imports, types, and file paths align
5. **Maintain consistency** - follow existing patterns in the codebase

### Code Quality Standards

- Keep attendance logic **pure and testable** (no side effects)
- **Always use America/Toronto timezone** for deadline calculations
- Hash all login codes before storing (**never store plaintext**)
- Set HTTP-only, secure, SameSite cookies for sessions
- Validate email domain against `ALLOWED_EMAIL_DOMAIN` env var
- Rate limit code requests and verification attempts

### TDD Workflow

For **new core functionality** (utilities, business logic):

1. Define TypeScript types/interfaces
2. **Write tests FIRST** (describe expected behavior)
3. Implement minimal code to pass tests
4. Refactor for clarity
5. Repeat

For **data layer** (API routes):

1. Write route tests with mocked dependencies
2. Implement route logic
3. Refactor

For **UI** (views/components):

1. Keep views thin (logic should be in utilities)
2. Test through underlying logic, not UI snapshots
3. Add component tests only for critical interactions

### Documentation

- Document non-trivial logic with comments
- Update relevant `/docs` files when making architectural changes
- Keep `README.md` in sync with setup instructions

---

## Next Steps

For detailed architectural patterns, see [design.md](design.md).  
For implementation roadmap, see [roadmap.md](roadmap.md).  
For comprehensive testing strategy, see [tests.md](tests.md).  
For future feature specs, see [/docs/guidance/](../guidance/).  
For development workflows, see [/docs/workflow/](../workflow/).

