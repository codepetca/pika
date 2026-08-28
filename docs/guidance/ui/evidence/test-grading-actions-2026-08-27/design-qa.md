# Design QA: Selected Test Grading Actions

## Comparison inputs

- Approved reference: `approved-open-design-reference.png`
- Desktop implementation: `desktop-light-default.png`, `desktop-light-selected-menu.png`, `desktop-light-ai-grade-scope.png`
- Mobile implementation: `mobile-light-default.png`, `mobile-light-selected-menu.png`, `mobile-light-ai-grade-scope.png`
- Theme checks: `desktop-dark-selected-menu.png`, `mobile-dark-selected-menu.png`
- Consequential global action checks: `desktop-light-close-all-confirm.png`, `mobile-light-close-all-confirm.png`

The approved reference and implementation captures were inspected together in a single comparison pass.

## Fidelity assessment

- Layout and spacing: passed. The cluster is centered independently of edge content, its chrome is flush to the controls, and the table begins directly beneath the context row. Header and row checkboxes share the same horizontal center.
- Typography and copy: passed. Production typography preserves the target hierarchy. The student-actions trigger, four menu terms, and AI scope terms match the approved language.
- Colors and tokens: passed. Access state uses semantic green/red plus switch position, lock icon, accessible name, and `aria-checked`; light and dark surfaces maintain contrast.
- Icons and shape: passed. Lucide icons match the existing Pika family, align within shared controls, and retain 44px interactive targets. No custom SVG or CSS-drawn asset substitutes were introduced.
- Responsiveness: passed at 1440 x 900 and 390 x 844. The primary cluster remains usable, menus stay inside the viewport above the sticky table layer, and long rows remain internally scrollable.
- States and behavior: passed for disabled/default, selected, menu-open, sorted/scrolled, Close All confirmation, AI scope prompt, and open/closed row-switch states. Keyboard Escape/focus behavior and semantic roles are covered by component tests.
- Accessibility: passed. Menus expose trigger relationships and expanded state, the action toolbar is named, row toggles use `role="switch"` and `aria-checked`, state is not color-only, and destructive/costly operations retain explicit confirmation or scope choice.

## Intentional differences from exploration

- AI scope uses the established modal dialog rather than an attached popover so the consequential regrade choice receives focus trapping and deliberate confirmation.
- The implementation shows a full realistic roster, production status indicators, and Pika's application tokens; the exploration board intentionally used a shortened comparison sample.

## Findings

No blocking or non-blocking fidelity defect remained after the final desktop/mobile light/dark pass.

final result: passed
