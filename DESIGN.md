# Pika Design System

This is the canonical entry point for Pika product design.

It defines the durable principles, ownership boundaries, authority order, and
review contract for UI work. It does not duplicate executable token values,
component APIs, or workflow-specific guidance.

## Start Here

For UI work, read in this order:

1. This file.
2. [`src/ui/README.md`](./src/ui/README.md) for canonical component APIs and
   semantic-token usage.
3. [`docs/guidance/ui/README.md`](./docs/guidance/ui/README.md) for the governed
   stable, family-specific, experimental, legacy, and open-question guidance.
4. [`docs/guidance/ui/change-brief.md`](./docs/guidance/ui/change-brief.md) before
   a non-trivial user-visible change.
5. [`docs/guides/ai-ui-testing.md`](./docs/guides/ai-ui-testing.md) for final
   visual verification.

Load family-specific guidance only when the task affects that family.

## Product Character

Pika should feel:

- **Minimal and functional.** Prefer clear hierarchy, short labels, progressive
  disclosure, and useful whitespace over decorative chrome or instructions.
- **Compact where scanning matters.** Teacher operational surfaces may use a
  denser rhythm to keep related work visible, but density must not shrink direct
  actions below the shared touch-target contract or hide information.
- **Comfortable for student work.** Student reading and authoring surfaces use a
  calmer content rhythm and explicit task/status feedback.
- **Professional but approachable.** The base product is restrained. Playful
  accents are welcome when they support identity, motivation, or status without
  competing with the work.
- **Consistent without being generic.** Reuse foundations and interaction
  contracts. Keep feature-specific composition when a workflow genuinely needs
  it.

Pika already has a substantial visual foundation. New work should refine the
current product rather than introduce a broad visual redesign without evidence
and explicit product approval.

## Authority Model

Use this order when sources conflict:

1. `DESIGN.md` owns cross-system design principles, ownership, invariants, and
   governance.
2. `src/styles/tokens.css` owns exact semantic values and light/dark theme pairs.
3. `src/ui` owns canonical primitive APIs, behavior, semantics, and accessibility
   contracts.
4. `tailwind.config.ts` exposes executable tokens to Tailwind. It is an adapter,
   not an independent visual system.
5. `docs/guidance/ui/stable.md` owns stable cross-workflow product rules.
6. Family-specific stable guidance owns its declared slice only.
7. Experimental guidance contains candidates and never overrides stable rules.
8. `docs/guidance/ui/legacy.md` is the active catalogue of patterns that may
   need preservation but must not spread.
9. Audits and Git history provide evidence and rationale, not current authority.

These sources have different authority domains. Exact color values come from
tokens; component behavior comes from `src/ui`; workflow composition comes from
stable or family-specific guidance. A mismatch between executable behavior and
this contract is drift to resolve, not permission to silently copy the mismatch.

## Executable Foundations

### Semantic color and themes

- App code uses semantic tokens such as `bg-page`, `bg-surface`,
  `text-text-default`, and `border-border`.
- Raw theme switching stays inside the documented design-system exceptions.
- All product UI supports light and dark themes.
- Theme-specific values live in `src/styles/tokens.css`; documentation and
  components reference their intent instead of copying values.
- Color is never the only carrier of status or meaning.
- Text and interactive states meet WCAG 2.1 AA contrast in both themes.

### Typography

- Use Pika's system sans-serif stack for application text and controls.
- Use monospace only when the content itself benefits from fixed-width glyphs,
  such as code, identifiers, or structured source text.
- Page and section heading hierarchy comes from shared page primitives rather
  than feature-local title scales.
- Components and embedded widgets inherit host typography unless a documented
  content-specific exception owns another typeface.

### Spacing, density, and touch

- Prefer semantic spacing for component and shell responsibilities; ordinary
  layout may use the Tailwind scale.
- Teacher and student density are product modes, not permission to remove data
  or compress interactive targets.
- Directly actionable controls maintain a minimum 44 by 44 CSS-pixel target.
- Select named page widths through shared page primitives instead of adding
  feature-local `max-w-*` contracts.
- Narrow-screen behavior should change composition when needed rather than
  squeezing a desktop workspace until it becomes unusable.

### Focus and keyboard behavior

- Every interactive element has a visible `focus-visible` treatment.
- Shared primitives own their normal focus ring, offset, disabled behavior, and
  target size.
- Composite controls follow their widget keyboard model, including roving focus,
  semantic state, disabled-item handling, Escape behavior, and focus return.
- Do not suppress an outline without providing an equally visible replacement.

### Motion and reduced motion

- Motion is restrained, purposeful, and normally 150–300ms.
- Prefer opacity, color, and small spatial changes over large or continuous
  movement.
- Motion must not be required to understand state.
- Every non-essential animation or transition has a reduced-motion path.
- Playful features may retain identity through static artwork and state changes
  when movement is reduced.

### Layers and overlays

- Global app chrome, popovers, dialogs/drawers, tooltips, transient status, and
  critical full-screen states are distinct layer responsibilities.
