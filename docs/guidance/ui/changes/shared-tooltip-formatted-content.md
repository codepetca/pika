# Formatted Tooltip consistency

Surface: shared Tooltip as used by Calendar announcement previews and collapsed classroom navigation. Reference: the reviewed stationary fast-opacity Tooltip from PR #1650, rendered with plain text and interactive artifact content in Pattern Lab. This pass follows that existing treatment; no new visual pattern or stable promotion.

Teacher and student; desktop 1440×900 / mobile 390×844; light/dark; normal/reduced motion. States: pointer/focus disclosure, formatted content, hover transfer, Escape/Tab/scroll dismissal, immediate navigation/announcement callbacks, passive exit and rapid reopen. Primary signal: existing opacity only, with fixed text geometry. Composite checklist reviewed: yes; direct descriptions, focus, immediate semantic retirement and action ownership required.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Disclosure, focus, delay and scrolling | Shared Tooltip / Radix | reuse | Preserve the established live owner and immediate dismissal. |
| Static formatted announcement exit | Shared Tooltip safe DOM copy | extend | LimitedMarkdown emits headings and blockquotes; these static elements should follow the same fade as plain content. |
| Navigation and Calendar composition | NavItems / LessonDayCell / AnnouncementContent | reuse | Verify actual owners with fixed fixtures and local callbacks. |
| Executable verification | Pattern Lab recovery section | extend | Keep new fixtures outside the stable catalog screenshot contract. |

Current-owner browser baseline: a plain announcement leaves a decorative exit; the same Calendar owner with headings and a blockquote leaves none. Both retire live semantics immediately. A regression using actual AnnouncementContent reproduces the missing exit. Admit only LimitedMarkdown's actual `h1`, `h2`, `h3` and `blockquote` elements; preserve widget/media/custom-element rejection, stripping, inertness and bounded lifetime. No new shared component, dependency, token or raw design value is needed.

The first mobile keyboard artifact hint is a separate open issue. Current-main reproduction confirms focus, ancestor scrolling, then hint retirement; settled refocus and chooser activation work. A one-frame Content gate would leave pending Escape/scroll without Radix's dismissal layer, and externally closing controlled Root would skip its provider reset. No product workaround is part of this pass. This is an unresolved finding, not an owner-approved deferral or product-wide completion.

Exclusions: changes to provider accounting, global scroll dismissal, chooser keyboard behavior, Tiptap, Calendar cell editing, schema and production. Verify the current four unchanged catalog goldens and both-role adopter matrix before publication. Preserve source/media provenance and the unsuccessful focus proposal as investigation evidence.
