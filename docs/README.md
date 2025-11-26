# Pika Documentation Overview

This folder organizes all high-level guidance, architecture rules, feature specifications, and iteration workflows for the **Pika** student attendance tracking application.

The docs follow a strict 3-layer structure so that AI assistants can work consistently without drifting from architecture, design, or educational/attendance concepts.

---

## Folder Structure

```
/docs
  /core
    agents.md
    design.md
    roadmap.md
    tests.md
  
  /guidance
    assignments.md
    
  /workflow
    handle-issue.md
```

---

## Layer Purposes

### `/docs/core/` — Stable, Long-Lived Reference Docs

These define Pika's unchanging rules:

- **[design.md](core/design.md)** — Architecture patterns, directory structure, UI/UX guidelines
- **[agents.md](core/agents.md)** — AI agent instructions and development workflows
- **[roadmap.md](core/roadmap.md)** — Phase-based implementation tracking
- **[tests.md](core/tests.md)** — TDD philosophy and testing priorities

These should change only when the overall system changes.

---

### `/docs/guidance/` — Domain/Feature-Level Conceptual Guidance

These files explain **how major concepts work** and guide implementation across multiple iterations.

Current files:

- **[assignments.md](guidance/assignments.md)** — Assignments & Online Editor feature specification

Future additions may include:
- attendance-guidance.md
- classroom-guidance.md
- timezone-guidance.md

These evolve more slowly than issue files.

---

### `/docs/workflow/` — Iteration-Level Task Workflows

These files describe **how to work with the project** as an AI agent or developer.

Current files:

- **[handle-issue.md](workflow/handle-issue.md)** — GitHub Issue workflow for AI agents

These guide the development process and prevent architectural drift.

---

## Reading Order for Any AI Agent

Before modifying code, any AI assistant must read these **in order**:

1. `/docs/core/design.md`
2. `/docs/core/agents.md`
3. `/docs/core/tests.md`
4. `/docs/core/roadmap.md` (for current status)
5. Relevant `/docs/guidance/` files (e.g., `assignments.md`)
6. The specific workflow or issue referenced in the user prompt

Only after these are read should the AI inspect or modify source code.

This prevents architectural drift and preserves the integrity of the application.

---

## Workflow Summary

1. **Human (you)** updates:
   - Conceptual docs in `/docs/guidance/`
   - Task specs as GitHub issues
   - Core architecture when system changes

2. **AI**:
   - Reads core → guidance → workflow/issue files
   - Applies required changes using TDD approach
   - Updates tests/code accordingly

3. Completed work is verified and merged

---

## Notes

- Do not add implementation details here (those belong in code comments)
- Do not store assets or large media in `/docs`
- Keep conceptual guidance and architectural rules crisp and minimal
- Focus on preventing drift and maintaining consistency
