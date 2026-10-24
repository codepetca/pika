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
  write failures, history-read endpoint lookups, and finalization for grading.
- Gradebook roster, profiles, assessment data, categories, weights and overrides.
- Assignment/test auto-grade entry-point enrollment/document checks.
- Test AI suggestion enrollment checks and reference-cache writes in both the
  suggestion route and background grading worker.

Cache/history failures remain best-effort: they must not turn committed student
work or a valid grading result into a failed operation. Query authorization,
canonical work, provider egress payloads, and returned scores remain unchanged.

The third batch extends adoption to the remaining directly logged failures in
student/teacher Assignment and Test APIs, assignment-document read/save/submit/
unsubmit/history/restore routes, document synchronization, assessment draft
creation/repair, document authoring, and assignment-artifact/Test-snapshot Storage
cleanup. The browser-reachable assignment-history reconstruction helper uses a
fixed warning without its former entry ID; it does not import the server logger.
Cleanup retry records use fixed stage descriptions, not database or Storage
messages. Their leases, counters, claim limits and retry outcomes are unchanged;
this does not erase previously saved failure text.

These changes add no network calls, service dependencies, migrations, scheduled
jobs, or teacher/student interface changes. Local classification and one UUID
per existing logged failure add small CPU work; no quantitative latency/cost
benchmark has been performed. Smaller log entries may reduce log volume.

## Remaining audit inventory (2026-10-24)

The scan still found direct error logging outside these adopted files. These
are follow-up inspection targets, not proof that every call leaks student data:

- Archive compaction, managed-deletion health and Pal configuration diagnostics;
  inspect existing structured allowlists before changing them. Coordinate with
  the separate removed-student cleanup work rather than duplicating its edits.
- Other API families, application helpers and integrations outside the explicit
  adoption list; do not infer whole-program coverage from the assessment batch.
- Transitive helper logs and other browser, integration, SDK and platform sinks
  beyond the explicit adoption list.

Separately verify host/vendor log access, retention, log drains, and deletion
scope. Source fixes affect future emissions after deployment; they do not erase
historical logs, prove what those logs contained, or change vendor settings.
No live student-data query or production fault injection is needed for these
synthetic regression tests.

Journal-derived product-feedback purpose/consent remains a separate decision:
sanitizing diagnostic logs does not stop deliberate journal content egress.

## Assessment and document cleanup — 2026-10-24

The owner approved orchestrating the remaining diagnostic cleanup, beginning
with assignment/Test routes and document processing. Journal-derived product
feedback is explicitly left unchanged. This package does not authorize vendor
setting changes, historical data deletion, migrations or production rollout.

Execution is split into three non-overlapping implementation slices: assignment
and assignment-document routes; Test routes; shared document/history and Storage
cleanup helpers. The coordinator owns the diagnostic event allowlist, adoption
guard, cumulative checks and PR. Each slice must preserve authorization, query,
response, grading and retry semantics. Raw errors and record/path identifiers
must not enter console diagnostics. Existing cleanup retry records must use
fixed content-free failure descriptions rather than provider/database messages.

Acceptance requires synthetic failures through the real logger, exact output
shape assertions, preserved best-effort/history/cleanup behaviour, static
adoption guards, the focused repository gate, independent stable-SHA review and
required CI. Existing browser-reachable history helpers must remain browser-safe;
they must not import the server logger. The remaining vendor/platform logging
inventory and the broader security goal are not certified by this package.
