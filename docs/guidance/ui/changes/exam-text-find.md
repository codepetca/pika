# Exam text find

Scope: the active student exam workspace. Ctrl+F/Cmd+F and the document-header
Find button open an inline Find bar. It searches the test title, rendered
questions and choices, and every attached `text` reference. It excludes student
answers, PDFs, images, frames, and linked/uploaded documents. Matches in unopened
text references reveal that reference. Enter/Shift+Enter and the next/previous
buttons cycle matches; Escape closes Find and restores focus.

Risk profiles: exam-mode and workspace-state. The form stays mounted during
search and reference navigation. Find never suppresses focus, visibility, route,
resize, or fullscreen telemetry. The former timed native-Find exception is
removed. Locked exams hide Find and clear its highlights.

Reference: the existing ExamDocumentWorkspace document toolbar and Pattern Lab
Core controls. Primary signal: the selected text match, using the existing
primary solid and inverse-text tokens. Other matches use warning tokens.
No additional search sources, OCR, dependencies, or global overlays.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Search field and actions | FormField, Input, IconButton | reuse | Shared target size and focus behavior |
| Placement | ExamDocumentWorkspace | extend | Inline bar keeps search inside the exam |
| Matching and highlight state | exam-text-find utility and hook | create | Feature-owned logic, no shared UI business state |

Feature-owned executable evidence: `/pattern-lab?role=student#exam-text-find`.
This is a composition of existing primitives, not a new shared control contract.
CSS Custom Highlights style DOM ranges without modifying React-owned text or
student answer state. Modern browsers support highlights; matching and navigation
still work if highlighting is unavailable.

Verification matrix: student desktop (1440x900) and mobile (390x844), light/dark,
closed/open/focused Find, exam match, reference match, no matches, and locked
state. Teacher n/a: Find is opt-in only on the active student attempt. Existing
teacher workspace defaults remain unchanged. Composite review: labeled input,
44px tooltip-backed actions, Enter/Shift+Enter, Escape/focus return, and live
result count.
