# Living blueprint authoring guidance

Status: implementation in progress, 2026-09-28. Owner: the Blueprint authoring task on
`codex/blueprint-authoring-ux`. This plan tracks the complete goal; a polished
workspace alone does not satisfy it.

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
- Identify the real drafting entry points and whether existing AI Drafting can
  truthfully apply guidance or needs a new teacher-reviewed draft flow.
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

## Remaining release gates

- Verify the SQL migration and generate the database contract from a clean
  local stack. The shared local stack currently has an unrelated migration 218;
  this branch's new migration is also numbered 218 from current `origin/main`.
  Never treat a matching number as proof that its SQL has run. A one-time local
  instruction for the exact file was requested under the rollout checklist.
- Run the full focused check after updating all package-version test fixtures.
  Publish a draft PR, obtain independent fixed-SHA review, and complete PR Gate.
- Follow-up PR: connect classroom Test and Assignment creation to the frozen
  source Version guidance. The teacher-only Version reader is present, but the
  classroom creation UI currently opens an empty draft. The Blueprint AI
  Drafting path is the first working consumer. The classroom flow needs a unit
  picker, model request containing the frozen rules, an editable preview, and
  server-verified provenance on creation. Store provenance in a private sidecar
  row; existing `source_blueprint_version_id` tracks copied artifact lineage
  and must not be repurposed. Create the artifact, initial content, and
  provenance atomically. A read-only guidance notice alone does not establish
  that the rules shaped the draft.

Resolve these from the current source and migration contracts before changing
the schema. Record decisions and verification evidence here as phases land.
