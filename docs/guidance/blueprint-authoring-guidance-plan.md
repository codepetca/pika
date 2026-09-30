# Living blueprint authoring guidance

Status: release and existing-classroom adoption in progress, 2026-09-29. The Blueprint workspace was
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

- PR #1387 completed its specifically approved ninth independent review with no
  blockers on the stable head; exact-head CI is running. Its coordinator owns
  readiness, merge, and production promotion.
- Guidance adoption implementation uses migration 222. Replay and type generation
  run on a separate ephemeral database; shared local and production databases
  have not been migrated by this implementation task.
- Complete adoption review and final PR Gate, then follow the authorized release
  lifecycle. Applying migrations 221/222 requires exact target/filename approval.

## Independent guidance adoption implementation

- A nullable classroom guidance Version pointer inherits the Content Version
  until the teacher explicitly adopts guidance from the owned Blueprint Draft.
  The preview compares current and proposed rules, including unit exceptions;
  identical guidance is current even when other Draft content changed.
- Adoption saves/reuses an immutable Version with exact Draft revision checking,
  then atomically checks teacher ownership, the source Blueprint, both current
  Version pointers, archived state, and lifecycle fences. It changes only the
  guidance pointer. Untracked Tests/lessons do not block adoption.
- Teacher Blueprint shows separate Content Version and Guidance Version. Course
  titles, outline and copied assessment titles still come from Content Version.
  Guided drafting uses the selected Guidance Version, and signed previews bind
  both Version identities. Atomic creation rechecks both; the private sidecar
  retains the structural context identity and exact adopted rules.
- Archive roots retain the pointer; old archives default to inherited guidance.
  Existing private provenance rows default to their original single Version.
  Full content application clears overrides. Blueprint purge clears the pointer
  through its structural detachment; inventory digests and lineage fences include
  the new reference. Immutable Versions retain the normal deletion protections.

## Adoption verification evidence

- Clean isolated Supabase replay through migration 222; database types generated by
  the CLI and checked against a second machine generation. Shared local remains
  unchanged. Warning-level database lint reports no schema errors; ownership graph
  audit passes all 273 relationships.
- Real database contracts cover null fallback, untracked content preservation,
  stale actor/Blueprint/pointer/revision failures, archived/purging rejection,
  both concurrent lifecycle locks, effective rule binding, structural-context
  changes with unchanged guidance, archive root/default handling, content reset,
  and purge inventory/finalization. Archive codec/restore-plan tests preserve both
  identities and private rules. The historical standalone restore script requires
  retired Quiz tables and is not a current-schema harness; its direct run stops at
  that fixture precondition.
- Focused gate passed 3,518 tests plus architecture, UI/design policies, TypeScript
  and lint. Subsequent narrow context/preview checks passed 41 tests and archive
  restore-plan checks passed 17 tests. Desktop/mobile light/dark teacher screenshots
  and student exclusion evidence are recorded in the UI change brief.

## Existing ICS3U rollout

Read-only production checks on 2026-09-29 confirmed database migrations through
220. ICS3U-4 is Pika-managed at Draft revision 3 and its authoring guidance is
empty. P3 and P5 ICS3U both use saved Version 3, whose legacy snapshot has no
guidance. P5 has one untracked test; P3 has one untracked test and one untracked
lesson. The existing full classroom update proposal rejects those classrooms.

- Finish PR #1387 after its clean, specifically approved ninth review and
  exact-head CI. Its coordinator owns the final merge and production batch.
- Implement a separate, explicit guidance-only adoption path for existing
  classrooms. Preserve the classroom's content-copy Version and every
  assessment's lineage. Repointing `source_blueprint_version_id` by itself is
  insufficient: legacy tracked tests use equality with that Version to
  establish their lineage. Adopt an independently saved, teacher-owned guidance
  Version and keep each generated draft's private provenance immutable.
- Review, test, and release that adoption path. Any new migration requires
  exact target/filename approval, as does migration 221 from PR #1387. The
  production promotion must include a cumulative review and its own PR Gate.
- Save the agreed Markdown rules to the actual ICS3U-4 Draft, with course,
  assignment, test, and Unit 1 Java Karel sections. Include Instructions first,
  concise prompts, no navigation/solution hints, Markdown MC code, and vertically
  stacked world diagrams. Use revision-safe saves and verify persisted text.
- Explicitly adopt the new saved guidance for P3 and P5; verify unchanged
  assessment content and lineage, then generate teacher-reviewed test and
  assignment previews. Verify the rules reach model input and private
  provenance, and inspect the student-facing Markdown. Do not publish the
  verification drafts to students.

Completion requires production evidence for the actual course and both
classrooms. Earlier populated classroom screenshots used sample fixture data.
