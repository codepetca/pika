# Pika Design System

This is the canonical entry point for Pika product design.

It defines the durable principles, ownership boundaries, authority order, and
review contract for UI work. It does not duplicate executable token values,
component APIs, or workflow-specific guidance.

## How To Read This Contract

This file distinguishes between the product Pika already demonstrates and the
default contract for new or deliberately modified work:

- **Observed invariant:** repeated in implemented product surfaces and
  corroborated by recorded visual evidence. Historical captures are baseline
  context, not proof that a later implementation still conforms.
- **Stable contract:** the default for new work. Existing legacy surfaces may
  still diverge, but that divergence is not precedent.
- **Migration gap:** a named capability that is not yet portable or consistently
  adopted.
- **Family rule:** authoritative only inside the workflow family that owns it.
- **Governed legacy:** implemented compatibility behavior recorded in
  [active legacy guidance](./docs/guidance/ui/legacy.md) or an exception
  registry. Preserve it only within that scope; do not use it as precedent.
- **Experimental guidance:** a review-bound proposal in
  [`docs/guidance/ui/experimental`](./docs/guidance/ui/experimental/README.md).
  It is not a default until promoted.

Unmarked statements that use **must**, **do not**, or **new work** are stable
contracts, not claims that every historical surface already conforms. When an
implementation differs, classify it through governed legacy or experimental
guidance instead of weakening the system around a one-off pattern.

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

### Content and guidance

- Default screens show headings, labels, state, and actions. Do not add
  instructional paragraphs when the interface is self-evident.
- Put optional explanation in contextual help, such as a tooltip or help
  affordance, instead of permanent page copy.
- Use a dismissible one-time first-visit message when a workflow needs longer
  orientation.
- Keep placeholders short. Search placeholders use one or two words and do not
  enumerate searchable fields.
- Reserve persistent explanatory copy for risk, irreversible effects, errors,
  recovery, or important data boundaries.

### Observed visual language

Current executable owners and representative recorded teacher, student,
desktop, mobile, light, and dark surfaces support these invariants. Historical
capture sets must be refreshed before they can prove current conformance:

- Structure comes primarily from semantic surface changes, thin borders,
  spacing, and alignment. Strong elevation is reserved for overlays, active
  drag states, and other temporary foreground responsibilities.
- Blue is the common action, selection, link, and focus accent. Classroom
  gradients are scoped identity cues and must not become a second global color
  system.
- Application chrome and operational headings stay compact. Avoid
  marketing-scale type, ornamental section labels, or oversized empty space
  inside authenticated workflows.
- Controls and cards use modest shared radii. Pill shapes are for badges,
  statuses, and intentionally compact selectors rather than ordinary
  containers.
- Teacher tables and split workspaces prioritize scanning and adjacent
  inspection. Student work gives reading and authoring more room without
  introducing a separate visual language.
- Dark and light themes preserve the same hierarchy and component geometry;
  theme switching changes semantic values, not composition.

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

## Stable Foundation Contract

Semantic colors, portable foundation variables, and the canonical primitive
behaviors below are implemented. Adoption of page, control, motion, and overlay
owners remains incomplete across legacy surfaces. The rules remain the default
for new or deliberately modified work.

### Semantic color and themes

- App code uses semantic tokens such as `bg-page`, `bg-surface`,
  `text-text-default`, and `border-border`.
- Raw theme switching stays inside the documented design-system exceptions.
- All product UI supports light and dark themes.
- Theme-specific values live in `src/styles/tokens.css`; documentation and
  components reference their intent instead of copying values.
- Color is never the only carrier of status or meaning.
- Text and interactive states meet WCAG 2.1 AA contrast in both themes.
- The semantic-token contrast suite verifies its declared foreground/background
  pairs. Translucent composites, imagery, and feature-owned combinations still
  require visual and browser verification.

### Typography

- Use Pika's system sans-serif stack for application text and controls.
- Use monospace only when the content itself benefits from fixed-width glyphs,
  such as code, identifiers, or structured source text.
- Page and section heading hierarchy comes from shared page primitives rather
  than feature-local title scales.
- Components and embedded widgets inherit host typography unless a documented
  content-specific exception owns another typeface.
- `--font-family-ui` and `--font-family-mono` expose the implemented stacks for
  portable consumers. External widgets inherit by default and consume these
  values only through a reviewed host bridge, never copied declarations.
- The Tiptap editor remains a content-owned mini-platform exception. Its
  typography must not spread into ordinary application controls or shells.

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
- `PageLayout` implements named widths and teacher/student content rhythm, but
  legacy adoption remains partial. Existing feature-local widths are migration
  evidence, not options for new work.
