# Experimental Calendar Chip Movement

Status: experimental; human promotion required before production adoption.

## Question

Can Pika let teachers move any date-bearing calendar chip without obscuring the
different scheduling rules owned by Assignments, Announcements, Tests, and
lesson plans?

## Prototype Surface

The development-only Pattern Lab Calendar mockup renders deterministic chips
inside the existing Calendar page framing. It performs no API or database
writes.

## Candidate Interaction

- A movable chip is its own drag handle.
- Pointer movement lifts the chip and marks the destination day with an accent
  outline and the visible label `Move here`.
- Keyboard movement uses Space to pick up/drop, arrow keys to move by day or
  week, and Escape to cancel.
- The chip moves optimistically while `SaveStatus` reports the simulated save.
- A failed simulated save restores the original day and reports
  `Move failed — restored`.
- Historical or immutable dates stay visible but locked, with a reason exposed
  through the control label and tooltip.

## Fixture Semantics

| Chip | Prototype date meaning | Movable |
|---|---|---|
| Assignment | Due date | Yes |
| Scheduled announcement | Scheduled publication date | Yes |
| Published announcement | Original publication date | No |
| Test | Proposed test calendar date | Yes, prototype only |
| Lesson plan | Lesson date | Yes |

The Test date is deliberately exploratory. Production adoption still requires
a domain decision and persistence contract.

## UI Change Brief

- Surface: development-only Pattern Lab Calendar page mockup
- Reference: production `LessonCalendar` geometry, existing Calendar action bar,
  and Pika's existing `dnd-kit` reorder interactions
- Affected roles: teacher prototype; student production UI is unchanged
- Required viewports: desktop and mobile
- Required themes: light and dark
- Key states: default, hover/focus, drag target, saving, failed rollback, locked
- Primary signal: lifted chip plus labeled accent outline on the destination day
- Must not add: production mutations, schema fields, live data, or new dependency
- Composite widget accessibility review: required

## Open Questions Before Production

- Whether moving a Test means its due date, opening time, or a new calendar-only
  date.
- Whether lesson-plan movement may replace, merge with, or be rejected by an
  occupied destination.
- Whether drag should be limited to future dates and active class days.
- Whether a move needs undo beyond immediate failed-save rollback.
