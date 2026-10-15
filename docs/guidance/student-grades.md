# Student Grades

This document defines the minimal student-facing Grades contract for Pika.
It is intentionally smaller than the teacher Gradebook and is not a reporting
or analytics surface.

## Product intent

Pika gives teachers one place to grade work and gives students one trustworthy
place to see returned work and saved Gradebook marks. The student surface
answers two questions only:

1. What is my current grade based on returned work and saved Gradebook marks?
2. Which returned assignments and tests, and saved standalone Gradebook marks, make up that grade?

## Teacher control

Each classroom has one aggregate Grades visibility control:

**Show grades to students**

- The default is off.
- When off, the aggregate Grades area is absent from student classroom
  navigation.
- When on, students see the live view defined below.
- Turning the control off does not retract grades or feedback already returned
  inside Classwork or Tests.
- There is no second item-level publication control. Returning an assignment or
  test remains the release action for that result.

Use `Show grades to students`, not `Publish`, in the interface. `Publish` can
imply that the teacher is creating a frozen snapshot, while this control changes
visibility for a live view.

The Gradebook **More actions** menu has **Compact 0-weight assessments**, on
by default. This classroom setting applies to the teacher Gradebook, its student
inspector, student Grades, and standalone Gradebook marks in Classwork.
Assessments with configured weight 0 stay visible in narrower columns or shorter
rows with muted text and a visible zero-weight label. Turning it off restores the
regular presentation. Positive-weight work excluded from the grade remains
visible as **Not counted**. Marks, calculations, exports, and assignment/Test
feedback are unchanged; retired hide preferences no longer hide assessments.

The setting uses `gradebook_compact_zero_weight_assessments` in the existing
`feature_visibility` JSON field; missing means true. Migration 267 extends the
dormant contextual metadata writer's strict allowlist and preserves omitted
settings for older clients, retaining migration 266's guards and legacy-key compatibility.
Migration 267 must precede enabling that writer with this application version.
The active legacy writer supports the setting without a schema change.
Migration application requires separate exact-target permission.

## Student surface

The student tab is named **Grades**. It contains only:

- **Current grade**
- the supporting label **Based on returned work and Gradebook marks**
- a list of returned assignments and tests, and saved standalone Gradebook marks
- each item's score and percentage
- **Not counted** on an excluded item, or **0 weight** on a compact zero-weight row
- a link from each assignment or test to its existing feedback; standalone
  Gradebook items remain non-link rows because they have no separate work page

The list does not duplicate rubric feedback, response review, or submission
history. Those remain with the original work.

## Calculation and disclosure

- Only fully graded, returned assignments and tests, and saved nonblank standalone
  Gradebook marks included in the grade, contribute to the student-visible current grade.
- Ungraded, partially graded, unreturned assignments/tests, draft, and future work is ignored. It
  is never silently treated as zero.
- A zero contributes when the teacher deliberately records it for a standalone item,
  or records and returns it for a Pika assignment/test.
- Visible marks excluded from the grade remain visible and are labelled
  `Not counted` (or `0 weight` in compact mode) so students can reconcile the list
  with the current grade.
- The student calculation uses the same gradebook calculation rules as the
  teacher view, applied only to the eligible visible set.
- If no eligible visible marks exist, Pika shows no numeric current grade.
- `Current grade` is a live classroom calculation, not a report card mark or a
  promise about the final grade.

The student API must project this disclosure contract server-side. It must
not send the teacher Gradebook payload to the browser and rely on presentation
code to hide unreleased grades.

The teacher Gradebook also shows assignment and test marks only after they have
been returned to that student. Unreturned marks, including Gradebook overrides,
are absent from assessment cells, the student inspector, calculated totals, and
class summaries. Submission statuses remain available. Test eligibility uses the
student's attempt return timestamp, not a classroom-wide Test return timestamp.
Standalone Gradebook marks and explicit final-grade overrides retain their existing
behavior.

## Explicitly outside V1

- charts and trends
- class average, rank, or peer comparison
- projections and what-if calculations
- category analytics beyond the returned assessment list
- attendance inside the Grades surface
- learning skills and work habits
- report cards, transcripts, or official reporting
- guardian or administrator views
- per-assessment visibility controls beyond the existing return action

Attendance remains in Attendance. Reporting may later consume Grades and
Attendance as separate trusted sources without expanding this V1 surface.

## Design status

The product contract is approved and implemented in the teacher Gradebook and
student Classroom. The Pattern Lab comparison remains as deterministic review
evidence and reuses the production visibility control and student grade view.
See
[`docs/guidance/ui/experimental/student-grades-visibility.md`](./ui/experimental/student-grades-visibility.md).

## Current standalone-item integration

Standalone Gradebook items are visible as soon as a teacher saves a nonblank mark.
No **Return marks** step is needed. Existing marks, including those never returned
under the previous behavior, follow the same rule. Editing marks or item details
updates student-visible records; clearing a mark removes it. Blank is absent and
an explicit zero remains visible.

These marks appear in the aggregate Grades surface when enabled and in the
**Gradebook marks** section inside the existing student Classwork summary when
Classwork is visible. This does not add attendance automation: participation,
Attendance, and external exams are manually scored standalone items. Pika
assignments and tests retain their existing return requirement. See
[standalone Gradebook items](./standalone-gradebook-items.md).
