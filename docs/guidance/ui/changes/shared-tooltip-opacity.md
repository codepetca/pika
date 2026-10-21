# Shared Tooltip opacity refinement

Owner-approved 2026-10-21 following audit PR #1649.

Surface: shared Tooltip, including header hover, IconButton keyboard hints, click/tap help, and interactive AssignmentArtifactsCell help. Reference: current Pattern Lab SplitButton fast opacity closing and semantic fast duration / standard easing. Teacher and student; desktop 1440×900 and mobile 390×844; light/dark; normal/reduced motion.

Primary signal: opacity only. Text position, font size and scale remain unchanged. Preserve Radix delay, hover grace, focus, description and chooser ownership. Closed content immediately loses description, accessibility, keyboard and pointer availability. Rapid reopen cancels old retirement; disabled, unmount and live reduced-motion changes retire immediately.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Trigger/delay/focus/hover | Tooltip / Radix | reuse | Existing working behavior |
| Entry/exit presentation and close fencing | Shared Tooltip | extend | Existing shared owner has multiple real adopters |
| Timing and visual reference | Fast duration, standard easing, Pattern Lab SplitButton | reuse | Existing Pika treatment |

Exclusions: mobile first-focus ancestor-scroll discovery finding remains separate; no global scroll-dismissal removal, chooser redesign, Tiptap Tooltip, new primitive/dependency, schema or production change. No stable canon promotion needed. Composite checklist reviewed: yes; direct semantic/keyboard tests and native browser verification required.

Acceptance: focused owner tests for actual pointerdown/click sequencing, keyboard/Escape/Tab descriptions, interactive closed semantics, rapid reopen, disabled/unmount, reduced motion and preference changes. Native 16-context role×viewport×theme×motion matrix plus interactive teacher checks, stationary text geometry, intermediate normal opacity, immediate reduced close and current reference comparison. Capture and inspect screenshots using Pika UI verify.

## Closing ownership

The live Radix Content unmounts at logical close, releasing descriptions, child effects and document dismissal handlers. Retaining that owner for a CSS exit would keep its Escape layer active, so exit uses a decorative copy of the current safe DOM instead. The copy strips IDs, roles, link destinations and focus/event attributes, is inert and aria-hidden, and freezes the live viewport bounds and current opacity. No React child owner or listener is copied. Unsupported widget/media/custom-element subtrees close immediately. Reopen, disable, hidden document, reduced motion and unmount cancel the bounded visual lifetime.

Pattern Lab's Tooltip motion example adds a deterministic availability toggle for both roles. The existing header, Formatting help and artifact table remain the primary real-owner references. No nearby component extraction is justified by this bounded change.
