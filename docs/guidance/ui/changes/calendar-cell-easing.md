# Calendar cell text stability — 2026-10-20

Surface: Month grid opening/editing and click-away closing, with shared grid owner checks for Term and student views. Reference: approved Calendar disclosure and Pattern Lab continuous inspector. Primary signal: lesson text stays at the same position and size while the cell shell opens/closes with shared 200ms standard motion.

Keep grid typography, date header, event density and text padding constant during selection. Give LimitedMarkdown and ProseMirror the same feature-scoped typography and block spacing. Keep an inert preview visible during the editor's initial null render; hide it atomically when the editor DOM is ready. Animate complete cell geometry only. No opacity, snapshot copy or text entrance animation. The actual editor still retires immediately on close; focus, caret and save owners remain unchanged. Reduced motion remains immediate.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Stable cell content | LessonDayCell | extend | Selection adds space without resizing or repositioning lesson text |
| Preview/editor typography | Existing calendar-day-text editor style scope | extend | Match existing renderers inside Calendar only |
| Stable initial focus | RichTextEditor autofocus | extend | Calendar focuses without scrolling content inside the contracting shell; other consumers retain their default |
| Height lifecycle | useLessonCellMotion | extend | Measure full interior and wait for real editor readiness |
| Motion policy | Semantic standard timing/easing and reduced motion | reuse | Consistent shared Pika motion; no new tokens |

Verify teacher/student, desktop/mobile, light/dark, normal/reduced, Month open/close/click-away/rapid reversal, populated heading/list paragraphs, empty cells, event controls, focus and typing. Record per-frame text range positions, computed fonts and cell heights; text must remain anchored during geometry interpolation. Check Week/Term regressions and unchanged Pattern Lab references. Composite semantic/keyboard checks apply. Extend the existing editor autofocus contract with an opt-out from scrolling into view, used by both Calendar layouts; default behavior remains unchanged for other consumers. No new dependencies, business/API changes, production or migrations. Broad fluidity goal remains open; keep the local preview running.
