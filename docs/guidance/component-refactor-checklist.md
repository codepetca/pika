# Component Refactor Checklist

Use this before large TSX refactors, shared shell extraction, or cross-surface UI consolidation.

## Triggers

Read this when any of these are true:

- a TSX file is becoming a large shared surface
- a new component extracts behavior used by multiple classroom tabs or roles
- a refactor touches layout, state coordination, and business behavior in the same change
- the work is presented as structural, not a redesign

## Structure Checks

- Name the component boundary in one sentence
- Keep business logic in `src/lib/*`, server helpers, or existing data modules
- Prefer passing derived display data over domain-specific live state when possible
- Stop if the shared component starts requiring domain-only props from one surface
- Keep query/routing/mutation behavior outside pure shell components unless the shell already owns it

## PR-Scale Checks

- If a component grows large, explain why it is still a coherent unit
- If a shared component replaces repeated markup, list the repeated structure it owns
- List visible behavior that must remain unchanged if this is a structural refactor
- Add focused regression tests for the extracted shell contract, not only the parent surface

## Review Prompt

Before opening the PR, answer:

```text
Is this a shell extraction, a behavior extraction, or both?
What business logic stayed out of the shared component?
Which parent-level tests prove the refactor did not redesign the surface?
Which component-level tests prove the new shared contract?
```