- Density describes content rhythm and role needs; it is not a viewport
  breakpoint. Responsive mode comes from the available layout or container and
  must not be inferred from a teacher/student label.
- Canonical controls enforce the target contract. A native-control exception
  registry prevents silent count drift but does not prove target size, focus
  visibility, or responsive usability.

### Focus and keyboard behavior

- Every interactive element has a visible `focus-visible` treatment.
- Shared primitives own their normal focus ring, offset, disabled behavior, and
  target size.
- Composite controls follow their widget keyboard model, including roving focus,
  semantic state, disabled-item handling, Escape behavior, and focus return.
- Do not suppress an outline without providing an equally visible replacement.
- Canonical primitives own a primary-color focus treatment with a
  context-appropriate offset or inset ring. Portable focus colour, width,
  offset, and minimum-control tokens back those owners; older feature-owned
  controls still require direct verification.

### Motion and reduced motion

- Motion is restrained, purposeful, and normally 150–300ms.
- Prefer opacity, color, and small spatial changes over large or continuous
  movement.
- Motion must not be required to understand state.
- Every non-essential animation or transition has a reduced-motion path.
- Playful features may retain identity through static artwork and state changes
  when movement is reduced.
- Shared motion durations resolve to zero when the user requests reduced
  motion. Feature-owned animation that does not use those durations must
  provide its own equivalent media-query path.
- This is a stable contract, not a statement that current coverage is complete.
  Reduced-motion handling is still distributed and partial; an existing
  animation without an opt-out is debt, not precedent.

### Layers and overlays

- Global app chrome, popovers, dialogs/drawers, tooltips, transient status, and
  critical full-screen states are distinct layer responsibilities.
- Shared overlay owners manage portal placement, focus, background inertness,
  scroll locking, viewport containment, and focus return.
- Feature-local sticky table layers stay inside their own stacking context.
- Do not introduce a new global raw `z-index` or body-level portal when a shared
  owner exists.
- `ModalLayer` is the canonical current owner for document-level dialogs and
  mobile drawers. Several older fixed overlays remain governed migration debt.
- Portable layer-responsibility and light/dark scrim tokens back the shared
  owners. They do not grant feature code permission to choose a global layer.
- Overlay containment remains a behavioral boundary: new work reuses an
  existing owner, and external widgets accept a host-provided overlay root
  instead of portaling to `document.body`.

The portable foundation values live in `src/styles/tokens.css`; Tailwind only
adapts them. New work uses the semantic aliases documented in `src/ui/README.md`.
Existing raw values are governed migration evidence, not additional options.

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

Three-panel authoring, grading, and journal workspaces intentionally use the
named full-width mode. Do not constrain an operational workspace to a reading
width merely to make it resemble a conventional document page.

Utility routes should converge on shared application navigation and page-state
contracts incrementally. Existing utility-shell differences are migration
evidence, not a new design language to copy.

### Unauthenticated entry

Login, signup, verification, and recovery are intentional shell-light
exceptions. Use a centered, bounded form surface on the semantic page canvas
without authenticated application navigation. The shell framing is an observed
invariant; new or deliberately modified fields, controls, focus behavior,
themes, and state feedback follow the stable contract above. Current
feature-owned auth text controls remain registered migration debt under the
Phase 6 auth-verification owner and are not precedent.

### Page and workflow states

Loading, error, empty, and forbidden are different states:

- loading means the initial read is pending
- error means a required read failed
- empty means a successful read returned no records
- forbidden means the current identity cannot use the surface

Preserve the surrounding shell when possible. A failed read must not look like
an empty result. Use the shared page-state contract and bounded retry behavior.
`PageState` provides the canonical implementation, but legacy routes still
contain local or incomplete state handling and must not be used as references.

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

## External Widget Contract

External widgets must feel native without becoming coupled to Pika internals.
The Pika-to-Pal boundary below is confirmed as contract version 1. Pal owns the
machine-readable public property list and portable fallbacks; Pika owns the one
scoped adapter that maps those inputs to current Pika semantic tokens.

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

The public `--pal-*` contract is owned by
`@pal/widget/theme-contract`. While that package remains private and
unpublished, Pika vendors only the dependency-free manifest in
[`src/vendor/pal-widget-theme`](./src/vendor/pal-widget-theme) and maps it in
[`src/integrations/pal/pal-widget-theme.module.css`](./src/integrations/pal/pal-widget-theme.module.css).
The vendored manifest is temporary release plumbing, not a second authority.
Delete it and import the package contract directly when Pika installs a
published `@pal/widget`.

