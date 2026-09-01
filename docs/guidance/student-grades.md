# Student Grades

This document defines the minimal student-facing Grades contract for Pika.
It is intentionally smaller than the teacher Gradebook and is not a reporting
or analytics surface.

## Product intent

Pika gives teachers one place to grade work and gives students one trustworthy
place to see the grades that have been returned to them. The student surface
answers two questions only:

1. What is my current grade based on returned work?
2. Which returned assignments and tests make up that grade?

## Teacher control

Each classroom has one Gradebook visibility control:

**Show grades to students**

- The default is off.
- When off, the aggregate Grades area is absent from student classroom
  navigation.
- When on, students see the live returned-only view defined below.
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
- the supporting label **Based on returned work**
- a list of returned assignments and tests
- each item's score and percentage
- **Not counted** on a returned item excluded from the grade
- a link from each item to its existing Classwork or Test feedback

The list does not duplicate rubric feedback, response review, or submission
history. Those remain with the original work.

## Calculation and disclosure

- Only fully graded, returned, grade-included work contributes to the
  student-visible current grade.
- Ungraded, partially graded, unreturned, draft, and future work is ignored. It
  is never silently treated as zero.
- A zero contributes only when the teacher deliberately records and returns it.
- Returned work excluded from the grade remains visible and is labelled
  `Not counted` so students can reconcile the list with the current grade.
- The student calculation uses the same gradebook calculation rules as the
  teacher view, applied only to the eligible returned set.
- If no eligible returned work exists, Pika shows no numeric current grade.
- `Current grade` is a live classroom calculation, not a report card mark or a
  promise about the final grade.

The student API must project this returned-only contract server-side. It must
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

The product contract is approved. The paired teacher/student composition is
currently experimental and is rendered with deterministic fixtures in Pattern
Lab. See
[`docs/guidance/ui/experimental/student-grades-visibility.md`](./ui/experimental/student-grades-visibility.md).
