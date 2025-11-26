# Load Context Workflow

When the user says "load context" or starts a new session, load all core documentation to understand the project:

## Files to Load (in order)

1. `docs/core/design.md` — Architecture patterns and UI/UX guidelines
2. `docs/core/agents.md` — AI agent instructions and TDD workflow
3. `docs/core/tests.md` — Testing strategy and requirements
4. `docs/core/roadmap.md` — Current implementation status

## Response

After loading, respond with:

```
✅ Pika context loaded. Ready to work on the student attendance tracking app.

Loaded:
- Design & architecture patterns
- Agent instructions & TDD workflow
- Testing strategy
- Current roadmap (MVP complete)

What would you like to work on?
```
