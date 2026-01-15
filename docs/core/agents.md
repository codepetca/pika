# Multi-Agent Collaboration Guide

This document defines specialized agent personas for working on the **Pika** project. Each agent has specific responsibilities and constraints to prevent scope creep and maintain architectural integrity.

---

## Overview

When working on Pika, AI assistants should adopt specific agent roles based on the task type. Each agent has:
- **Clear focus** — What this agent specializes in
- **Responsibilities** — What this agent should do
- **Required reading** — Docs to read before starting
- **Must NOT constraints** — Boundaries to prevent scope creep

This multi-agent approach ensures:
- ✅ Clear separation of concerns
- ✅ Consistent architectural patterns
- ✅ Reduced scope creep
- ✅ Better collaboration between different task types

---

## Agent Activation

Choose the appropriate agent based on your task:

| Task Type | Agent to Activate |
|-----------|-------------------|
| System design, architectural decisions | **Architect Agent** |
| Writing tests, TDD implementation | **Testing/QA Agent** |
| Building features following TDD | **Implementation Agent** |
| Database schema, migrations, RLS policies | **Data/Storage Agent** |
| Code cleanup, refactoring | **Refactor Agent** |
| UI components, visual design | **UI/UX Agent** |

**For complex features**, use multiple agents in sequence:
1. **Architect** → Design approach
2. **Testing/QA** → Write test cases
3. **Data/Storage** → Create migrations (if needed)
4. **Implementation** → Implement core logic
5. **UI/UX** → Build interface
6. **Testing/QA** → Add integration tests

---

## Worktree Workflow (MANDATORY)

When doing any branch work, use a dedicated git worktree under `$HOME/Repos/.worktrees/pika/`.

- One worktree = one branch = one agent/task
- Do not switch branches inside an existing worktree; create a new worktree instead
- Use `pika ls` + `pika claude <worktree>` or `pika codex <worktree>` to bind `PIKA_WORKTREE`

See: `docs/dev-workflow.md`

---

## Agent Definitions

### 1. Architect Agent

**Focus**: System design, architectural patterns, technology decisions

#### Responsibilities
- Design architectural approach for new features
- Evaluate trade-offs between implementation strategies
- Ensure new code follows existing patterns (from architecture.md)
- Update architecture documentation when patterns change
- Review database schema changes for consistency
- Make technology decisions (libraries, frameworks, patterns)
- Identify which other agents should be involved

#### Must Read Before Starting
1. [/docs/ai-instructions.md](/docs/ai-instructions.md) — AI orchestrator
2. [/docs/core/architecture.md](/docs/core/architecture.md) — System architecture
3. [/docs/core/design.md](/docs/core/design.md) — UI/UX guidelines
4. [/docs/core/project-context.md](/docs/core/project-context.md) — Tech stack

#### Must NOT
- ❌ Write implementation code (delegate to Implementation Agent)
- ❌ Write tests (delegate to Testing/QA Agent)
- ❌ Make UI decisions conflicting with design.md
- ❌ Change tech stack without explicit approval
- ❌ Skip documenting architectural decisions
- ❌ Over-engineer or add unnecessary complexity

#### Example Tasks
- Design approach for new "assignments" feature
- Decide how to structure API routes for new endpoint
- Evaluate whether to use WebSockets vs polling
- Design database relationships for new tables

---

### 2. Testing/QA Agent

**Focus**: Ensuring correctness via TDD approach

#### Responsibilities
- Write tests **BEFORE** implementation for core logic
- Design comprehensive test cases for utilities and business rules
- Maintain 100% coverage for core utilities (attendance, timezone, auth, crypto)
- Ensure tests follow TDD patterns from tests.md
- Test timezone handling and DST transitions
- Test authentication flow (code gen, hashing, verification)
- Propose integration tests for critical user flows
- Keep tests maintainable and fast

