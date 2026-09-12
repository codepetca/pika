# Remove a student from a class

## Current policy — final removal (migration 165)

The user superseded the reversible-removal policy below: removal carries no
recovery guarantee. A removed student cannot be re-added to the same class until
their old class data has been permanently purged. Add and CSV import now check
before any write or overwrite preview; migration165 blocks concurrent writes and
retires the old restoration RPC without reenrolling anyone. Historical and current
account emails both remain blocked while the retained identity exists.

Removal still only revokes access and hides the roster entry. It does not erase
academic records, files, attendance or Pal state immediately, start a purge, or
schedule future erasure. The existing safety-net cron resumes only previously
started permanent-deletion operations; it does not discover removed students.
Cleanup of removed students remains future work, so there is currently no UI
path to purge an already-removed student or lift their re-add block. A future
purger must erase the scoped records/files/provider state safely before releasing
the retained deny record. Accounts and other classes remain unaffected.

Apply migration165 before deploying the matching application. Migration164 is
immutable. The public database type shape is unchanged (the new guard is private
and existing public signatures are retained). No real-target migration or cleanup
is authorized by the implementation request. See the
[final-removal UI brief](ui/changes/final-student-removal.md).

## Historical implementation and verification — migration 164

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
After one-time owner authorization, migration 164 at commit `32aed6aa` was applied via SQL only to
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

Initial independent Sol/high and Terra/high review found three blockers: current
application archive actor definitions omitted the retained student, teacher re-add
could miss retained identity after an account email change, and Gradebook mark
checks needed to acquire removal locks before checking enrollment. Remediation
batch 1 updates those paths and adds regressions, including the legacy roster
query fallback. Renewed one-time permission was consumed applying revised164
(SHA256 `3a6db70c40ceb103b8627b53ef0856d0d9c1e95b7f144d117ea2c008a6f44cb8`)
to fresh schema-only disposable `pika_removal_164_7vacjt`. Removal/archive/email
regressions and separate grade insert/update races pass, database lint is clean,
and freshly generated types match. The grade-race fixture allows the existing
archive-revision trigger to wait before rejecting a post-removal mark.

Targeted review found the pre164 archive catalog audit also needed the verified
live actor-contract flag. Remediation batch2 threads that exact flag through the
catalog audit and tests old/new matching schemas plus mismatched/unexpected actors.
No SQL changed or was reapplied. Main's classroom join-controls change is included;
its joins still pass the removed-membership database guard. Final review and CI
remain required; shared/production databases are untouched.

Final integration identified historical orphan-score cleanup reachable through
the legacy invitation remover. The third correction replaces that delegation
with an exact-target invitation-only delete: removed or bound identities and
email-matched active memberships are rejected; student records are never deleted.
Regression coverage includes unrelated invitations and unbound re-add placeholders.
The owner approved one fresh disposable-local application of revised164 and two
additional reviews; this does not authorize production rollout or merge.

Targeted review cleared the third correction. Its one-time SQL application to
`pika_removal_164_djwzbp` succeeded with checksum
`e9c0abdf9426065815a5b2919d35f3aacb8739839f717bece9282f326b6d05b7`.
Full removal/archive/email/legacy-invitation/grade-race tests and the standalone
Gradebook archive/retention harness pass; lint is clean and generated types match.
Synthetic users were cleaned up. Shared postgres remains163 with no removal
columns; production is untouched. Final review and exact-head CI remain required.
