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
- Split large naming or shared-shell refactors into explicit passes when behavior, imports, and compatibility cleanup would otherwise land together
- Give each pass a grep- or test-based exit criterion so "done" does not depend on memory
- Keep compatibility wrappers or aliases in their own phase unless removing them is mechanically proven safe in the same diff

## Refactor Slicing Pattern

For broad structural or naming transitions, prefer this order:

1. active callers and imports
2. compatibility wrappers or aliases
3. API/read-path cleanup
4. fixtures and test wording
5. docs and follow-up removals

Each PR should name:

- what moved in this slice
- what intentionally stayed behind
- which search or tests prove the slice boundary

## Review Prompt

Before opening the PR, answer:

```text
Is this a shell extraction, a behavior extraction, or both?
What business logic stayed out of the shared component?
Which parent-level tests prove the refactor did not redesign the surface?
Which component-level tests prove the new shared contract?
If this is part of a larger migration, what exact slice is this PR responsible for?
What grep or regression proves the remaining work is outside this PR on purpose?
```
