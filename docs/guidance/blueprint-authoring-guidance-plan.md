# Living blueprint authoring guidance

Status: implementation in progress, 2026-09-28. The Blueprint workspace was
merged to main in PR #1386. Classroom drafting is in draft PR #1387
(`codex/blueprint-classroom-drafts`). This plan tracks the complete goal.

## Goal

A teacher can set course-wide and unit-specific expectations for tests and
assignments in a Blueprint, see the exact guidance used for a draft, and improve
that guidance as the course evolves. The rules remain private to teachers and
travel with the Blueprint's reviewed, versioned course content.

## Phases and exit criteria

1. **Workspace.** The Blueprint has a clear, dedicated Authoring Guidance tab
   and simpler navigation for its existing content. The tab is honest about what
   is editable at this stage. Existing editing, proposals, and save guards keep
   working. Verify desktop and mobile, light and dark, keyboard, empty and error
   states.
2. **Owned guidance.** A teacher can edit course defaults and optional unit
   overrides for tests and assignments. Store them as structured guidance with
   an explicit revision, authorship, and review history. A save is conflict safe;
   another teacher or stale browser cannot silently overwrite a newer revision.
   Teacher-only API responses enforce privacy, and student/public course surfaces
   contain no guidance. Reusable package import/export and immutable Blueprint
   Versions retain the same rules. Existing packages import with empty guidance.
3. **Drafting context.** When creating a test or assignment from a Blueprint,
   select the relevant course and unit rules, show the teacher which revision is
   in effect, and include that context in the actual drafting input. Generated
   content stays a teacher-reviewed draft. A repeatable test proves that the
   authoring path consumes the approved guidance rather than merely displaying
   it beside a fixed template.
4. **Refinement.** A teacher can propose a rule change from an authoring review,
   inspect the old and new wording, and explicitly apply or reject it. Accepted
   changes become a new guidance revision; old drafts keep their provenance.
   A teacher can try revised guidance on a draft before applying it globally.
5. **Release.** Complete focused checks, migration replay and database contract
   checks, UI verification, and an independent review. Publish a draft PR,
   resolve findings, mark the stable reviewed commit ready, and wait for PR Gate.
   Merge only after the repository's normal authority gate. Applying a migration
   to any named environment requires a separate one-time instruction naming the
   exact migration, per the schema rollout checklist.

## Product rules to seed and preserve

The general Pika test guide remains the cross-course baseline. Course guidance
records teacher choices and subject conventions, not one quiz's length, points,
or topic as a universal default. For coding tests, rules can cover a first
student-facing `Instructions` reference, concise self-contained prompts,
language references, question visuals, Markdown-formatted code in multiple
choice, and prompt/rubric/sample alignment. Unit overrides may specialize the
course defaults without replacing them wholesale. Assignment rules must be
equally first-class.

## Open implementation decisions

- Store one strict structured `authoring_guidance` object on the teacher-owned
  Blueprint Draft. Snapshot it in Version schema 3, include it in Change
  Proposals, and export it as `authoring-guidance.md` in package v6. Legacy
  packages import with empty guidance. A classroom-derived proposal preserves
  the Blueprint's guidance; instantiation does not copy it to classroom rows.
- Classroom Classwork and Tests keep their existing blank creation actions and
  add a shared teacher-reviewed guided draft flow at those entry points.
- The teacher classroom sidebar has a Blueprint tab. Its content pane shows
  the frozen Version linked to that classroom, including its course outline,
  assessment titles, and private authoring guidance. The source Blueprint Draft
  remains the separately edited object; changes to it do not rewrite a saved
  classroom Version. Classrooms without lineage show an explicit empty state.
- Classroom drafting reads the frozen source Blueprint Version through a
  teacher-only endpoint. Its AI draft request must use that Version's rules,
  not the live Blueprint Draft. A draft records the Version and chosen unit
  separately from student-facing instructions/questions.

## Implementation notes

- Classroom capture and archived classroom reuse originate from classroom
  content, which has no authoring guidance. Their creation Version remains
  schema 2, and guidance reads it as empty. A later teacher edit belongs to the
  Blueprint Draft and enters a schema 3 Version only when that Version is saved.
- AI Drafting generates one new test or assignment using the saved Blueprint
  guidance and optional unit rule. It returns the exact rule text and Draft
  revision beside an editable preview. A proposal is rejected if that revision
  changed. AI review proposals retain the exact guidance text, unit choice,
  and Blueprint revision that supplied the draft. Temporary trial previews
  can use unsaved guidance but cannot be proposed until the teacher applies
  the rules and generates a new preview.
- Guidance edits are staged in the editor, compared with the saved revision,
  then explicitly applied or rejected. A prior history entry can be restored as
  a new staged change; history remains immutable.

## Classroom drafting implementation

- The teacher chooses a target, unit, and request, then edits the generated
  standalone Markdown before creating an unpublished draft. The model receives
  the classroom's frozen Version rules. A trial of unsaved Blueprint rules
  cannot create a classroom artifact.
- A signed preview proof binds the teacher, classroom, Version, unit, rules,
  and original generated draft. Edited Markdown is parsed and validated before
  creation. One-use `draft_id` prevents the same preview from creating twice.
- A private sidecar stores the frozen Version and exact rules used. Existing
  `source_blueprint_version_id` on Assignment and Test remains direct copied
  artifact lineage. Atomic database functions create the artifact, initial
  content, and sidecar in one transaction. The teacher editor shows a compact
  source note after reload; students only receive the assessment content.

## Remaining release gates

- Reverify the classroom drafting correction against the frozen guidance
  database contract, then complete its bounded independent review and focused
  checks on the stable PR head. Teacher and student visual checks have been
  completed for the guided creation flow.
- Replay migrations 218 through 220 from a clean isolated database, run the real
  database contract scripts and warning-level lint, and generate/check types
  in CI. Neither feature migration has been applied to the shared local stack;
  applying either to a named environment requires its own one-time permission.
- Mark PR #1387 ready only after review, wait for the exact-head PR Gate, and
  merge only after the repository's normal authority gate.
