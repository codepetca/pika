# Load Context Workflow

When the user says "load context" or starts a new session, load the AI instructions and core documentation.

---

## Primary Entry Point

**Always start here**: `/docs/ai-instructions.md`

This file provides:
- Required reading order for all core documentation
- Architecture snapshot (tech stack, patterns, constraints)
- Critical constraints (what is MANDATORY and PROHIBITED)
- Common workflows (adding features, fixing bugs, working on issues)
- Agent selection guide (which agent to use for which task)

---

## Files to Load (in order)

Follow the reading order specified in `ai-instructions.md`:

1. **`/docs/ai-instructions.md`** — AI orchestrator (read first!)
2. **`/docs/core/architecture.md`** — System architecture patterns
3. **`/docs/core/design.md`** — UI/UX guidelines
4. **`/docs/core/project-context.md`** — Tech stack & project setup
5. **`/docs/core/agents.md`** — Multi-agent collaboration patterns
6. **`/docs/core/tests.md`** — TDD requirements
7. **`/docs/core/roadmap.md`** — Current implementation status

---

## Response Template

After loading all files, respond with:

```
✅ Pika context loaded. Ready to work on student attendance & assignment tracking.

Loaded AI instructions and core documentation:
- AI orchestrator with reading order and constraints
- System architecture patterns & data flow
- UI/UX design guidelines (mobile-first, Tailwind, accessibility)
- Project context (Next.js 14, Supabase, email verification + password auth)
- Multi-agent collaboration (6 specialized agents)
- TDD requirements (100% core coverage, test-first workflow)
- Current roadmap (MVP complete, tests in progress)

What would you like to work on?
```

---

## For Issue-Based Work

After loading context, if working on an issue:

1. Run: `gh issue view X --json number,title,body,labels`
2. Follow `/docs/workflow/handle-issue.md` for detailed workflow

---

## Notes

- **Always read ai-instructions.md first** — It provides the reading order and critical constraints
- **Follow the reading order** — Prevents architectural drift
- **Choose appropriate agent role** — See agents.md for which agent to use
- **TDD-first for core logic** — Write tests before implementation