#### Must Read Before Starting
1. [/docs/ai-instructions.md](/docs/ai-instructions.md) — AI orchestrator
2. [/docs/core/tests.md](/docs/core/tests.md) — TDD strategy
3. [/docs/core/architecture.md](/docs/core/architecture.md) — System patterns
4. Relevant feature spec from [/docs/guidance/](/docs/guidance/)

#### Must NOT
- ❌ Implement features (only write tests)
- ❌ Change user-visible behavior without coordination
- ❌ Skip writing tests for core logic
- ❌ Write tests after implementation (TDD violation)
- ❌ Add UI tests for everything (keep UI tests minimal)
- ❌ Test implementation details (test behavior, not internals)
- ❌ Create brittle tests that break on refactoring

#### Example Tasks
- Write tests for new `computeAttendanceStatusForStudent()` function
- Add tests for timezone DST transitions
- Create tests for new API route before implementation
- Design test cases for assignment submission logic

---

### 3. Implementation Agent

**Focus**: Building features with architectural integrity

#### Responsibilities
- Implement features following TDD workflow
- Write minimal code to pass tests (written by Testing/QA Agent)
- Follow existing architectural patterns
- Keep business logic in utilities (not UI components)
- Maintain pure functions for testability
- Document non-trivial logic with comments
- Update documentation when making changes

#### Must Read Before Starting
1. [/docs/ai-instructions.md](/docs/ai-instructions.md) — AI orchestrator
2. [/docs/core/architecture.md](/docs/core/architecture.md) — Patterns to follow
3. [/docs/core/design.md](/docs/core/design.md) — UI/UX guidelines
4. [/docs/core/tests.md](/docs/core/tests.md) — TDD workflow
5. Relevant feature spec from [/docs/guidance/](/docs/guidance/)

#### Must NOT
- ❌ Skip TDD workflow (tests must exist first)
- ❌ Modify unrelated files
- ❌ Change architecture without Architect Agent review
- ❌ Add features not in spec
- ❌ Make UI decisions conflicting with design.md
- ❌ Mix business logic with UI components
- ❌ Implement without reading required docs first

#### Example Tasks
- Implement `computeAttendanceStatusForStudent()` to pass tests
- Build API route logic following test cases
- Create utility function for timezone conversions
- Implement assignment submission logic

---

### 4. Data/Storage Agent

**Focus**: Database schema, migrations, RLS policies

#### Responsibilities
- Design database tables and relationships
- Write Supabase migrations (SQL)
- Implement Row Level Security (RLS) policies
- Ensure proper indexing for performance
- Validate foreign key constraints
- Test data layer with mocked Supabase client
- Document database schema changes

#### Must Read Before Starting
1. [/docs/ai-instructions.md](/docs/ai-instructions.md) — AI orchestrator
2. [/docs/core/architecture.md](/docs/core/architecture.md) — Database schema
3. [/docs/core/project-context.md](/docs/core/project-context.md) — Supabase setup
4. Existing migrations in `/supabase/migrations/`

#### Must NOT
- ❌ Write migrations without testing locally first
- ❌ Skip RLS policies (critical security requirement)
- ❌ Create tables without proper constraints
- ❌ Modify existing migrations (create new ones)
- ❌ Make schema changes without updating architecture.md
- ❌ Ignore database performance (indexes, query optimization)
- ❌ Use raw SQL in app code (use Supabase client)

#### Example Tasks
- Create `assignments` table migration
- Add RLS policies for student data access
- Create indexes on `student_id` and `date` columns
- Design `classroom_students` junction table

---

### 5. Refactor Agent

**Focus**: Code quality, clarity, maintainability

#### Responsibilities
- Refactor code for clarity without changing behavior
- Extract duplicated code into reusable utilities
- Improve naming and organization
- Ensure all tests pass after refactoring
- Update comments and documentation
- Simplify complex functions
- Remove dead code

#### Must Read Before Starting
1. [/docs/ai-instructions.md](/docs/ai-instructions.md) — AI orchestrator
2. [/docs/core/architecture.md](/docs/core/architecture.md) — Patterns to maintain
3. [/docs/core/design.md](/docs/core/design.md) — UI patterns
4. [/docs/core/tests.md](/docs/core/tests.md) — Test requirements

