# Application diagnostic privacy

## Contract

Use `src/lib/server/diagnostics.ts` for adopted server error boundaries. The
logger emits only a compile-time/runtime-allowlisted operation, a coarse
`database`, `timeout`, or `unexpected` category, and a fresh random diagnostic
reference. Do not add free-form context, error messages, stacks, causes, request
bodies, URLs, names, emails, student work, or database/assessment IDs.

This intentionally sacrifices raw stack traces and query details. Diagnose with
the fixed operation, category, timestamp, synthetic reproduction and tests.
Database codes outside the small classification allowlist appear as
`unexpected`; do not log arbitrary codes to improve classification. Gradebook
fallback failures classify the terminal fallback error, not both raw errors.

The shared API wrapper attaches `x-pika-error-id` to unexpected 500 responses.
Handled failures do not automatically receive that header. A logging migration
alone must not change existing response bodies, permissions, grading state,
history best-effort semantics, retries, or query filters.

## Adoption and verification

The explicit file list in `tests/unit/diagnostic-boundaries.test.ts` is the
coverage boundary, not a claim that all logs are safe. It checks direct console
calls and diagnostic labels; it is not a whole-program alias/data-flow analysis.
Pair this guardrail with executable failure tests using synthetic sensitive
markers and the real diagnostic logger. Exact output-shape assertions reject
extra fields as well as raw error arguments.

The first batch covers the common API wrapper, session/authentication flows,
email error handling, and journal summaries/queries/feedback diagnostics.

The second batch covers direct logging in:

- Student test save/submit, validation of RPC success results, versioned history
  failures, and finalization for grading.
- Gradebook roster, profiles, assessment data, categories, weights and overrides.
- Assignment/test auto-grade entry-point enrollment/document checks.
- Test AI suggestion enrollment checks and reference-cache writes in both the
  suggestion route and background grading worker.

Cache/history failures remain best-effort: they must not turn committed student
work or a valid grading result into a failed operation. Query authorization,
canonical work, provider egress payloads, and returned scores remain unchanged.
These changes add no network calls, service dependencies, migrations, scheduled
jobs, or teacher/student interface changes. Local classification and one UUID
per existing logged failure add small CPU work; no quantitative latency/cost
benchmark has been performed. Smaller log entries may reduce log volume.

## Remaining audit inventory (2026-09-15)

The scan still found direct error logging outside these adopted files. These
are follow-up inspection targets, not proof that every call leaks student data:

- Assignment/test list, detail, results, access, return/unsubmit and CRUD routes.
- Document synchronization, assessment draft creation/repair, and test document
  snapshot cleanup (raw errors and contextual record/path identifiers).
- Archive compaction, managed-deletion health and Pal configuration diagnostics;
  inspect existing structured allowlists before changing them. Coordinate with
  the separate removed-student cleanup work rather than duplicating its edits.
- Transitive helper logs and other browser, integration, SDK and platform sinks
  beyond the explicit adoption list.

Separately verify host/vendor log access, retention, log drains, and deletion
scope. Source fixes affect future emissions after deployment; they do not erase
historical logs, prove what those logs contained, or change vendor settings.
No live student-data query or production fault injection is needed for these
synthetic regression tests.

Journal-derived product-feedback purpose/consent remains a separate decision:
sanitizing diagnostic logs does not stop deliberate journal content egress.
