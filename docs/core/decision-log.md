# Decision Log (Durable Summary)

This file captures **high-level, long-lived decisions** about Pika’s architecture and product behavior.
It replaces older prompt/spec history artifacts (which are intentionally not kept in the repo).

## Ontario subscription launch policy (2026-09-26)

- Owner approved USD monthly/annual prices: Basic 9/99, Plus 19/199, Pro 39/399;
  fixed CAD prices: 13/139, 27/279, 55/559. Ontario first; active-classroom caps
  are 2/5/12. A 30-day Plus trial needs no card. AI quantities remain provisional
  at 30 trial runs total, 300 Plus/month and 1,000 Pro/month pending cost evidence.
- Cancellation uses Stripe's exact paid-through timestamp; failed renewals have
  seven days' grace. Downgrades/interval changes occur at renewal. Teachers choose
  retained classrooms; absent a choice, keep most recently active and archive
  the rest. This supersedes SUB-05's earlier no-automatic-archive rule.
- Archives and expiry preserve existing assignment completion, started test
  attempts under original limits, grading/export and data. Block new publishing
  and test attempts; missed schedules never auto-release after resubscription.
- SUB-05/SUB-08/SUB-09–15 in the [policy](../guidance/subscription-policy.md)
  record notifications, first-purchase refunds, allowance accounting and at least
  60 days' notice for planned subscriber migrations. New terms do not silently
  replace existing purchases. Runtime Pro remains 10 until reviewed implementation.
- Documentation only: no charge, runtime entitlement change, schema application,
  deployment or live enablement. Verify catalog/lifecycle/archive integration in
  Stripe test mode before any launch.

## Versioned paid offerings and subscriber transitions (2026-09-26)

- Before paid launch, bind each subscription and effective paid assignment to
  a preserved offering version, including price mapping and benefits. Publishing
  new terms must not silently rewrite existing purchases or renewals.
- Each future subscriber migration explicitly chooses grandfathering, a future
  renewal transition, or optional migration. Preserve already-paid terms,
  including annual terms, unless the subscriber chooses a confirmed change.
  No lifetime pricing promise or universal migration approach is approved.
- SUB-07/SUB-08 in the [subscription policy](../guidance/subscription-policy.md)
  own the requirements. The fixed plan writer still needs version support;
  this decision changes no existing account, charge or production behavior.

## Stripe subscription provider (2026-09-26)

- Owner selected Stripe for paid subscriptions. Follow SUB-06 and all existing
  payment-verification, proration and reconciliation rules in the
  [subscription policy](../guidance/subscription-policy.md).
- This selects the provider without changing tier limits or deciding prices,
  billing intervals, AI quantities, cancellation, downgrade or failed-payment
  rules. Billing implementation and live charges remain future work.

## Subscription automation and upgrade proration (2026-09-25)

- Routine subscription tier assignment is automated; the admin prototype provides
  read-only operational visibility. Paid upgrades within the same billing interval
  charge the difference for the remaining paid period and keep the renewal date.
  Higher-tier access follows verified successful payment.
- The canonical [subscription policy](../guidance/subscription-policy.md) records
  these requirements and future change rules. Prices, grace, refunds, downgrade
  timing, and AI allowance treatment remain open decisions. Stripe was selected
  on 2026-09-26 (see above).
  This is product direction, not billing implementation or launch authorization.

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

## Gradebook Categories

- Classroom grades use teacher-defined categories whose course percentages total 100. The initial configuration is Attendance 10%, Term 65%, and Final 25%, with Term as the default category.
- Assessment weights are relative within a category. New assessments inherit the default category and its default assessment weight; teachers can override both per assessment.
- Deleting a category leaves its assignments and tests as Uncategorized. Uncategorized, draft, and excluded assessments do not contribute to the aggregate course grade.
- Running grades omit categories without qualifying scores for that student and renormalize the remaining configured percentages. The full calculation contract lives in [`docs/guidance/gradebook-categories.md`](../guidance/gradebook-categories.md).

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
