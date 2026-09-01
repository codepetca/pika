# Exam document workspace refinement

Status: implemented and visually verified; feature-owned experimental composition.

## Change brief — 2026-08-31

- Surface: student live exam-mode document/questions workspace and the embedded/standalone teacher Test preview.
- Authority/reference: `DESIGN.md`, stable UI canon, the governed `WorkspaceSplitPane` separator contract, canonical `Button`, and the existing student exam/teacher preview as baseline evidence. Pattern Lab has no promoted exam-document composition; the user explicitly approved this feature-specific direction.
- Roles: student for the live attempt; teacher for Preview. The student-facing question/document content is shared, while exam lifecycle and telemetry remain owned by the student parent.
- Viewports/themes: desktop 1440x900 and mobile 390x844, light and dark.
- States: document list, document open, Back, 30/70 and 50/50 bounds, intermediate drag width, pointer drag, keyboard resize, double-click reset, focus entry/return, long title, text document, iframe document, unavailable document, no documents, reduced motion, fullscreen warning/restoration, and unsaved open-response preservation.
- Primary signal: one persistent document-pane header anchors the transition from `Documents` to Back plus the selected document title.
- Must not add: a literal shared-element/FLIP animation, new dependency, raw theme classes, another base control, a narrower questions pane than 50%, a mobile drag divider, form remounts, API/schema changes, altered submission/saving behavior, or changed exam incident semantics.
- Composite widget accessibility review: required for the split-pane separator. It must expose a name, vertical separator role, current/min/max values, pointer resizing, ArrowLeft/ArrowRight, Home/End, double-click reset, visible focus, and the shared 44px pointer target.
- Stable guidance followed: yes. New cross-product stable guidance: no. Human promotion required: only if this feature-owned composition is later proposed outside exam preview/attempt surfaces.
- Model recommendation: current Codex model — the work combines bounded React composition with exam-mode state-preservation and browser verification risk.
- Risk profiles: `exam-mode`, `workspace-state`.

## Ownership decisions

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Split structure and accessible divider | `WorkspaceSplitPane` | reuse | It owns the governed separator geometry, focus, pointer target, and semantic attributes. |
| Student questions and document rendering | `StudentTestForm`, `TestTextDocumentViewer`, existing eager iframe mounts | reuse | Preserve answer state, rendering behavior, and preload strategy. |
| Persistent list/open header | Existing duplicated exam document headers | extend | Keep one spatial anchor while retaining the established Back and document-title language. |
| Shared exam document composition | Student exam and teacher preview document workspaces | create | Two genuine adopters require the same list/view/header/layout contract; lifecycle and telemetry remain outside its narrow API. |
| Constrained resize behavior | Existing workspace resize convention | extend | Exam documents use a feature-specific 30–50% leading-pane range and 50% minimum questions width. |

## Behavior contract

- The list state uses 30% documents / 70% questions.
- Opening the first document uses 50/50; a dragged open-document width is remembered for the current mounted attempt/preview and reused on the next open.
- While a document is open, the leading pane is clamped from 30% through 50%; therefore questions remain 50–70%.
- Back restores the list to 30/70 without discarding the remembered open-document width.
- ArrowLeft narrows documents and ArrowRight widens them in 5% steps. Home selects 30%, End selects 50%, and double-click resets the open document to 50/50.
- Below the desktop breakpoint, no divider is shown and the existing narrow-screen information architecture remains unchanged.
- List and viewer remain mounted when hidden so link snapshots stay preloaded. `StudentTestForm` remains mounted through open, Back, resize, and fullscreen lock/restoration.
- Student document/resize interactions must not create false route, focus, or window/fullscreen incidents.

## Verification matrix

| Dimension | Result |
|---|---|
| Role | Passed in the actual student live-attempt flow and teacher Preview. |
| Viewport | Passed at desktop and 390×844 compact viewport. Compact verification found and corrected a collapsed document-body regression before the final pass. |
| Theme | Passed in light and dark. |
| Motion | The header uses a restrained opacity transition and exposes `motion-reduce:transition-none`; no positional shared-element animation was introduced. |
| Interaction | Pointer behavior is component-tested. Real-browser keyboard resize reached the 30% Home bound from 50%; semantic values, step keys, double-click reset, open, Back, entry focus, and focus return are covered by tests. |
| Content | Text and iframe/unavailable mounts are covered; actual text content, empty baseline, and the persistent active title were inspected. |
| Exam integrity | An unsaved live-exam response remained mounted and saved while opening the document. Eager iframe mounting, fullscreen entry/restoration, and telemetry suppression remain covered. |

## Final accessibility and validation note

- Composite-widget checklist reviewed: yes.
- Keyboard behavior covered: yes.
- Semantic state covered by tests: yes (`separator`, orientation, current/min/max values, accessible name, focus movement).
- Remaining manual accessibility follow-up: none.
- Focused component verification: 4 files, 60 tests passed.
- Repository focused gate: 15 files, 184 tests passed; architecture, UI policy, design policy, TypeScript, and lint passed.
- Pika audit: passed with no violations.
- Independent review: one non-blocking P2 was accepted and corrected; eagerly mounted inactive iframes are now hidden from both keyboard navigation and the accessibility tree, with two-frame regression coverage.
- Visual-only data: one temporary local Test, document, question, attempt, and draft were created for the real student/teacher flows and then removed; no existing records were changed.