- Shared overlay owners manage portal placement, focus, background inertness,
  scroll locking, viewport containment, and focus return.
- Feature-local sticky table layers stay inside their own stacking context.
- Do not introduce a new global raw `z-index` or body-level portal when a shared
  owner exists.

Phase 2 of the design-system consolidation will give typography, focus, motion,
global layers, overlay scrims/bounds, touch targets, and density portable
semantic tokens. Until then, reuse the existing shared owners instead of
creating competing values.

## Application Composition

### Shared shell

The authenticated classroom shell is Pika's strongest reference surface:

- compact application header
- left classroom navigation
- primary work region
- optional, justified inspection region
- drawer behavior on narrow screens

The right side is not default empty chrome. Activate an inspector only when the
current workflow, mode, and selection justify it.

Utility routes should converge on shared application navigation and page-state
contracts incrementally. Existing utility-shell differences are migration
evidence, not a new design language to copy.

### Page and workflow states

Loading, error, empty, and forbidden are different states:

- loading means the initial read is pending
- error means a required read failed
- empty means a successful read returned no records
- forbidden means the current identity cannot use the surface

Preserve the surrounding shell when possible. A failed read must not look like
an empty result. Use the shared page-state contract and bounded retry behavior.

### Base controls and composition

- Import canonical primitives from `@/ui`.
- Use shared controls for ordinary buttons, fields, dialogs, cards, tabs, and
  other base behavior.
- Native or specialized controls require the governed exception/ownership
  process.
- Keep business logic and feature state out of visual primitives.
- Do not extract a generic component merely because two screens look similar;
  shared behavior and a stable contract must justify the abstraction.

## Guidance Lifecycle

Pika's UI canon has four governed buckets:

- **Stable:** default rules for new work.
- **Experimental:** reviewable candidates that require human promotion.
- **Legacy:** active warnings about patterns that remain or were retired and
  should not be copied.
- **Open questions:** unresolved product choices that require judgment.

Family-specific stable guidance is authoritative only inside its named family.
AI may draft experimental or legacy guidance, but humans promote patterns into
stable guidance. Ordinary feature work must not silently redefine the design
system.

## External Widgets

External widgets must feel native without becoming coupled to Pika internals.

For the Pal achievement system:

- Pika owns the application shell, layout, typography, spacing, standard
  controls, accessibility expectations, semantic interface colors, themes,
  overlay allowance, and placement boundaries.
- Pal owns achievement artwork, badges, the pet, map illustration, rewards, and
  playful animation.
- The integration uses a small widget-scoped semantic custom-property bridge.
- Pal must not import Pika's stylesheet, Tailwind configuration, theme context,
  routes, or `@/ui` components.
- Pal must provide portable fallbacks and preserve reduced-motion behavior.
- Pika owns the outer dialog/drawer and approved overlay root; Pal must not
  portal to `document.body` by default.
- Pika approves pet placement and clearance; Pal owns the art and pose.

The public `--pal-*` contract and its drift tests should land with the bridge
after the actual `@pal/widget` package API is available for review.

## Change Governance

Before a non-trivial UI change:

1. Name the affected surface and the existing Pika reference it should resemble.
2. Declare roles, viewports, themes, and material interaction states.
3. Identify the primary visual signal and anything the change must not add.
4. State whether stable guidance is followed, experimental guidance is
   introduced, and human promotion is required.
5. Review the composite-widget accessibility checklist when applicable.

Changes to global principles, semantic tokens, canonical primitives, or stable
guidance require explicit human review. Token and primitive changes update their
documentation, contrast/semantic tests, and representative visual evidence in
the same change.

## Verification Contract

User-visible UI work is complete only after:

- focused semantic and behavior tests pass
- applicable contrast and UI-policy checks pass
- keyboard and focus behavior is verified
- desktop and mobile layouts are reviewed
- light and dark themes are reviewed
- teacher and student views are checked when both are affected
- loading, error, empty, forbidden, open, selected, and other changed states are
  checked when relevant
- reduced-motion behavior is checked when motion changes
- screenshots are captured and visually reviewed

Documentation-only changes declare the visual dimensions not applicable and
verify links, routing, hierarchy tests, and policy checks instead.

## Supporting References

- Component APIs and token usage: [`src/ui/README.md`](./src/ui/README.md)
- Executable tokens: [`src/styles/tokens.css`](./src/styles/tokens.css)
- Tailwind aliases: [`tailwind.config.ts`](./tailwind.config.ts)
- Governed UI canon: [`docs/guidance/ui/README.md`](./docs/guidance/ui/README.md)
- Stable guidance: [`docs/guidance/ui/stable.md`](./docs/guidance/ui/stable.md)
- UI change brief: [`docs/guidance/ui/change-brief.md`](./docs/guidance/ui/change-brief.md)
- Composite accessibility:
  [`docs/guidance/ui/composite-widget-accessibility.md`](./docs/guidance/ui/composite-widget-accessibility.md)
- Visual verification: [`docs/guides/ai-ui-testing.md`](./docs/guides/ai-ui-testing.md)