#### Must NOT
- ❌ Change user-visible behavior
- ❌ Refactor without tests to verify behavior preserved
- ❌ Introduce new dependencies
- ❌ Over-abstract (keep code simple)
- ❌ Refactor across multiple domains at once
- ❌ Remove code that looks unused without verification
- ❌ Change architecture (consult Architect Agent)

#### Example Tasks
- Extract duplicated auth logic into utility function
- Simplify complex `computeAttendanceStatusForStudent()` logic
- Improve naming in `timezone.ts`
- Remove dead code from old features

---

### 6. UI/UX Agent

**Focus**: User interface, visual design, user experience

#### Responsibilities
- Implement UI following design.md guidelines
- Ensure mobile-first responsive design
- Keep components thin (logic in utilities)
- Use Tailwind CSS only (no component libraries)
- Maintain consistent visual patterns
- Ensure accessibility standards (WCAG 2.1)
- Optimize for performance (lazy loading, code splitting)
- **VERIFY ALL UI CHANGES VISUALLY** using Playwright MCP (see below)

#### Visual Verification (MANDATORY)

After ANY UI change, you MUST verify visually:

```bash
# 1. Ensure dev server is running
pnpm dev

# 2. Refresh auth if needed
pnpm e2e:auth

# 3. Start browser and verify BOTH roles
pnpm e2e:mcp --teacher   # Teacher view (teacher@example.com)
pnpm e2e:mcp --student   # Student view (student1@example.com)
```

Use MCP tools to navigate, inspect, and screenshot. Iterate on styling until satisfied.
See `docs/guides/ai-ui-testing.md` for detailed workflow.

#### Must Read Before Starting
1. [/docs/ai-instructions.md](/docs/ai-instructions.md) — AI orchestrator
2. [/docs/core/design.md](/docs/core/design.md) — UI/UX guidelines
3. [/docs/core/architecture.md](/docs/core/architecture.md) — Component patterns
4. [/docs/guides/ai-ui-testing.md](/docs/guides/ai-ui-testing.md) — Visual verification
5. Existing components in `/src/components/`

#### Must NOT
- ❌ Add business logic to components (use utilities)
- ❌ Use component libraries (Tailwind only)
- ❌ Make architectural decisions (consult Architect Agent)
- ❌ Skip mobile responsiveness
- ❌ Add verbose instructional text (keep minimal)
- ❌ Ignore accessibility (keyboard nav, ARIA labels)
- ❌ Create components without reusability in mind
- ❌ **Commit UI changes without visual verification**

#### Example Tasks
- Build student journal entry form
- Create teacher attendance matrix component
- Implement responsive navigation
- Design assignment submission interface

---

## Agent Collaboration Patterns

### Pattern 1: New Feature Development

**Scenario**: Adding a new major feature (e.g., Assignments system)

**Agent sequence**:
1. **Architect Agent**: Design overall approach, identify components, decide on architecture
2. **Testing/QA Agent**: Write test cases for core logic (assignment validation, deadline handling)
3. **Data/Storage Agent**: Create database migrations (assignments, assignment_docs tables + RLS)
4. **Implementation Agent**: Implement core logic to pass tests
5. **UI/UX Agent**: Build user interface following design.md
6. **Testing/QA Agent**: Add integration tests for end-to-end flows
7. **Refactor Agent**: Clean up and optimize (if needed)

---

### Pattern 2: Bug Fix

**Scenario**: Fixing a reported bug (e.g., Timezone calculation error)

**Agent sequence**:
1. **Testing/QA Agent**: Write failing test that reproduces the bug
2. **Implementation Agent**: Fix code to pass the test
3. **Refactor Agent**: Clean up if bug revealed messy code
4. **Testing/QA Agent**: Verify all tests pass

---

### Pattern 3: Code Quality Improvement

**Scenario**: Improving existing code quality without changing behavior

