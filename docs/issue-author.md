# Pika — Issue Author Protocol

Use this protocol whenever you are asked to create or refine a GitHub issue so that another AI (or human) can implement it reliably.

## Principles
- Make issues self-contained: an implementer should not need the original chat.
- Keep scope tight: one issue = one coherent outcome.
- Prefer pass/fail acceptance criteria and a concrete testing plan.
- Reference a feature ID from `.ai/features.json` when applicable.

## Issue Template (Required)

```md
## Summary
<1–3 sentences explaining what needs to change.>

## Background / Context
<Why this matters. Links to related issues/PRs/docs.>

## Requirements / Acceptance Criteria
- [ ] <Pass/fail criterion 1>
- [ ] <Pass/fail criterion 2>

## Scope
**In scope**
- <What this issue covers>

**Out of scope**
- <What is explicitly not included>

## Implementation Notes
- Relevant files: `<path>`
- Constraints: timezone, security, role checks, etc.
- Suggested approach (optional, non-binding)

## Testing Plan
- [ ] Automated: <tests to add/update>
- [ ] Manual: <steps to verify in app>

## Risks / Open Questions
- <Unknowns, trade-offs, dependencies>
```

## Naming & Labels
- Title prefix: `fix:`, `feat:`, `chore:`, `refactor:`, `docs:`
- Include suggested labels if helpful (e.g., `bug`, `enhancement`, `documentation`)

