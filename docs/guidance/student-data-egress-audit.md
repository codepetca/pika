# Student-data egress audit and remediation sequence

## Scope and evidence

Initial source audit: 2026-09-07, main `1f629d64d14d15f49ba809b3c6579b297362347f`.
Compared the audited library, integration, vendor and nightly-summary paths with
production `2c10b8eb30e51bf903b0dc0acc9be07d729e110e`: no source differences.
This establishes code equivalence, not production environment settings or vendor
account retention. No real student records, provider requests, credentials or
production settings were used in this audit. Risk: runtime-platform.

The prior embedded exam PDF-viewer check is explicitly deferred by the user.
Authenticated student/native PDF rendering and anonymous/public denials passed;
the user deleted the synthetic classroom and it disappeared from the archive UI.
Physical downstream deletion is not newly certified by that UI observation.

## Data-flow inventory

| Destination | Data leaving Pika | Implemented safeguards / remaining evidence |
| --- | --- | --- |
| OpenAI grading and repository review | Sanitized assignment/question/answer/repository text and provider-safe refs | Roster-aware sanitizer, strict output schemas, `store: false`; redaction and error-path defects below. |
| OpenAI nightly log triage | Sanitized daily-log text, date and per-request source refs | Roster/profile query failures stop the call; output is constrained to source/category, not free-form quotations. Sensitive subject matter remains in sanitized text. |
| OpenAI product-feedback extraction | The same complete sanitized daily-log collection, with initials/date | Second purpose-specific call occurs after successful summary persistence; no product-only selection before transmission. |
| OpenAI curriculum import | Teacher-supplied PDF bytes and filename, or downloaded public PDF | Teacher workflow, bounded safe fetch and `store: false`; intentionally not a student-work redaction path. Avoid treating arbitrary uploaded PDFs as deidentified. |
| Bara attendance | Opaque participant/principal refs, display names, classroom title, schedule and check-in facts | Strict versioned contract, signed requests, redirect rejection; coordinated classroom decommission exists. This flow is identified attendance data, not anonymous analytics. |
| Pal rewards | HMAC learner/classroom/item refs, activity events, dates/times and completion metadata | Pinned event validation, HTTPS origin validation, short-lived learner read token; no student journal/grade text in inspected event builders. Stable pseudonyms still permit activity linkage. Downstream retention/erasure remains unverified. |
| Gradex runtime grading, when enabled | Sanitized grading envelope and pseudonymous refs | Separate feature flag; documentation says disabled but live flag not inspected. URL and failure handling need hardening before treating the optional path as ready. |
| Gradex archive extract | Deidentified, schema-constrained extract in Pika's private Supabase bucket | Not the same as remote runtime grading; ownership/read-back/cleanup workflows exist. No evidence gathered of downstream ingestion or vendor deletion. |
| Brevo / WorkOS authentication | Necessary account identity and authentication delivery data | Brevo carries email and code/template parameters; delivery error logging can retain raw provider response text. Vendor-account policies were not inspected. |
| Hosting/application logs | Route failures, integration diagnostics and selected operation metadata | Several paths log arbitrary Error/database objects; not a centrally enforced allow-listed privacy boundary. |

No Sentry/PostHog/Clarity or Vercel Analytics integration was found in the scoped
`src`/package search. This does not audit hosting log drains, platform settings,
browser extensions or provider-side infrastructure.

## Confirmed defects, prioritized

### 1. Known non-ASCII student names can escape redaction

`src/lib/ai-sanitization.ts`, `replaceStudentNames`, uses JavaScript ASCII-style
`\\b` boundaries for standalone first/last names. A local probe against the real
function with a synthetic roster entry `Élodie Martin` left `Élodie` unchanged in
`Élodie wrote this. Email: synthetic@example.invalid`, while redacting the email.
The full-name branch does not rescue text containing only the first name.

Impact: otherwise-sanitized AI requests may contain a known student's name.
This is a reproducible privacy defect, not evidence of an observed live leak.

Fix: Unicode-aware name boundaries, explicit normalization/case tests, and
regressions covering accented and non-Latin names, full/partial names and
non-name substrings. Preserve canonical student data and existing grading text
outside intended substitutions. Heuristic redaction must not be advertised as
guaranteed anonymization of arbitrary free text.

### 2. Provider failure bodies bypass the normal privacy boundary

`src/lib/grading/providers/openai-responses.ts` includes complete non-2xx response
bodies in `GradingProviderError.message`; invalid JSON includes a body excerpt.
The assignment adapter propagates that message and
`src/lib/server/assignment-ai-grading-runs.ts` stores it as `last_error_message`.
A local mocked-fetch probe confirmed a synthetic private marker from an HTTP 400
body survives in the thrown grading error. No network request was made.

`src/lib/brevo.ts` separately logs and throws the complete failure response body;
authentication delivery error handling logs the resulting Error again.
`src/lib/api-handler.ts` logs arbitrary unexpected errors, and sanitization
context errors preserve raw database causes. These are potential secondary
copies of sensitive/provider-controlled data, not proof those bodies currently
contain real student information.