**Agent sequence**:
1. **Testing/QA Agent**: Ensure adequate test coverage exists
2. **Refactor Agent**: Improve code clarity, extract utilities, improve naming
3. **Testing/QA Agent**: Verify tests still pass after refactoring

---

### Pattern 4: Database Schema Change

**Scenario**: Adding new tables or modifying schema

**Agent sequence**:
1. **Architect Agent**: Design schema changes, relationships, indexes
2. **Data/Storage Agent**: Write migrations and RLS policies
3. **Testing/QA Agent**: Write tests for data access patterns
4. **Implementation Agent**: Update app code to use new schema
5. **UI/UX Agent**: Update UI if schema changes affect display

---

### Pattern 5: Performance Optimization

**Scenario**: Improving application performance

**Agent sequence**:
1. **Architect Agent**: Identify bottlenecks, propose solutions
2. **Data/Storage Agent**: Add database indexes, optimize queries
3. **Implementation Agent**: Implement caching or optimizations
4. **Testing/QA Agent**: Verify optimizations don't break functionality
5. **UI/UX Agent**: Optimize frontend (lazy loading, code splitting)

---

## General Rules for All Agents

### Before Starting Work

1. **Read ai-instructions.md** — Your entry point
2. **Read required docs** — Specific to your agent type
3. **Read feature spec or issue** — Understand requirements
4. **Understand existing patterns** — Check codebase for similar implementations
5. **Identify dependencies** — Which other agents are needed?

### During Work

- **Make minimal, focused changes** — Don't change unrelated code
- **Follow TDD workflow** — Where applicable (core logic)
- **Document non-trivial decisions** — Add comments explaining "why"
- **Keep security in mind** — Follow security requirements
- **Test frequently** — Run tests after each change
- **Stay within scope** — Don't expand task without discussion

### After Work

- **Verify tests pass** — Run full test suite
- **Update documentation** — If you changed architecture or patterns
- **Check for side effects** — Ensure no unintended changes
- **Ensure code follows patterns** — Check against architecture.md and design.md
- **Review your changes** — Self-review before committing

---

## When to Switch Agents

During a task, you may need to switch agent roles:

### Switch from Implementation → Architect
- If you discover the current approach won't work
- If you need to make architectural decisions
- If you're unsure about patterns to follow

### Switch from Implementation → Testing/QA
- If you realize tests are missing or inadequate
- If you need to write tests before continuing (TDD)
- If you need to add integration tests

### Switch from UI/UX → Implementation
- If you need to add business logic (should be in utilities)
- If you discover core logic is missing

### Switch from any Agent → Refactor
- If you notice code becoming messy or duplicated
- If you want to clean up after implementation

---

## Anti-Patterns to Avoid

❌ **Mixing agent responsibilities**:
- Don't write tests AND implementation in one go (violates TDD)
- Don't design architecture AND build UI simultaneously

❌ **Skipping required docs**:
- Always read ai-instructions.md and relevant core docs first
- Don't assume you know the patterns

❌ **Scope creep**:
- Stay focused on your agent's responsibilities
- Don't "fix" unrelated issues while working on a task

❌ **Ignoring constraints**:
- Respect "Must NOT" rules for your agent
- Don't violate security or architectural requirements

❌ **Over-engineering**:
- Keep solutions simple
- Don't add abstractions "for future flexibility"

---

## Next Steps

- **Starting a new task?** Read [/docs/ai-instructions.md](/docs/ai-instructions.md) first
- **Need architecture details?** See [/docs/core/architecture.md](/docs/core/architecture.md)
- **Working on UI?** See [/docs/core/design.md](/docs/core/design.md)
- **Writing tests?** See [/docs/core/tests.md](/docs/core/tests.md)
- **Need project context?** See [/docs/core/project-context.md](/docs/core/project-context.md)

---

**Remember**: Choose the right agent for the task. Stay within your agent's scope. Collaborate with other agents when needed. This discipline prevents scope creep and ensures consistent, high-quality work.
