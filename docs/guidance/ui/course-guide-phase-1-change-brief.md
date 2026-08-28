# Course Guide Phase 1 UI Change Brief

## Acceptance target

- **Surface:** teacher and student classroom Course Guide tab and public
  `/actual/[slug]` Course Guide. Teacher authoring and guide controls live in
  the Course Guide pane; Settings no longer owns a duplicate guide surface.
- **Reference:** the scan-friendly public planned-course layout, the shared
  classroom shell, and the governed reading/page-state contracts in
  `DESIGN.md`, `src/ui`, and `docs/guidance/ui/stable.md`.
- **Affected roles:** teacher, student, and unauthenticated public visitor.
- **Required viewports:** desktop and mobile.
- **Required themes:** light and dark.
- **Key states:** classroom-ready, classroom-sparse, loading, failed load with
  Retry, teacher read/edit/section-selected/saving/error, guide-options dialog,
  archived read-only, private/public sharing, and public not found.
- **Primary signal:** a calm, single-page document hierarchy in read mode and
  quiet clickable section headings in teacher edit mode, coordinated by one
  top-centred floating action cluster. Classroom content, not editing chrome, should
  dominate the surface.
- **Must not add:** a Settings-owned duplicate editor, links from the guide to
  Assignments/Tests/Lessons, nested iframe scrolling, a second document scroll,
  decorative gradients, always-visible per-item controls, stacked card chrome,
  new raw design values, schema changes, or automatic Blueprint synchronization.
- **Composite widget accessibility review needed:** yes. The guide-options
  dialog must trap/restore focus and close with Escape; edit actions need clear
  names, semantic pressed/expanded state where applicable, and keyboard access.

## Contract

- User-facing `Syllabus` language becomes `Course Guide`; compatibility route,
  query, feature-visibility, and database identifiers stay unchanged.
- One `CourseGuideView` presentation renders the sanitized display model in the
  public route and authenticated teacher/student tabs.
- The display model contains only public-safe fields and honors every existing
  `actual_site_config` section flag.
- Curriculum overview and expectations, resources, assignments, Tests, lesson plans, and
  announcements render when enabled and non-empty. Empty enabled sections do
  not masquerade as load failures.
- The Course Guide is always available to enrolled students inside Pika and is
  built live from the current classroom. Public sharing is optional and only
  requires a public page address when enabled; the overview and other
  sections remain optional content choices.
- Teachers edit curriculum or ministry context, course purpose,
  expectations/rules, and rich links/reference material from Course Guide
  edit mode. The narrative is intentionally consolidated into one overview
  editor; resources use the existing rich-text editor. The compatibility
  outline record remains stored but is no longer a separate setting or
  rendered guide section.
- The teacher Course Guide pane owns section visibility, lesson-plan scope,
  optional public sharing, public address generation, and public-page access in
  one focused options dialog. The visible Course Guide Settings section is
  removed; a legacy `section=syllabus` URL falls back to General settings.
- Teacher read mode matches the student/public document. `Edit guide` enters a
  teacher-only mode where authored section headings are keyboard-clickable and
  inline editors replace only the selected section. A top-centred floating
  action cluster owns `Edit guide`, `Guide options`, and `Done`; public-page
  access remains inside Guide options.
- Course date ranges and lesson dates are omitted from the guide. Lesson plans
  remain in their classroom sequence without presenting the schedule as part
  of the student-facing document. Term labels are also omitted from the header
  so generated date-range labels cannot reintroduce course dates.
- Authenticated loading failures retain the classroom shell and expose a
  bounded Retry action.

## Verification matrix

| Dimension | Required coverage |
| --- | --- |
| Role | teacher, student, unauthenticated public |
| Viewport | desktop `1440x900`, mobile `390x844` |
| Theme | light and dark |
| States | ready, sparse, loading, retryable error, edit, section selected, saving/error, options open, archived, private/public sharing, public not found |

Stable guidance followed: yes. Experimental guidance introduced: no. Human
promotion needed: no. Global tokens or canonical primitives changed: no.
