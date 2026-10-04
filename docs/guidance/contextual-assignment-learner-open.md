# Shared learner Assignment opening

Status: dormant source preparation. Independent fixed-source reviews, isolated
read/projection evidence, final exact-head CI and main merge remain gates.
Risk: authorization, private learner disclosure and existing transactional effects.

This bounded slice changes only the shared-admitted prefix of
`GET /api/assignment-docs/[id]`. There is no migration, dependency, UI,
admission configuration, production operation or billing/provider activation.
It uses migration240's existing locked member-open transaction; it does not
replace that transaction with application-side document writes.

## Boundary and preserved behavior

Authentication and strict shared-admission decoding precede parameter parsing
and service-client discovery. Admitted requests decode the Assignment UUID with
a named boundary schema and reject any `student_id` query parameter. Account-role
labels do not choose classroom authority. Unadmitted requests retain the literal
existing exact-pair/legacy GET remainder; all write handlers remain unchanged.
Malformed present admission and shared-path failures never select a legacy fallback.

Current owners are denied learner access before archive/publication/visibility
concealment. A current nonowner enrollment is required; archived classrooms,
hidden Classwork and unpublished/scheduled Assignments are concealed. The existing
open RPC runs once with the authenticated actor. Its locked create/view/Pal
semantics and `wasFirstView` result remain, with no application-side create or
retry. Immediate Pal delivery after committed creation retains its existing
position before supplementary reads can fail. This does not activate Pal.

Every supplementary payload, page, empty terminal, signing proof and final read
is rooted in the requested Assignment, its current classroom relationship and
the exact current nonowner enrollment. Decoding pins the original owner,
classroom, Assignment publication fields and normalized visibility evidence.
The RPC's passthrough document is not serialized. Fresh explicit document reads
prove its returned ID, Assignment and authenticated learner again.

Unreturned grading fields remain null. Grading is selected only with a matching
non-null `returned_at`; current feedback body is selected only when feedback or
grades have been returned. A final read pins both release timestamps. Previously
released append-only feedback entries remain visible under the existing contract.
Requirements, own submission artifacts and own GitHub identity retain the existing
response fields; joined authorization and managed-object evidence is stripped.
Requirements/feedback/artifacts use bounded UUID keysets through an explicit empty
terminal, including shortened pages. Rich content is parsed using the existing
helper. No owner drafts, unrelated learners or repository-review payload is added.

## Bounds and image compatibility

The reader retains the established20-second abort/raced deadline,1024 statements,
10000 rows per collection,1000-row pages,8MiB statement/final payload,2MiB rich
JSON, depth100 and500000-node bounds. Uncertain, duplicate, substituted, malformed,
stalled or overflowing evidence fails503 without a partial response.

Existing one-hour private-image signing is preserved, not newly activated.
Before each50-image batch, a fresh statement proves current membership, exact own
document, Assignment requirement/type and managed-object/path identity. Accepted
legacy, managed-upload and restore namespaces retain their existing scope.
Storage execution is lazy after the count/deadline guards. SDK responses must
match the configured Storage origin, exact signed path and token shape; failures
reject without partial URLs. Final current relationship proof still runs afterward.
Previously issued links retain their expiry limitation; signing is not atomic
with a subsequent membership/ownership change.

## Evidence and deliberate limits

Regression-first installed-SDK fetch-adapter tests cover actual REST projections,
both account-role labels, release disclosure, pagination, relationship/resource
substitution, current-boundary revocation, image proof/response validation and
exhausted-bound zero-late-POST behavior. The coordinator's seven-suite command
passes161 tests, including unchanged legacy, contextual open/save and240 guards.
These tests do not claim real PostgREST, Storage bytes or authenticated HTTP.

A separate read-only observer is being prepared against the immutable disposable
Assignment-list fixture and reviewed240 replay floor. It will stub only the open
RPC with the fixture's existing exact own document, `created:false` and
`viewed_at_changed:false`; real SDK supplemental reads and the original exact
owner-transfer/member-removal transitions remain independently observable.
No fixture, SQL transition, restoration, canonical DML or cleanup authority is
added. This is read/projection evidence, NOT an integrated create/view/Pal proof.
Fixture gaps and empty supplemental collections must remain explicit in receipts.

Migration240's separate real rollback/atomicity/concurrency checks do not make
this observer a real RPC or browser flow. Nonempty supplementary rows, live image
signing, integrated first-create/Pal, authenticated HTTP/browser and sibling
learner write/history/artifact Classwork visibility remain separate requirements.
Batch2 and the overall epic remain incomplete; production and cutover stay OFF.