Fix first at provider boundaries: retain bounded status/error category and
retryability, not response bodies, arbitrary messages, headers or causes.
Add sentinel assertions for HTTP, malformed-response and network-error paths,
including downstream persisted errors. Then address remaining direct database
and application logs with an explicit safe diagnostic schema.

### 3. Optional outbound clients are inconsistent about transport controls

The Bara client rejects redirects. Pal event/token requests, the OpenAI grading
provider, Brevo and the optional Gradex client omit an explicit redirect policy.
`getGradexConfig` accepts a configured base URL without enforcing HTTPS or
rejecting embedded credentials/query/fragment components.

Impact is conditional on endpoint/configuration behavior: a redirect can move
request bodies outside the intended origin, and an enabled Gradex path can be
misconfigured with plaintext HTTP. No malicious redirect or unsafe production
configuration was observed.

Fix in a separate transport change: reject redirects for authenticated outbound
calls, validate Gradex URL configuration, allow loopback HTTP only in development,
and test rejection without sending a second request. Preserve bounded retries
and safe error categories.

## Product-policy and operational decisions

1. **Nightly product feedback:** the complete sanitized journal batch is sent a
   second time for product triage. Redacting names does not remove private health,
   family or wellbeing narratives. Decide whether to stop journal-derived
   product extraction and keep explicit Send Feedback, or introduce an opt-in
   minimization path. Do not silently remove the feature during a plumbing fix.
   Evidence: nightly-log-summaries route and `developer-log-feedback.ts`.
2. **Retention:** `store: false` is present on inspected OpenAI calls, but source
   code alone does not certify provider account retention, backups, data region,
   contractual controls or log-drain retention. Check those settings read-only
   with the owner; do not imply that Pika classroom deletion erases every vendor
   copy immediately.
3. **Pal/Gradex deletion:** no Pal remote erasure call was found in the scoped
   Pika cleanup search. Verify the intended lifetime of pseudonymous activity
   and downstream extracts before expanding deletion. Do not delete shared user
   identities, rewards or other-classroom data based only on classroom cleanup.
4. **Live enablement:** reconcile actual Gradex, Pal, log-summary and cleanup
   flags with documentation without printing secret values or toggling flags.

## Execution plan

1. Approve and implement the two confirmed defects as the first privacy fix:
   Unicode-safe names and content-free AI/email failure diagnostics. Run full
   environment verification before code edits, synthetic regression tests and
   `pnpm check:focused -- --base origin/main`.
2. Publish draft; complete risk-matched independent privacy review, batched
   remediation and stable-SHA CI. No migration or production configuration change
   is expected for this package. Production release remains a separate gate.
3. Harden outbound transport separately and reconcile optional Gradex enablement.
4. Resolve nightly product-feedback scope and external retention/deletion policy,
   then implement those decisions with dedicated tests and explicit rollout.

## First fix package (2026-09-07)

User approved implementation of findings 1 and 2. The branch now uses Unicode
boundaries and canonical NFC/case-folded matching, with a single replacement pass
so generated initials are not processed again. Length-changing case folds and
Turkish-I variants map back to original grapheme offsets; initials use whole
Unicode code points. Single ASCII initials remain excluded from partial-name
matching to preserve prose. Canonical records and unmatched text are unchanged.

OpenAI HTTP/network/JSON errors and Brevo delivery errors now discard untrusted
content; grading parser, normalization and final schema errors also discard raw
messages and causes. Unknown/duplicate batch-grading refs also produce fixed
content-free errors, with their prior non-retryable/internal classification
preserved. Synthetic tests
cover standalone accented/non-Latin names, normalization, punctuation, compound
names, error bodies/headers/causes, and saved assignment/test-run failure diagnostics.

This is not completion of the broad security goal. Transport hardening, optional
Gradex failure diagnostics, other application/database logs, product-feedback
scope and vendor retention remain follow-ups. Existing stored errors/logs are not
retroactively purged. No migration or production change is included. Focused
checks, independent review and exact-head CI gate the PR; deployment is separate.

## Transport package preparation (2026-09-09)

Privacy fix #1218 was released through production PR #1227. Teacher and
anonymous-access smoke checks passed. The user reported student checks with no
issues on September 9 and requested continuing to the next security item. This
is user-reported acceptance, not agent-run evidence for the unexecuted synthetic
draft/scheduled-announcement visibility scenarios.

Current main `6173d863` still has the outbound transport gaps. The isolated
implementation branch is `codex/outbound-transport-hardening`; environment
verification passed after a frozen-lockfile dependency installation. No source
implementation or hosted mutation occurred during preparation. Risk:
runtime-platform and async-grading. The user subsequently approved this plan:

