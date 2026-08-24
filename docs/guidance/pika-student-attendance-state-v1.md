# Pika student attendance state v1

Status: implementation brief for the first student in-app attendance-status slice.

## Outcome

Students see a classroom-scoped attendance prompt in Pika while their teacher's
session is open, then see only their own confirmed `present` or `late` state and
Toronto timestamp after a successful scan. The teacher-displayed QR remains the
only student physical-presence proof: the prompt contains no token, link, or
check-in mutation.

## UI change brief

- Surface: a subtle icon-only QR-scan status within each enrolled classroom row
  on the Classrooms index, plus a prominent banner at the top of the selected
  classroom's Today pane.
- Reference: existing student classroom cards, Today page-state notices, and
  semantic attendance status treatments.
- Affected roles: student only. Teacher and unauthenticated surfaces are not
  changed.
- Required viewports and themes: desktop and mobile; light and dark.
- Key states: open, revalidating, confirmed present/late, closed/expired,
  unavailable, and multiple independently scoped classrooms.
- Primary signal: a static highlighted semantic status icon and concise headline;
  no looping attendance animation.
- Must not add: browser push, a QR token or check-in link, a direct check-in
  action, provider identifiers, roster data, other students, or a new
  navigation destination.
- Composite widget accessibility review: no; this adds status content only.

This refines existing student classroom and Today surfaces; it is not a new
attendance application or notification system. Stable guidance is followed,
no experimental pattern is introduced, and no human promotion is needed.

## State map

| Source state | Student read state | UI behavior |
|---|---|---|
| Integration disabled, not configured, or teacher not entitled | `unavailable` | No attendance prompt or status is shown. Other classroom content remains usable. |
| Active enrolled classroom with no current occurrence | `no_session` | No attendance UI is shown. |
| Current occurrence scheduled but not open | `scheduled` | No prompt is shown; revalidate at a bounded interval or at opening. |
| Session open and the student has no confirmed record | `open` | Show an accessible QR-scan indicator on the classroom card and the concise “Scan QR for Attendance” status on Today. |
| An open/session-bound read is refreshing | client-only `revalidating` | Keep the last safe state visible without claiming a new confirmation. |
| Own record is `present` or `late` | `confirmed` | Show the private status and Toronto confirmation time in that classroom. |
| Session closed, cancelled, or past `closesAt` without a record | `closed` | Remove the open prompt immediately; no check-in action is offered. |
| Attendance read fails after a prior safe snapshot | client-only `service_unavailable` | Preserve the last safe snapshot and do not convert failure to empty or confirmed. |
| Attendance read fails without a safe snapshot | client-only `service_unavailable` | Show no attendance claim; the rest of the page remains available. |
| Classroom archived | omitted | Archived classrooms are excluded before attendance reads and render no state. |
| Multiple active enrollments | one state per enrolled classroom | Never combine or transfer state between classroom IDs. |

A validated positive check-in response is handed off in memory only for the
POST-authenticated student identity returned by the server and that classroom
while the read projection converges. It never trusts an identity captured by an
earlier page render. The handoff
is bounded to two minutes and the open occurrence's server-authored close,
revalidates at most every five seconds, and is cleared immediately unless the
read projection still reports that classroom occurrence open (including when it
becomes closed, cancelled, scheduled, unavailable, unenrolled, archived, or
projection-confirmed). It cannot survive a reload, contain a token, or mutate
attendance. A confirmed state may remain visible for the current occurrence after close;
only the stale open prompt must disappear. Closed confirmations revalidate at
the next Toronto midnight, while an occurrence that legitimately closes the
next day remains current until its close. The server response includes a
bounded next-refresh hint and a confirmation validity boundary. The client
suppresses an open prompt at the known close instant and confirmation at its
validity boundary. Every response includes validated server time; the client
anchors it and its original cache receipt to a monotonic timer so a skewed phone
clock or a cache-backed remount cannot leave stale
instructions or a prior occurrence's confirmation visible.

## Minimum safe read model

- Authenticate with Pika's signed-in student session and derive the student ID
  server-side. Accept no student identity, roster, participant, occurrence, or
  classroom scope from the browser.
- Derive classroom scope only from that student's active enrollments, capped to
  a bounded number of classrooms. Archived classrooms are excluded.
- Apply the existing exact-canary or teacher-entitlement gate before reading an
  attendance projection. Entitlement and Pika IDs never cross into Bara.
- Batch-read at most 100 occurrence/session projections across the current and
  immediately preceding Toronto class dates, supporting bounded next-day close
  windows, and records whose `student_id` is the signed-in student. Return Pika
  classroom IDs, public state, session times, own status, own confirmation time,
  a refresh hint, and the GET-authenticated student ID as a response binding.
- Reject, clear, and do not cache or render a response whose authenticated
  student binding differs from the student identity that owns the page.
- Never return QR/check-in tokens, opaque roster/participant/occurrence refs,
  provider IDs, other students, roster rows, teacher identity, entitlement
  records, or arbitrary caller-selected classroom results.
- Reads are cache-safe and mutation-free. Polling is single-flight, bounded,
  stops when no state requires it, and never invokes Bara or attendance command
  routes.

Pika continues to map its local user UUID to WorkOS without changing Bara's
`app_users` plus `auth_identities` identity ownership or
`rosters.ownerAppUserId`. This slice changes no schema, flag, entitlement,
production data, or cross-service identity contract.
