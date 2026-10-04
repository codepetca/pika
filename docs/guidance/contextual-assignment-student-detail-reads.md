# Contextual Assignment student-detail reads

Status: bounded backend implementation with offline evidence; independent review,
local runtime proof, exact-head CI and main merge remain coordinator gates.
Risk: runtime-platform (authorization, private payloads, query compatibility).

This slice changes only the shared-admitted path of
`GET /api/teacher/assignments/[id]/students/[studentId]`. It adds no SQL,
dependency, UI, rollout configuration or activation. Shared admission, page/home
cutover and production remain OFF.

A bounded companion correction makes the existing overview's Storage call lazy
after its deadline/count guards, with no DTO, query, authorization or limit change.
Two installed-SDK regressions first failed on the existing overview implementation:
one late POST appeared after rejection. The tests wait one full event-loop turn
to observe deferred credential/header work; both now pass with zero signing POSTs.
This resolves the documented non-blocking pre-activation follow-up from1454.

## Authorization and compatibility contract

Absent shared configuration preserves the literal existing exact-pair/legacy
body, without an added authentication call. Present configuration authenticates
and strictly decodes admission before params or service-client discovery.
Unadmitted actors retain the existing fallback. Malformed present configuration
fails503 without fallback. The admitted path decodes both UUIDs using its named
boundary schema and uses current classroom ownership regardless of account-role
labels. Admission grants neither ownership nor plan authority.

A minimal Assignment/classroom control statement returns404 for genuine absence
and403 for a nonowner. A separate exact enrollment control statement returns404
for a genuinely absent target. The owner cannot select their own historical
enrollment as a learner. Archived owners retain read access. Uncertain control,
duplicate evidence and missing guarded payload parents fail503.

Every payload, supplement, pagination page, empty terminal and final statement
starts from the requested Assignment and joins its current classroom owner and
the exact target's current nonowner enrollment. Identity decoding proves the
requested Assignment, classroom, actor and student again. Document reads prove
the exact Assignment/student pair; artifact reads additionally prove the exact
document, requirement Assignment/type and managed-object identity. Repository
reviews join their exact run FK and require that run's Assignment and completed
status. This is statement-current authorization, not one atomic snapshot.

## Preserved response

The owner DTO retains its Assignment fields, shared instruction/status helpers,
classroom id/teacher/title, student id/email and original name concatenation.
Users/profile projections contain only the needed identity, email and names.
The one-to-one generated profile FK returns an object/null; array-shaped or
widened evidence is rejected. Optional document and repository-target collections
use two-row bounds and reject duplicates rather than hiding them with limit1.

All current `assignment_docs` fields remain present, including teacher and AI
drafts, grading provenance/review, authenticity, saves and timestamps. Content
uses shared `parseContentField` and recursive JSON bounds. Feedback, requirements,
artifacts, repository targets and latest completed review retain their complete
existing rows, including review grading model/provenance. Joined authority fields
are stripped from the response. Latest-review order is created_at DESC/id DESC.
Repository choice preserves structured repositories before content/legacy fields
and existing teacher override behavior.

Feedback, requirements and artifacts use UUID keyset pages through an explicit
empty terminal read, including shortened server pages. Feedback is finally sorted
by returned_at, created_at and id; requirements by position, created_at and id.
Bounds reuse the list reader's10000 rows per collection,1024 statements,20-second
abort plus raced deadline,8MiB statement/final DTO,2MiB individual JSON, depth100
and500000 nodes. Malformed, substituted, duplicate, stalled, truncated, uncertain
or overflow evidence yields503 without a partial DTO.

## Image signing

Before each50-image batch, a fresh Assignment-rooted statement proves the current
owner, target enrollment, exact document, complete artifact set, requirement and
managed-object/path binding. No link is signed before complete proof. The accepted
overview namespace rules apply: managed classroom/student/document/object upload
paths with MIME-accepted filenames, legacy student/Assignment/requirement timestamp
paths (including registry backfill), and managed classroom restore paths. Foreign
namespaces, traversal and backslashes fail before signing. Null managed identity
is retained for valid legacy images.

Signing is invoked lazily after statement/deadline checks; a complete fresh proof
at statement1024 cannot start a forbidden1025th Storage request. The installed
SDK's signedURL/signedUrl/path/error shape is validated. Effective
links must have the configured Storage origin, exact signed object path, a single
nonempty token parameter and no credentials or fragment. One-hour TTL and prior
URL fallback on per-path/SDK signing failures are retained. Malformed successful
signing responses fail503. Final current owner/enrollment proof still runs after
signing. Issued links retain their existing expiry limitation; these statements
do not make signing atomic with a later ownership or enrollment change.

## Local offline evidence — 2026-10-04 Toronto

Regression-first API/SDK tests failed before implementation. The targeted command
passes107 tests across four files:

```sh
pnpm exec vitest run tests/api/teacher/assignment-student-detail-shared.test.ts tests/lib/server/contextual-assignment-student-detail-read.test.ts tests/api/teacher/assignments-id-students-studentId.test.ts tests/api/teacher/assignments-id-students-studentId-contextual.test.ts
```

The new tests use installed Supabase2.93.3 with a fetch adapter and inspect actual
REST predicates, nested ordering/limits and Storage requests. They cover both
admitted role labels, legacy/admission ordering, archived owner, member/outsider
denial, self-target denial, full private field preservation, all optional/null and
duplicate boundaries, more than1000 feedback/requirements/artifacts, shortened
pages, exact identity substitutions, owner/enrollment/document loss through
payload/terminal/signing/final reads, all resource bounds and timeout, repository
selection/tie ordering, managed/legacy/restored paths, fresh50-image batches,
malformed proofs/responses and signing fallback.

TypeScript, targeted ESLint and architecture checks pass. The architecture
checker reports1154 modules and zero deletion-only allowances. The coordinator
still owns the final focused checks and independent review for the complete diff.

No live database, authenticated HTTP/browser, provider or Storage-byte operation
was run by this implementation task. Existing empty artifact fixtures do not prove
nonempty artifact/feedback/target/review or signing behavior in a real runtime.
The coordinator owns a separate read-only SDK observer and the previously approved
disposable lifecycle/revocation proof. Nonempty supplement/signing runtime evidence
remains required before claiming those behaviors verified. This slice alone does
not complete batch2, authorize an integrated release or activate cutover.
