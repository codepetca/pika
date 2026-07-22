# AI Grading Egress

Pika keeps canonical classroom data unchanged. Any provider call for assignment
or test grading must build an outbound-only egress payload first, then send only
that sanitized copy to the provider.

## Contract

- Do not pass raw Supabase rows or UI domain objects directly to an AI provider
  adapter.
- Redact direct identifiers before provider egress: emails, URLs, phone numbers,
  student numbers, UUIDs, and street-like addresses.
- Load classroom roster/profile names for grading paths and replace known
  student names with initials before provider egress.
- If classroom roster/profile names cannot be loaded, fail closed before the
  provider call instead of sending grading text with only direct-identifier
  redaction.
- Replace provider correlation IDs with local-only pseudonyms such as
  `response_1` or `submission_1`.
- Keep the pseudonym-to-local-ID mapping inside Pika. Providers should never need
  Pika user IDs, response IDs, assignment doc IDs, names, or emails.
- Validate adapter payloads against an allow-list of expected fields before
  sending. Unexpected fields should fail closed.
- Set provider retention controls such as `store: false` where supported.
- Sanitize provider output before saving feedback locally.

## Current Paths

- Daily log summaries use roster-aware initials plus direct identifier redaction.
- Assignment grading loads classroom sanitization context, then sanitizes
  assignment metadata, student work, artifact metadata, and generated feedback.
- Test grading loads classroom sanitization context, then sanitizes
  test/question metadata, answer references, student responses, and generated
  feedback.
- Test batch grading sends pseudonymous response refs and maps them back locally
  after the provider response.
- Assignment and test provider calls run through the database-independent
  `src/lib/grading/*` core. Pika-specific adapters sanitize first, while
  versioned profiles own prompt and output contracts.
- The remote Gradex worker remains disabled during the internal grading pilot;
  no normal grading path sends classroom data to Gradex.

## GradeX Adapter Guidance

GradeX should accept a sanitized grading envelope, not raw Pika rows. The adapter
may define its own provider schema, but it should be constructed from sanitized
text and pseudonymous refs only. If GradeX needs artifact URLs or other richer
context, that should be an explicit profile flag with tests that prove the
additional field is intentional.
