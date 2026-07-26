# Course Blueprint Identity And Versioning

This document is the authoritative product and engineering contract for stable
Course Blueprint identity, immutable Blueprint Versions, classroom provenance,
and change proposals.

It extends the portable package contract in
[`course-blueprint-packages.md`](./course-blueprint-packages.md). Course
Blueprints are reusable course structure, not classroom backups.

## Product Vocabulary

- **Course Blueprint** is the persistent, evolving reusable course.
- **Blueprint Draft** is the one editable state of a Course Blueprint.
- **Blueprint Version** is an immutable snapshot of the complete Blueprint
  Draft at a point in time.
- **Artifact ID** is the stable UUID of one logical reusable course artifact
  across Blueprint Versions, Course Packages, repositories, and classrooms.
- **Course Package** is the portable representation of a Blueprint Draft or
  Blueprint Version.
- **Change Proposal** is a validated set of operations against an expected
  Blueprint or classroom structural revision.
- **Classroom Archive** preserves a live classroom. It is distinct from a
  Course Package and Blueprint Version.

`Course Definition` is not product vocabulary. Internally, immutable version
content may be called a snapshot.

## Main Invariant

The Course Blueprint is the complete, versioned, portable source of reusable
classroom structure. A classroom is:

```text
Blueprint Version
+ classroom configuration
+ local reusable-content overrides
+ operational and student/runtime state
```

Only Pika mutates classroom records. Repositories, Course Packages, classroom
promotion, and AI submit Change Proposals that Pika validates and a teacher
reviews before application.

## Content Boundary

### Reusable Blueprint content

- course metadata, overview, outline, and reusable resources
- units, outcomes, intended sequence, and relative pacing when those domains
  are introduced
- assignment definitions, instructions, submission requirements,
  authenticity-tracking defaults, points, grading weights, and relative due
  timing
- Test definitions, questions, reference documents, answers, and grading
  configuration
- lesson templates
- ungraded classwork materials
- survey definitions, questions, and reusable result-display behavior
- gradebook mode and assignment/Test category weights
- reusable public-site defaults and visibility policy

Tests, answers, and teacher-only resources remain reusable Blueprint content
but retain teacher-only visibility.

### Classroom-only configuration and runtime state

- classroom title, join code, roster, enrollments, and teacher membership
- actual dates, calendar exceptions, release state, and availability windows
- submissions, Test attempts, grades, feedback, attendance, and accommodations
- live announcements
- classroom-owned document snapshots and storage objects
- actual public-site slug and publication state

The reusable projection of a classroom artifact must exclude classroom-only
fields before hashing, comparison, package generation, or model egress.

## Identity Model

Database row identity and portable logical identity are separate:

```text
Blueprint assignment row
  id: database row UUID
  artifact_id: stable logical UUID

Classroom assignment row
  id: classroom row UUID
  source_artifact_id: originating logical UUID
  source_blueprint_version_id: originating immutable version UUID
```

The same rule applies to assignments, submission requirements, Tests, Test
questions, Test documents, lesson templates/plans, classwork materials,
surveys, and survey questions. Future independently editable units, outcomes,
rubrics, and named resources must adopt the same contract.

Singleton sections use permanent semantic identities instead of random UUIDs:

- `course.overview`
- `course.outline`
- `course.resources`
- `course.grading`

### Artifact ID rules

- UUIDv4 is the canonical format.
- Editing, renaming, moving, package round-tripping, versioning, and classroom
  instantiation preserve the Artifact ID.
- Duplicating an artifact creates a new Artifact ID.
- Forking an independent Blueprint creates new Artifact IDs and may retain the
  prior IDs only as optional origin metadata.
- Restoring an archive preserves the original IDs.
- Artifact ID uniqueness is scoped to a Blueprint lineage so importing the
  same package as an independent copy cannot collide.
- Missing, malformed, or duplicate IDs in the current package format fail
  validation. Legacy packages receive IDs once during import.
- Application code never infers identity from title or position after stable
  IDs are available.

## Blueprint Drafts And Versions

A Course Blueprint has exactly one editable Draft. Saving a Blueprint Version:

1. loads one revision-consistent Draft graph;
2. validates all reusable content and Artifact IDs;
3. creates a canonical deterministic snapshot;
4. stores its SHA-256 digest and source metadata;
5. assigns the next monotonically increasing version number; and
6. never mutates that Version again.

Creating a classroom from a Draft first saves or selects an immutable Blueprint
Version. A classroom always records the exact Version it used.

The portable package format version is independent of a teacher's Blueprint
version number.

## Classroom Provenance

Instantiation preserves lineage at every reusable artifact boundary:

- the classroom records its source Blueprint and Blueprint Version;
- each copied artifact receives a new classroom row ID;
- each copied artifact records the source Artifact ID and Version;
- the source reusable projection digest is recorded or recoverable from the
  immutable Version snapshot.

