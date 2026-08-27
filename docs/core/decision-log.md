# Decision Log (Durable Summary)

This file captures **high-level, long-lived decisions** about Pika’s architecture and product behavior.
It replaces older prompt/spec history artifacts (which are intentionally not kept in the repo).

## Authentication Model
- Signup and login use **WorkOS Magic Auth** with an emailed six-digit one-time code.
- WorkOS owns credential verification and its encrypted browser session. Pika's HTTP-only `iron-session` cookie retains only the local UUID/role mapping and must match the verified WorkOS subject.
- The former password signup/login/reset implementation is retained temporarily behind `PIKA_LEGACY_PASSWORD_AUTH=true` as an explicit rollback and development override. It is never the implicit fallback for missing WorkOS configuration.
- Legacy passwords and verification/reset codes remain hashed with bcrypt while that override exists.
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
- Returned assignment and test results remain the student-facing grade surfaces. Pika will not add an aggregate student gradebook until the product contract defines returned-only disclosure, weighting, incomplete and hidden work, and how those totals relate to the teacher gradebook.
- Student names continue to be collected during classroom joining and read from `student_profiles`. Pika will not add standalone profile editing until one source of truth and synchronization behavior are defined for the global profile and classroom roster records.
- These are deliberate no-build decisions for the current product phase, not missing screens to infer from the teacher experience.

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
