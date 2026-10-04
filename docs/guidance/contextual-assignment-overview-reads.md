# Contextual Assignment overview reads

Status: isolated normal and two forced-cleanup proofs accepted at78aed851;
initial/targeted reviews clean. Final cumulative review, exact-head CI and merge
remain gates. Based on actual main88d54c94/PR1453.
Risk: runtime-platform (authorization, privacy, query compatibility).

This bounded batch2 slice handles only `GET /api/teacher/assignments/[id]`.
The owner/student drill-down and learner document-opening supplement reads
follow separately. It introduces no schema, dependency, role, flag, UI change
or activation. Shared admission and the live home/page cutover stay OFF.

## Acceptance contract

Present shared configuration authenticates and strictly decodes admission before
resolving route params or creating a service client. Admitted actors enter the
overview reader regardless of global account-role labels. Absent/unadmitted
configuration preserves the literal existing exact-pair/legacy GET body;
PATCH/DELETE remain unchanged. Admission itself grants no relationship.

The first read discovers only Assignment/classroom control identity. Every
payload statement independently joins the requested Assignment and its current
classroom to the current owner, including all pages, empty terminal pages and
the final control read. Archived owners retain read access. Members/outsiders
receive no teacher overview. Roster and document statements independently bind
current nonowner enrollment in the same classroom; a historical owner
self-enrollment does not turn that owner into a learner.

Use explicit projections, strict schemas, bounded JSON decoding, keyset pages,
identity and parent-completeness checks. Profile, requirement, artifact, history
and grading-summary data need their own current-owner boundary, not permission
inferred from an earlier read. No provider execution is permitted. Preserve the
existing response/status/instruction/completion contract. Image signing must
follow verified current artifact/doc/requirement/student evidence; existing
signed URLs retain their documented expiry limitation.

Managed images support current upload names, registry-bound legacy names and
the canonical classroom archive-restore namespace. Upload extensions retain
the existing producer's MIME/size validation contract rather than an invented
alphanumeric extension limit. Exact bucket/path, classroom, student, document,
purpose and state binding still apply; foreign namespaces and traversal fail
before signing. Restored paths require current exact managed-object evidence.

History/artifact pages use independent parent cursors in25-document batches,
with100 rows per child page. Sparse parents cannot consume one statement per
row, shorter server pages cannot skip sibling rows, and every batch still needs
an empty terminal read with all current-parent identities. Cursor predicates use
only strictly decoded UUIDs; the smaller batch bounds request-line size.

Bounds:10000 rows per collection,1024 statements,20 seconds,8MiB per statement
and final DTO; uncertain, malformed, duplicate, stalled, truncated or overflow
evidence fails503 without a partial result. The contract is statement-current
authorization, not one atomic snapshot across all reads.

## Evidence plan

Offline installed-SDK fetch tests assert actual URL predicates and result
validation, including ownership and target-membership changes at first/later/
terminal boundaries, large collections, parent substitutions, private projection
exclusions, timeouts and malformed admission order. API tests preserve legacy
behavior while proving admitted role-neutral dispatch.

The additional local/CI proof reuses PR1453's reviewed disposable project,
fixture, exact239 migration replay and teardown without changing their platform
or SQL authority. Seven added read-only overview cases cover both owner-role
labels, historical self-enrollment, members/outsiders,1001 students/documents and
1001 requirements. It also runs the existing nine list cases and fourteen list
revocations; those are not claims of real overview revocations. Overview
revocations are initially covered offline. The existing099 submission trigger
creates one history snapshot for each submitted fixture document; the proof
asserts its latest timestamp against the exact fixture submission timestamp.
Artifact collections are empty and no AI run or managed Storage object is
created in this real fixture. Nonempty artifact/grading-item pagination and
signing require separate evidence before claiming those runtime behaviors verified.

The canonical Pika database54322 is read-only. The wrapper uses the same fresh
`pika_assignment_list_<12hex>`54331/54332 project as the reviewed list lifecycle,
never an existing project. Whole canonical public/private/storage row digests,
immutable168 metadata, settings, cron and resources must match before/after;
all newly owned project resources and its generated directory must be absent.
Normal and deterministic forced modes preserve the existing lifecycle's finally
cleanup. No auth-cookie/browser, provider HTTP, Storage-byte or production claim
is made. Fixed-source independent review precedes any execution.

## Accepted local execution — 2026-10-03 Toronto

Clean code head78aed851db9845f3cf906daf7b12cddf9e44c40e, installed CLI2.109.1:
normal mode passed seven overview SDK cases plus the existing nine list cases
and fourteen list revocations. The fixture verifies1001 current nonowner
students/documents/requirements and099-triggered submission histories. Both
after-fixture and before-capture modes exited1 with only their exact expected
failure and cleanup/baseline PASS markers. Each exclusively owned disposable
project and generated directory was removed; complete canonical fingerprints,
168 metadata, settings, cron and resource identities were unchanged.

266 focused checks/one skip,105 targeted tests, architecture/UI/design policies,
TypeScript, lint, Pika audit and separate proof TypeScript checks pass. Initial
review found valid restored/backfilled/unusual-filename managed images wrongly
rejected; regression-first namespace correction was independently reviewed clean.
The first two real runs failed safely in cases. Closed diagnostics identified
sparse generated histories exhausting the unchanged statement cap; independent
parent cursors and exact trigger timestamp assertions corrected that issue.
The final targeted review is clean. No fixture SQL, platform authority, migration,
global limits or activation was changed to make the proof pass.

These are installed-SDK/helper and isolated-cleanup receipts, not authenticated
HTTP/browser, provider, Storage-byte, production or cutover evidence. Real
nonempty artifact/grading-item/signing and overview revocations remain separate
evidence requirements before a release claim.

The full assessment/lifecycle integrations, home shell and integrated release
rehearsal remain prerequisites for cutover. This slice alone is not goal completion.