Existing classrooms for which Pika cannot prove artifact identity are marked
unmapped. A title or position match may be offered as a teacher-reviewed
mapping, but must not silently establish provenance.

## Structural Revision

Blueprint Drafts and classrooms expose monotonically increasing structural
revisions. A structural revision changes only when reusable structure changes.
Operational events such as grading, submissions, attendance, publication, or
availability do not create reusable Blueprint changes. Raw classroom dates
remain classroom-only, but a due-date or lesson-date edit increments the
classroom structural revision because it changes the reusable relative pacing
or ordering produced by the classroom-to-Blueprint projection. Test-draft
wording likewise increments the structural revision.

Every Change Proposal declares the exact revision it was built from. Applying
a proposal against a different revision fails closed as stale. Retrying
requires rebuilding or explicitly reviewing the proposal against current
state.

## Change Proposals

There is one authoritative Blueprint Draft and any number of proposals.

Proposal sources are:

- classroom promotion
- Course Package or CLI external editing
- connected repository
- Pika AI
- an immutable Blueprint Version updating a linked classroom

Initial proposal operations are intentionally structured and bounded:

- add, update, move, archive, or restore a reusable artifact
- update a singleton section
- update reusable course metadata or settings

Proposal states are:

- `ready`
- `needs_review`
- `conflicted`
- `stale`
- `applied`
- `rejected`

Application is atomic and idempotent. A failed proposal cannot partially update
the Blueprint or classroom.

### Updating an existing classroom

The teacher selects a linked classroom and asks Pika to prepare an update.
Pika saves or selects the exact current Blueprint Version, projects the
classroom's reusable structure, and creates a classroom-targeted proposal. The
proposal records:

- the immutable Blueprint Version and Draft revision;
- the classroom structural revision;
- the classroom start date and ordered class-day dates used to materialize
  relative assignment and lesson timing;
- structured operations and a content-addressed classroom write plan.

Application fails closed if the classroom structure or calendar guard changed.
It updates only reusable structure and advances the classroom structural
revision once. Actual release state, availability, student work, grades,
attempts, responses, and storage ownership remain untouched.

New top-level classroom artifacts without proven Blueprint lineage must be
promoted or explicitly reconciled before Pika prepares the inverse update.
This prevents a Blueprint apply from silently overwriting local additions or
creating ambiguous mixed-classwork ordering.

## Source Authority

Each Blueprint has one authority mode:

- `pika`: Pika and in-app AI may edit the Draft; external inputs are proposals.
- `repository`: repository synchronization materializes the Draft; Pika,
  classrooms, and AI submit proposals intended for the repository.

Connecting a repository requires one explicit reconciliation. Authority is
never inferred from a package import.

## External Editing Sessions

The first repository workflow is pull–edit–propose–apply, not continuous
bidirectional synchronization:

1. review reusable classroom improvements;
2. pull a package at an exact structural revision;
3. edit externally;
4. submit a proposal containing the expected revision;
5. review and apply through Pika.

If reusable classroom or Blueprint structure changes after the pull, Pika
rejects the proposal as stale. Normal teaching and runtime activity continue.

## Live-Classroom Safety

- New assignments, Tests, materials, and surveys enter classrooms as
  unpublished drafts.
- Repository, package, or AI input never publishes content.
- An attempted Test is not overwritten; an accepted update creates a new
  unpublished draft successor while the historical Test remains intact.
- A survey with responses follows the same successor rule.
- A submitted or graded assignment is not overwritten; an accepted content
  update creates a new unpublished draft successor.
- A graded or submitted assignment is not deleted; removal becomes an archive
  proposal. Applying it retires the artifact from future Blueprint sync without
  deleting the historical classroom row or its runtime data.
- Changes to already published instructions require explicit review.
- No proposal contains students, submissions, grades, attendance, attempts,
  accommodations, or classroom-owned storage references.

## Compatibility And Rollout

- Additive schema changes and deterministic backfills land before application
  code requires the new fields.
- Existing package versions remain import-only compatibility boundaries.
- The first identity-aware package export uses a new package format version.
- Legacy imports generate Artifact IDs; every later export preserves them.
- Generated database types come from a replayed migration schema and are not
  hand-edited.
- Migration application remains human-controlled under the schema rollout
  checklist.

## Required Verification

- rename and reorder preserve Artifact IDs;
- duplicate creates a new Artifact ID;
- package export/import/export preserves all IDs and canonical content;
- malformed, missing, and duplicate current-format IDs fail validation;
- legacy package import generates valid unique IDs;
- classroom instantiation preserves source lineage while creating new row IDs;
- structural revisions ignore runtime-only changes;
- stale proposals cannot write;
- atomic proposal failures leave no partial graph;
- student/runtime data and classroom storage ownership never enter packages,
  snapshots, proposals, logs, or AI context;
- classroom archive and restore preserve provenance;
- attempted Tests and submitted/graded assignments cannot be destructively
  replaced.
