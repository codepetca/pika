# Remove a student from a class

User-approved scope: removal revokes classroom membership and hides the student
from the active roster. It preserves their account, other classes, academic
records, attendance history, managed files, and Pal progress. Permanent erasure
is a distinct operation with its existing provider safeguards.

## Implementation

The teacher selects one or more rows, chooses Remove student(s), and confirms
Remove from class. A single server/database transaction retains enrollment
history, marks the roster rows removed, and deletes active enrollments. Success
removes those rows from the displayed roster; failure leaves them visible with
an inline retryable error. There is no background purge or Pal request.

The preserving RPC is separate from the legacy destructive removal RPC. The new
API never falls back to that old RPC, including before the migration is applied.
Stable roster bindings identify the student even after their email changes.
Removed roster records are retained as historical records, not invitations.
Student joins must not restore them implicitly. Teacher re-addition is explicit.

Physical enrollment removal preserves the existing membership checks used by
student classroom APIs, tests, assignments, history, and contextual access.
Manual attendance marks live on enrollments and must be copied to retained
roster history before deleting the enrollment. Gradebook marks must keep their
student/classroom/assessment integrity without requiring an active enrollment.
Classroom archives must preserve and restore the retained fields.

Permanent erasure remains separately labeled. It is not implied by removing
membership. Pal-backed erasure and erasure of already-removed students remain
future work; this change must not advertise either as completed or queued.

## UI brief

- Surface: teacher Roster, Student Actions menu, removal confirmation.
- Reference: existing roster confirmation, shared ConfirmDialog overlay owner,
  Pattern Lab dialog demonstration, Attendance/Test selection composition.
- Roles: teacher menu/confirmation; student classroom access boundary.
- Viewports/themes: desktop 1440x900 and mobile 390x844, light and dark.
- States: selected menu, open confirmation, pending request, failure, success;
  student has no teacher actions and cannot use a removed membership.
- Primary signal: explicit action and confirmation text; no new decoration.
- Reuse: shared ConfirmDialog and AppMessage. Extend the existing feature-owned
  Student Actions menu. No new shared primitives or experimental patterns.
- Composite review: keyboard selection, menu navigation, dialog focus, Escape,
  and meaningful focus after the selected row is removed.

## Verification and rollout

Require API permission, request validation and missing-migration regressions;
database fixtures preserving marks/work/Pal/manual attendance, binding safety,
retry, cross-class isolation, joins, restoration and active-operation conflicts;
the required teacher/student visual matrix; generated types and archive checks;
and independent review before marking the draft PR ready.

The schema migration must be reviewed and applied before enabling actual class
removal. Migration application requires separate authorization naming the exact
target and migration. No production migrations or student-data mutations are
authorized by this implementation request alone.

Current verification: the focused gate passes plus TypeScript, lint,
architecture and UI/design policy checks; separate migration source contracts
also pass. Teacher removal and separate deletion visual scenarios pass in
desktop/mobile light/dark (desktop-light rerun after a local navigation timeout).
After one-time owner authorization, migration 164 was applied via SQL only to
the disposable local `pika_removal_164_wgvpf4` database on 2026-09-11. The source
001–163 public/private schema was checked for exact equality before application;
no student records were copied. The removal/restore fixture, removed-student and
Gradebook archive round trips, cross-class/email-change checks and competing-lock
probes pass. Database lint found no errors or warnings. Generated types were produced and
independently compared using Supabase's generator against that database; the
normal `--local` wrapper targets the deliberately unchanged shared database.
The shared database remains at 163. CI will perform clean migration replay and
the standard generated-types check. Keep the PR draft until independent
high-risk review and all required checks are complete.
