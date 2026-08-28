# Course Guide Phase 2 UI Change Brief

## Acceptance target

- **Surface:** teacher Course Guide edit mode, starting from `Guide options` and
  continuing through the `Import curriculum` assistant.
- **Reference:** the existing Course Guide options dialog, authored-content
  field, page-state, and confirmation patterns.
- **Affected roles:** teacher. Student Course Guide presentation is unchanged
  and must not expose import controls.
- **Required viewports:** desktop and mobile.
- **Required themes:** light and dark.
- **Key states:** Guide options entry, PDF source, public URL source,
  extracting, retryable extraction failure, editable cited draft, explicit
  confirmation, apply conflict, and applied success.
- **Primary signal:** a three-step source → review → confirm progression with a
  clearly labeled source citation and one final apply action.
- **Must not add:** Blueprint/classroom synchronization, persistent imported
  drafts, automatic apply, silent replacement of teacher content, a Settings
  duplicate, hosted migrations, raw theme classes, or new visual language.
- **Composite widget accessibility review needed:** yes. The assistant uses the
  shared dialog focus/keyboard contract, exposes source choice with
  `aria-pressed`, names the source group, exposes the current step, and keeps
  error/status text semantic.

## Contract

- The import is a one-time assistant. Pika does not retain the uploaded file or
  create a synchronization relationship with the source.
- A teacher may upload a PDF up to 4 MB (below the hosting request limit) or
  provide a public HTTPS document URL. The server authorizes classroom mutation
  before reading the source metadata.
- Extraction produces only an in-memory, schema-validated draft containing a
  curriculum overview, expectations, useful source links, and source
  provenance. The source is treated as untrusted content; extraction has an
  application deadline and output cap.
- The teacher must reach an editable review state and a separate confirmation
  state before apply is available.
- Apply appends the reviewed draft below the classroom's current overview. It
  compares the expected current overview before writing and returns a conflict
  if another edit landed during review.
- Source provenance is normalized to one line and bound to the teacher and
  classroom with an expiring signed token. The exact locked citation is shown
  during review and confirmation, then attached server-side on apply.
- Extraction, validation, or apply failures leave the classroom Course Guide
  untouched and provide bounded retry guidance.
- The live classroom remains the Course Guide source of truth. No Blueprint or
  external-source synchronization is created.

## Verification matrix

| Dimension | Required coverage |
| --- | --- |
| Role | teacher import flow; student isolation |
| Viewport | desktop `1440x900`, mobile `390x844` |
| Theme | light and dark |
| States | source, review, confirm, extraction failure, student guide |

Stable guidance followed: yes. Experimental guidance introduced: no. Human
promotion needed: no. Global tokens or canonical primitives changed: no.
Composite widget accessibility checklist reviewed: yes.
