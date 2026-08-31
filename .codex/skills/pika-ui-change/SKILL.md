---
name: pika-ui-change
description: Plan and implement Pika UI or UX changes using the governed design system, Pattern Lab references, explicit component-reuse decisions, and the required visual verification matrix. Use before modifying user-visible Pika layout, styling, controls, icons, statuses, or interaction states; do not use for documentation-only discussion.
---

# Pika UI Change

Keep each change recognizable as Pika while avoiding unnecessary component proliferation.

## Before editing

1. Complete the normal Pika session-start workflow.
2. Read the UI sources routed by `docs/ai-instructions.md`: `DESIGN.md`, `src/ui/README.md`, the stable UI canon, the UI change brief, and the visual-testing guide. Load family guidance only for the affected family.
3. Inspect the target surface, its nearest approved Pika reference, and the relevant entries in `/pattern-lab`. Screenshots and historical code are evidence; the authority order in `DESIGN.md` still applies.
4. Record the UI change brief. Name the surface, reference, roles, viewports, themes, affected states, primary signal, exclusions, and composite-widget review requirement.

If no clear reference exists, stop before implementation and request human direction or draft an experimental pattern. Do not silently treat a legacy screen as precedent.

## Reuse decision

Before proposing files or code, provide a compact table with these columns:

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|

Use exactly one decision per row: `reuse`, `extend`, or `create`.

- Reuse the canonical owner when its semantics and behavior fit.
- Extend an owner only when the additional contract is stable for its existing consumers.
- Create a shared component only when at least two genuine adopters need the same behavior and a narrow durable API exists. Visual similarity alone is insufficient.
- Keep feature state and business logic outside `src/ui`.
- Prefer precise domain status labels. Do not unify statuses merely because they share a color or icon.
- Use Lucide as the default icon source. Icon-only controls require an accessible name, tooltip when the meaning is not already visible, shared focus behavior, and the 44px target.
- Do not add emoji, text glyphs, handcrafted SVG approximations, or another icon library as interface symbols.

Call out nearby duplication as a refactor candidate, but do not expand the requested change into an unrelated refactor. Explain which adopters and behavior would justify a later extraction.

## Implementation contract

- Import base controls from `@/ui` and use semantic tokens.
- Preserve shared shell, page framing, page-state, focus, keyboard, overlay, and responsive contracts.
- Update `/pattern-lab` when a stable component contract, icon meaning, status convention, or reusable composition changes.
- Keep Pattern Lab examples deterministic. They render production owners with fixed fixtures and must not depend on live API data.
- Mark proposed patterns experimental until a human promotes them through the UI canon.
- Add focused semantic or interaction tests for changed behavior. Do not use visual snapshots as the only test of behavior.

## Verification and handoff

1. Run the focused tests plus UI and design policy checks.
2. Use `$pika-ui-verify` for the affected route.
3. Cover the declared role, viewport, theme, and interaction-state matrix. Both roles are mandatory unless one is explicitly `n/a` with a reason.
4. Compare the implementation with the named reference at the same viewport and state, then fix visible drift before reporting success.
5. Treat snapshot updates as reviewed acceptance changes. Never refresh a failing baseline without inspecting the difference.
6. Report the reuse decisions, refactor candidates, verification matrix, and any experimental pattern that still needs human promotion.
