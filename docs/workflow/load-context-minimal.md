# Load Context Workflow (Minimal)

This is a **lightweight version** of the full context load. Use this for most day-to-day work.

---

## When to Use This

✅ **Use minimal context for**:
- Bug fixes
- Small feature additions
- Routine maintenance
- Issues in familiar domains
- Follow-up work in same session

❌ **Use full context for**:
- Major new features
- Architectural changes
- First time working on new domain
- Complex multi-system changes
- When explicitly requested

---

## Files to Load (in order)

1. **`/docs/ai-instructions.md`** — AI orchestrator (entry point + constraints)
2. **`/docs/core/architecture.md`** — System architecture patterns

**Skipped** (load on-demand if needed):
- design.md (UI/UX patterns)
- project-context.md (setup & commands)
- agents.md (multi-agent collaboration)
- tests.md (TDD workflow)
- roadmap.md (current status)

**Note**: CLAUDE.md is always auto-loaded and contains essential quick reference.

---

## Response Template

After loading files, respond with:

```
✅ Minimal Pika context loaded. Ready to work.

Loaded:
- AI orchestrator (constraints, reading order, workflows)
- System architecture (auth flow, attendance logic, data patterns)

Available on-demand: design.md, project-context.md, agents.md, tests.md, roadmap.md

What would you like to work on?
```

---

## For Issue-Based Work

After loading context, if working on an issue:

1. Run: `gh issue view X --json number,title,body,labels`
2. Follow `/docs/workflow/handle-issue.md` for detailed workflow
3. Read additional docs on-demand as needed

---

## Token Savings

- **Full context**: ~50k tokens
- **Minimal context**: ~15k tokens
- **Savings**: ~35k tokens (70% reduction)

---

## Notes

- Most issues don't require full system understanding
- AI can request specific docs if needed during work
- CLAUDE.md already provides quick reference and navigation
- This approach optimizes for speed and token efficiency
