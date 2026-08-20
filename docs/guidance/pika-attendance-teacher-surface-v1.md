# Pika teacher attendance surface v1

Status: native read/command UI slice implemented locally behind the disabled
integration boundary; real Pika-to-Bara development round trip remains gated
on an explicitly authorized migration target and hosted configuration.

## Outcome

Attendance is a native Pika classroom tab. A teacher signs in to Pika once,
opens the tab, and sees a Pika-owned projection of the Bara attendance session
for the selected class day. Pika authorizes every teacher action and sends it
through the versioned server adapter; the browser never imports Convex types,
calls Convex, or depends on a Bara database identifier.

The existing `TeacherAttendanceTab` is a useful table and work-surface
reference, but it currently renders Daily-log completion from
`/api/teacher/logs`. The attendance implementation must replace that data model
rather than relabeling Daily participation as attendance.

## UI change brief

- Surface: a dedicated Attendance tab beside the existing Daily tab in the
  classroom sidebar and main pane.
- Reference: the current Daily-style student table, teacher work-surface shell,
  date navigator, selection behavior, and floating action controls.
- Affected roles: teacher. Student QR is a separate surface and phase.
- Required viewports: desktop and mobile.
- Required themes: light and dark.
- Primary signal: one session-state treatment (`scheduled`, `open`, `closed`,
  or `unavailable`) paired with the existing table status cells.
- Must not add: a Bara iframe, a second sign-in prompt, provider identifiers,
  duplicate summary chrome, email addresses, or a competing navigation shell.
- Composite widget accessibility review needed: yes, for multi-select rows,
  bulk status commands, the session-controls FAB, and the QR dialog.

This is a refinement of the existing teacher work-surface pattern, not a new
application embedded in Pika.

## Teacher flow

1. The teacher opens a classroom and selects **Attendance**.
2. Pika selects today’s class occurrence from its class-day schedule. A date
   navigator allows review of another class day.
3. The main pane shows the roster with each student's projected attendance
   status and the session's last confirmed update from Bara.
4. Pika has already materialized the teacher-local attendance policy into a
   concrete UTC open/close window. Bara opens and closes the session
   automatically.
5. The FAB shows controls appropriate to the state: show/share QR while open,
   open or close as an explicit override, retry/reconcile when stale, and view
   lifecycle activity.
6. The teacher can select one or many students and mark or correct attendance.
   Pika sends a bounded command through the Bara adapter and keeps the rows in a
   pending state until the authoritative event or snapshot revision arrives.
7. Bara lifecycle and record events update Pika's inbox and projection. The
   page refreshes from Pika data; it does not subscribe to Convex directly.
8. Closed sessions remain reviewable. Corrections are explicit commands and
   remain auditable in Bara.

## Server-facing view model

The client will consume the Pika-owned
`GET /api/teacher/attendance/session?classroom_id=…&date=YYYY-MM-DD` route. Its
closed shape is:

```ts
type TeacherAttendanceView = {
  classroomId: string
  classDate: string
  integration: 'disabled' | 'not_configured' | 'ready'
  session: {
    state: 'not_scheduled' | 'scheduled' | 'open' | 'closed' | 'cancelled'
    opensAt: string | null
    closesAt: string | null
    revision: number | null
    commandFailed: boolean
  }
  sync: {
    state: 'current' | 'pending' | 'stale' | 'unavailable'
    confirmedAt: string | null
  }
  students: Array<{
    studentId: string
    firstName: string
    lastName: string
    status: 'unmarked' | 'present' | 'absent' | 'late'
    source: 'student_qr' | 'staff' | 'system' | null
    revision: number | null
    pendingCommand: boolean
    commandFailed: boolean
  }>
}
```

`studentId` and `classroomId` are Pika IDs used only inside Pika. The Pika
server resolves them through private durable roster, participant, and
occurrence mappings before calling Bara. Neither those opaque references nor a
Convex identifier is returned in this view, so contract or provider changes
stay behind the server adapter.

The command surface should also be Pika-owned:

- `POST /api/teacher/attendance/session` for open/close overrides;
- `POST /api/teacher/attendance/marks` for bounded bulk marks/corrections;
- `GET /api/teacher/attendance/qr` for a currently open session's safe QR
  presentation payload;
- `POST /api/teacher/attendance/reconcile` for an explicit recovery attempt.

The exact route split may change during implementation, but no browser route
may accept or return a Convex document ID, WorkOS provider response, shared
secret, or raw Bara check-in token outside the QR presentation payload.

## State family

The first slice must cover the whole teacher state family rather than only the
happy path:

- integration disabled or not configured;
- no class day / no attendance policy;
- scheduled before opening;
- open with QR available;
- open while a staff command is pending;
- automatically or manually closed;
- cancelled;
- empty roster;
- stale projection with reconciliation available;
- Bara temporarily unavailable while the last confirmed projection remains
  visible;
- authorization or contract-version failure, with no provider detail exposed.
- permanent command delivery failure, shown as a sanitized previous-failure
  state rather than pending; the affected student/session remains available for
  a fresh idempotent command after the teacher reviews current authority.

## Implementation gates and slices

1. **Development boundary gate:** apply migration 127 to an explicitly
   authorized target; run roster, schedule, automatic session, staff mark,
   event, and snapshot reconciliation through the real signed adapter.
2. **Native teacher slice:** completed locally. The authenticated,
   teacher-owned route reads Pika's projection, strips opaque references, and
   remains safe before migration application while the integration flag is off.
   The dedicated Pika tab renders disabled, unavailable, scheduled, open,
   closed, cancelled, empty-roster, pending, and stale projection treatments.
   Real provider-backed rendering remains gated on step 1.
3. **Scheduling policy:** completed locally. The owner-only GET/PUT policy API
   stores Toronto-local open/close times with optimistic revisions and does not
   invent a default window. The Attendance action bar now opens an accessible
   settings dialog for same-day or overnight hours and automatic operation.
   Saving immediately requests the same bounded 90-day roster/schedule sync
   used by automation; if delivery is unavailable, the saved policy remains
   authoritative and the daily recovery worker retries without claiming the
   schedule is already current.
4. **Session controls:** the guarded owner-only manual open/close server route
   is implemented with request-scoped idempotency and no service IDs in its
   response. Commands are persisted before delivery and recoverable through the
   leased outbox drain. Scheduled-state display and UI controls are implemented;
   a production worker schedule remains.
5. **Roster commands:** the guarded server route now resolves Pika student IDs
   through private mappings and sends bounded mark/correction commands with
   enumerated privacy-safe reasons through the durable outbox. The accessible
   multi-select UI keeps commands pending until an authoritative revision is
   projected back into Pika and supports corrections after close.
6. **QR presentation and native student check-in:** completed locally. The FAB
   lazily fetches a bounded QR presentation through Pika, displays and copies
   the Pika-owned entry URL, and the native entry screen preserves its opaque
   token across Pika login. Pika derives the student from the verified server
   session and renders Bara's synchronous authoritative result. Hosted proof
   remains part of the development-boundary gate.
7. **Pilot hardening:** exercise keyboard/mobile/theme states, delayed or
   duplicate events, stale snapshots, provider outage, and audit review before
   enabling the integration for a pilot classroom.

## Acceptance boundary

The slice is not complete if the UI infers attendance from Daily-log content,
if the browser calls Bara or Convex directly, if a teacher sees a second login,
if automatic open/close is inferred by Bara from Pika tables, or if a pending
command is presented as confirmed before a Bara revision is projected back
into Pika.