1. Reject automatic redirects on authenticated runtime OpenAI calls (grading,
   log summaries, developer feedback and curriculum import), Brevo delivery,
   Pal event/read-token requests and optional Gradex grading. Preserve Bara's
   existing rejection. Do not change public-document redirect handling, signed
   Storage delivery, authentication navigation or vendor SDKs in this package.
2. Validate the optional Gradex base URL before any request: HTTPS, no embedded
   credentials/query/fragment, and an explicit path policy verified against the
   existing endpoint contract. Permit loopback HTTP only in development. Do not
   enable Gradex or change production configuration.
3. Keep Gradex transport/HTTP/parse diagnostics content-free, including saved
   run errors, while preserving bounded retries and timeout behavior. Do not
   expand this into a general application-log rewrite.
4. Add synthetic regressions for URL rejection, redirect rejection without a
   second destination receiving the body/key, safe failures and successful
   existing request contracts. No real provider calls or student records.
5. Run focused checks, publish draft, complete independent security and
   compatibility review, batch fixes and pass exact-head CI. Main merge and
   production rollout remain subject to their normal authority gates.

No new dependency, migration, schedule or user-interface change is planned.
Broader logging, product-feedback purpose, vendor retention/deletion and live
enablement reconciliation remain separately tracked work, not certified here.

### Implemented transport contract

The eight runtime call sites above now use `redirect: 'error'`. Automatic
redirects fail through the existing error/retry paths; they never forward the
request to a second destination. This does not block Pika's authorized signed
Storage redirects or public-document fetching. SDK-managed traffic and operator
Gradex smoke scripts are outside this runtime package.

Gradex configuration must be an origin, not an API-path prefix. The adapter owns
the `/api/v1/grading-runs` paths. HTTPS permits an explicit port; credentials,
query strings and fragments (including empty delimiters) are rejected. HTTP is
permitted only with `NODE_ENV=development` and a canonical `localhost`,
`127.0.0.1` or `[::1]` hostname. Validation happens before loading grading work.
This is trusted operator configuration validation, not a general arbitrary-URL
SSRF guard or DNS/IP allow-list.

Gradex HTTP errors discard bodies, successful-response JSON/schema failures use
fixed messages, and result-mapping failure diagnostics no longer persist raw
exceptions. The timeout remains active through response-body consumption.
Existing bounded retry/backoff and idempotency behavior is retained.

Loopback-only tests exercise real fetch behavior for redirect statuses, verify
one initial request and zero destination requests, and use synthetic payloads
and credentials only. Additional tests cover unsafe URL rejection before fetch,
development-only HTTP, status-based retries, response timeout and content-free
saved diagnostics. Existing successful-request suites remain regression gates.

Rollout requires no migration or new environment variable. If an operator has
configured Gradex with an API-path prefix or a plaintext non-development URL,
that integration will fail closed until its canonical HTTPS origin is used.
If a vendor intentionally redirects an endpoint, configure/use its reviewed
canonical endpoint; do not restore automatic forwarding. Live Gradex enablement
and endpoint configuration have not been checked or changed by this package.

## Application diagnostics — first adoption batch (2026-09-11)

User approved content-free application error logging. This batch covers the
shared API error handler, core session/authentication-throttle operations,
classic signup/reset/verification route errors, deferred authentication email
errors, nightly journal-summary processing, and teacher summary reads. It also
removes retained raw database causes from AI name-loading errors. The explicit
adoption list is locked by `tests/unit/diagnostic-boundaries.test.ts`.

`src/lib/server/diagnostics.ts` emits only a fixed event identifier, a coarse
allowlisted category, and a freshly generated random diagnostic UUID. It does
not serialize errors, inspect messages/stacks/causes, invoke getters or
serializers, or accept arbitrary metadata. Unknown values reduce to generic
categories. No user/classroom IDs, route labels, URLs, query strings, request
bodies, tokens, database details, or provider content are copied into these
records. A database failure with an unrecognized code remains observable as an
unexpected failure, without retaining that raw code.

Unexpected API failures keep their existing HTTP 500 JSON body and additionally
return `x-pika-error-id`, matching that one diagnostic record. This is a random
error reference, not a trusted incoming request ID, identity, or end-to-end
trace across nested operations. Existing known-error responses and retry,
authentication, email scheduling, summary-generation and authorization behavior
remain unchanged. Operation labels are intentionally coarse; do not restore
raw errors or dynamic labels to recover debugging detail.

This is **not global logging certification**. The initial source inventory had
502 console statements across 162 files (including benign/development logging).
Route-local logs elsewhere, downstream integration helpers, browser consoles,
AI telemetry, operator scripts and hosting/access logs remain outside this
first adoption batch. Synthetic sentinel tests and static boundary checks guard
the selected paths; subsequent batches must inspect the remaining sinks. This
does not erase older logs, alter persisted error records or provider retention,
change journal-derived product-feedback policy, enable Gradex, apply migrations,
or deploy production. Prior transport release #1235 is live; its signed-in smoke
checks remain unverified here, not silently counted as passed.
