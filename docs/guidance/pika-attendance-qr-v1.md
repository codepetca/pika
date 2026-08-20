# Pika attendance QR entry v1

Status: implemented locally behind disabled rollout gates. The earlier
cross-application browser handoff is retired.

## Outcome

The teacher opens a QR dialog from Pika's native Attendance tab. Pika asks Bara
for the current open session's check-in presentation through the signed v1
adapter, then renders a QR whose public entry point stays on Pika. A student
scans the code, uses Pika's existing login if signed out, and returns to a
native Pika result screen. Pika derives the actor from the verified server
session, sends the versioned `student_check_in` command to Bara, and renders
Bara's synchronous authoritative result.

Pika never creates attendance tokens. Bara never receives Pika database IDs.
Pika encrypts the raw Bara token into a short-lived opaque entry token before
putting it in a browser path. The raw token is excluded from attendance events,
logs, projections, and Pika persistence.

## UI change brief

- Surface: QR action and dialog in the teacher Attendance tab; a native Pika
  student check-in result screen.
- Reference: the existing teacher work-surface floating controls and canonical
  `ContentDialog` overlay.
- Affected roles: teacher, student, and unauthenticated student.
- Required viewports: desktop and mobile.
- Required themes: light and dark.
- Key states: open-session action, loading, ready, copy success, confirmed,
  duplicate, needs-help, unavailable/uncertain, invalid, expired/closed,
  signed-in student, and signed-out student.
- Primary signal: one high-contrast QR inside a restrained dialog.
- Must not add: a Bara iframe, second navigation shell, provider identifiers,
  roster PII, raw Convex/Supabase IDs, or a Hosted UI fallback presented as a
  successful single-login path.
- Composite widget accessibility review needed: yes, for dialog focus/escape
  behavior and the floating action group.

This is a refinement of the existing teacher work-surface pattern, not a
redesign.

## Boundary and contract

1. Pika authorizes classroom ownership and resolves its private classroom/date
   mappings plus the teacher's verified WorkOS subject.
2. Pika posts a signed, closed `check_in.presentation` v1 request to Bara.
3. Bara resolves the teacher subject through its tenant-bound identity mapping,
   verifies staff access to the mapped roster, and returns the occurrence
   reference, revision, close time, and raw check-in token over the signed
   server channel.
4. Pika encrypts that bounded payload and exposes only a Pika-owned
   `/attendance/check-in/<opaque-entry-token>` path to its browser.
5. The entry page preserves that exact path across Pika login. Pika then
   cross-checks the verified WorkOS student against its local identity, sends
   the same stable idempotent `student_check_in` body on at most one retry, and
   renders Bara's closed result. An uncertain outcome is shown as unavailable,
   never as confirmed or queued for silent later application.

The rollout invariant is that the student needs only the Pika login while each
app keeps its own WorkOS Application, session, internal identity, authorization
model, and database. A Pika compatibility cookie alone never authenticates the
server-to-server command.

## Acceptance gates

- Only an authorized staff actor can retrieve a presentation for an open mapped
  session.
- Scheduled, closed, cancelled, missing, or mismatched sessions fail closed.
- The Pika browser calls only Pika routes and receives no service IDs or
  integration credentials.
- The QR starts and finishes on Pika, preserves the opaque entry token across
  login, derives the actor only from the verified server session, and never
  opens a Bara browser session.
- Lost responses are retried only with the same stable command idempotency key;
  an unresolved retry is shown as unconfirmed and is not queued for later.
- Dialog focus, Escape/close, copy, desktop/mobile, and light/dark states have
  browser evidence.
- A presentation that expires while open is removed immediately, and Bara
  independently refuses a presentation at or after the occurrence close time.
- Contract fixtures and validators remain equivalent in Pika and Bara.
