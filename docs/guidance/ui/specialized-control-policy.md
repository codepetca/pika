# Specialized Control Policy

Pika uses canonical primitives from `@/ui` for ordinary buttons, fields, selects, dialogs, and
other base controls. Native controls remain valid when browser semantics or a composite widget
requires them. CI distinguishes those intentional cases from unreviewed drift through
[`scripts/ui-control-exceptions.json`](/scripts/ui-control-exceptions.json).

## Enforced Contract

- Import design-system exports from the `@/ui` barrel. `@/ui/*` subpath imports and legacy
  `@/components/*` primitive imports are rejected.
- Native `button`, `input`, `select`, and `textarea` elements in `src/app` and ordinary
  `src/components` files require an exact registry entry.
- Each registry entry records the control signature, exact count, reason, and owning follow-up.
- Adding, removing, or changing a registered control signature requires reviewing and updating the
  registry in the same PR. A stale entry fails CI instead of becoming permanent invisible debt.
- `src/ui` implementation details and isolated Tiptap controls are owned by their respective
  primitive systems and are outside this registry.

## Reason Categories

- `composite-widget`: a native control carries menu, tab, table, drag, or similar composite
  behavior that a generic button cannot own by itself.
- `icon-or-inline-action`: a compact semantic action whose feature-owned behavior is not a generic
  call-to-action.
- `native-input-capability`: browser-owned file, checkbox, radio, date, time, range, color, or
  related input behavior.
- `native-textarea`: Pika intentionally has no canonical textarea primitive; labeled textareas
  still use `FormField` and semantic tokens.
- `legacy-form-control`: existing debt that should move to a canonical primitive during the named
  workflow review. This reason does not make the pattern preferred for new work.

## Making A Change

1. Prefer the matching `@/ui` primitive for an ordinary control.
2. If native semantics are required, add or update the exact registry entry with the narrowest
   reason and a concrete `reviewBy` owner.
3. Add role, keyboard, focus, and target-size tests proportional to the control behavior.
4. Run `pnpm check:ui-policy`. Use `pnpm exec tsx scripts/check-ui-policy.ts --print-inventory`
   only to inspect the current AST inventory; generated placeholder reasons are not approval.

The registry is a review boundary, not a permanent allowlist. Phase 3 workflow slices should
reduce `legacy-form-control` counts when they touch the owning surface, while retaining native
controls whose browser or composite semantics remain appropriate.
