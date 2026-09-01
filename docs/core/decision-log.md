# Decision Log (Durable Summary)

This file captures **high-level, long-lived decisions** about Pika’s architecture and product behavior.
It replaces older prompt/spec history artifacts (which are intentionally not kept in the repo).

## Authentication Model
- Signup uses **email verification codes**, followed by **password creation**.
- Login uses **email + password** (code-based login is not used for normal sign-in).
- Passwords and verification/reset codes are **hashed** (bcrypt).
- Sessions are stored in **HTTP-only cookies** via `iron-session` (secure in production, SameSite settings enforced).
- Teacher vs student is derived by policy (e.g., allowed domains and/or `DEV_TEACHER_EMAILS`).

## Timezone and Deadlines
- All deadline and “on time” calculations use `America/Toronto`.
- Attendance is computed against class days and entry timestamps in Toronto time.

## Classrooms and Rosters
- Teachers can manage **multiple classrooms** (not a single hardcoded course).
- Students join classrooms via **join code** (and/or join link).
- Rosters can be uploaded via CSV and are validated server-side.
- Class days are tracked per classroom, with calendar/holiday utilities to reduce manual teacher work.

## Attendance
- Attendance status is derived from data: a student is “present” when an entry exists for a class day; otherwise “absent”.
- Non-class days (`is_class_day = false`) are excluded from required attendance calculations.

## Student Grades and Profile
- Pika will add a minimal classroom-level student Grades surface. Teachers control it with one `Show grades to students` setting; when enabled, students see a current grade based only on fully graded, returned, included work plus the returned assignment/test list. Ungraded and unreturned work is ignored rather than treated as zero, and returned excluded work is labelled `Not counted`.
- Hiding the aggregate Grades surface does not retract feedback already returned inside Classwork or Tests. Returning work remains the only item-level release action. Reporting, attendance integration, trends, projections, comparisons, and additional publication controls remain outside V1. The full contract lives in [`docs/guidance/student-grades.md`](../guidance/student-grades.md).
- Student names continue to be collected during classroom joining and read from `student_profiles`. Pika will not add standalone profile editing until one source of truth and synchronization behavior are defined for the global profile and classroom roster records.
- Standalone profile editing remains a deliberate no-build decision for the current product phase, not a missing screen to infer from the teacher experience.

## Assignments and Online Editor
- Assignments belong to a classroom; student work is stored per (assignment, student) doc.
- Student docs are created lazily (on first open/save) to avoid pre-creating rows for every student.
- The editor autosaves and supports submit/unsubmit.
- Late detection is based on `submitted_at` vs `due_at`.
- Per-keystroke/editor history is explicitly **out of scope** for now (may be added later with an events table).

## Testing Strategy
- Core utilities are treated as “must be testable” and should have high coverage.
- Prefer deterministic tests for business logic; keep UI thin.

## AI-Assisted Development Workflow
- `.ai/START-HERE.md` defines the start-of-session ritual and end-of-session logging.
- `.ai/CURRENT.md` is the compact default continuity file.
- `.ai/SESSION-LOG.md` is a rolling recent session log, trimmed with `scripts/trim-session-log.mjs`.
- `.ai/JOURNAL-ARCHIVE.md` preserves full historical session continuity for historical investigation only.
- `.ai/features.json` tracks **big epics only** (append-only).