### Pal handoff packet

The host-to-widget handoff must contain:

1. this ownership contract and the relevant Pika reference surfaces
2. the reviewed public `--pal-*` property list with portable fallback values
3. one Pika adapter that aliases existing semantic tokens at the widget mount
4. a role, viewport/container, theme, focus, and reduced-motion verification
   matrix
5. contract tests that compare the widget's declared inputs with the Pika
   adapter

Contract version 1 communicates `theme`, `density`, `viewport`, and motion
preference as scoped provider values and `data-pal-*` attributes. The adapter
supplies semantic colours, inherited typography, radii, spacing, minimum target
size, focus, and motion values. Pika still owns the outer content and overlay
containers; no theme property grants Pal placement or portal authority.

The bridge should cover semantic surfaces, text, borders, actions, statuses,
typography inheritance, shared radii, spacing/density, minimum control size,
focus treatment, motion preference, and host-approved pet/overlay clearance.
Responsive state and density may be communicated through scoped custom
properties or data attributes, but Pal must not infer a Pika route, role, or
Tailwind breakpoint. Pal keeps its artwork and reward personality inside that
boundary.

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

New durable visual evidence must record its implementation commit, capture date,
route or surface, role, viewport, theme, and state. Existing capture sets that
predate this contract remain historical evidence only when their temporal
mismatch is explicit.

Raw colours, arbitrary spacing, and raw layer values in product TypeScript,
JavaScript, CSS, and SCSS require an exact, owned exception in
`scripts/design-value-exceptions.json`. CI covers Tailwind arbitrary syntax,
literal inline styles, and stylesheet declarations, and compares both counts
and fingerprints, so additions, removals, and same-count substitutions require
review. The canonical definitions in `src/styles/tokens.css` are the intentional
boundary: consumers are governed, while token values are reviewed through
semantic and contrast tests. An exception records migration or content
ownership; it does not promote the value into the design system.

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

Use a risk-matched verification matrix. Every relevant dimension must be
checked, while a non-applicable role, theme, viewport, state, or interaction may
be marked `n/a` with a reason. Do not claim exhaustive product coverage from a
representative capture set.

Documentation-only changes declare the visual dimensions not applicable and
verify links, routing, hierarchy tests, and policy checks instead.

## Design Conformance Loop

Use this loop when changing this file or validating a new design-system claim:

1. State the claim without a raw visual value or feature-specific recipe.
2. Identify the executable owner, or mark the claim as a migration gap.
3. Compare representative teacher/student, desktop/mobile, light/dark, and
   interaction-state evidence as applicable.
4. Classify the result as confirmed, executable-only, stable target, legacy
   exception, or unverified.
5. Update the correct authority: this file for cross-system principles, tokens
   for exact values, `src/ui` for behavior, scoped guidance for composition, or
   legacy guidance for a governed mismatch.
6. Rerun hierarchy, UI-policy, contrast, semantic/keyboard, and visual checks
   that cover the changed claim.

A rule is effective only when an agent can trace it to an owner, identify the
reference surface, and name how conformance is verified. Open Design boards and
screenshots make that review legible, but they remain evidence rather than
authority.

## Supporting References

- Component APIs and token usage: [`src/ui/README.md`](./src/ui/README.md)
- Executable tokens: [`src/styles/tokens.css`](./src/styles/tokens.css)
- Tailwind aliases: [`tailwind.config.ts`](./tailwind.config.ts)
- Governed UI canon: [`docs/guidance/ui/README.md`](./docs/guidance/ui/README.md)
- Stable guidance: [`docs/guidance/ui/stable.md`](./docs/guidance/ui/stable.md)
- UI change brief: [`docs/guidance/ui/change-brief.md`](./docs/guidance/ui/change-brief.md)
- Visual evidence record:
  [`docs/guidance/ui/visual-evidence-template.md`](./docs/guidance/ui/visual-evidence-template.md)
- Composite accessibility:
  [`docs/guidance/ui/composite-widget-accessibility.md`](./docs/guidance/ui/composite-widget-accessibility.md)
- Representative product evidence:
  [`docs/guidance/ui/product-experience-evidence-2026-07.md`](./docs/guidance/ui/product-experience-evidence-2026-07.md)
- Product experience audit:
  [`docs/guidance/ui/product-experience-audit-2026-07.md`](./docs/guidance/ui/product-experience-audit-2026-07.md)
- Visual verification: [`docs/guides/ai-ui-testing.md`](./docs/guides/ai-ui-testing.md)
