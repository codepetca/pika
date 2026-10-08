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

## Student surface

The student tab is named **Grades**. It contains only:

- **Current grade**
- the supporting label **Based on returned work and Gradebook marks**
- a list of returned assignments and tests, and saved standalone Gradebook marks
- each item's score and percentage
- **Not counted** on a visible item excluded from the grade
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
  `Not counted` so students can reconcile the list with the current grade.
- The student calculation uses the same gradebook calculation rules as the
  teacher view, applied only to the eligible visible set.
- If no eligible visible marks exist, Pika shows no numeric current grade.
- `Current grade` is a live classroom calculation, not a report card mark or a
  promise about the final grade.

The student API must project this disclosure contract server-side. It must
not send the teacher Gradebook payload to the browser and rely on presentation
code to hide unreleased grades.

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
