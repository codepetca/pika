# Horizontal text fade

Owner direction, 2026-11-09. Use a fade wherever Pika clips display text
horizontally. This applies to plain text and labels with coloured backgrounds.
The classroom title in AppHeader is the approved reference. Pattern Lab
`#horizontal-text-fade` demonstrates fitting and overflowing text side by side.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Detect text that exceeds its width | AppHeader overflow measurement | extend | Share measurement across all horizontally clipped labels |
| Preserve the layout of clipped text | Existing truncation utilities | reuse | Keep sizing and native ellipsis when a fade cannot be applied |
| Keep interactive styling intact | Existing button and table label slots | reuse | Apply the fade to the label so focus and backgrounds remain visible |
| Show the outcome | Pattern Lab | extend | Use the same CSS and measurement as the app |

Use one shared browser observer for truncation labels and recheck them when
text, fonts, or layout change. Fade at the inline end, including for right to
left text. Keep full DOM text and existing tooltips, preserve native input
editing, and use ellipsis in forced colours. Leave vertically clamped content
and literal ellipsis symbols in their existing roles. Calendar applies the
horizontal rule to each lesson line independently while keeping every row.

Verify teacher and student, desktop and mobile, light and dark. Cover plain
text, chips and dense table labels, fitting text, overflow, resizing, keyboard
focus, Calendar lesson rows, and the forced colours fallback. The fade adds no
composite widget or motion. Risk profile is none.
