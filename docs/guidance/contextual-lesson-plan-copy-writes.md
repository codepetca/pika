# Dormant shared-admission lesson-plan copy

This is a bounded batch-1 preparation slice, not cohort activation or a new UI.
Date PR1424 and bulk PR1426 are merged; installed226/227 stay immutable. Copy229
is proposed, not applied. The local preview on2026-10-02 discovered billing228
already installed but absent from this branch/main, so reconciliation with the
billing-owned merge must precede another local application or type generation.
No history repair, reset, out-of-order apply or adoption of billing work is allowed.
Production's last verified floor remains001–225; production was not queried here.

## Authorization and compatibility

The existing shared lesson-plan mutation admission is reused. Authentication
precedes params/body; a named UUID/current-owner preflight precedes strict real
calendar dates and distinct `{ fromDate, toDate }` validation. Admission grants
no classroom access. Either global role can act only as the current active owner.
The service-only RPC independently checks the actor at transaction time.

Unadmitted accounts retain the original teacher-only copy route, body behavior,
source/content-only legacy copy and201 response. There is no alternate database
or legacy fallback after an admitted RPC fails. The API Zod ratchet removes this
file from its baseline because the admitted boundary is named/validated; the
unchanged legacy cast is a deliberate compatibility debt, not a claim of strict
legacy body validation. No page, plan, billing, AI or admission configuration changes.

## Atomic copy contract

`copy_lesson_plan_for_owner_v1` acquires the existing classroom operation fence,
checks the purge guard and locks the current classroom NOWAIT. Missing classroom
is404; wrong owner/archive is403. It then locks existing source/destination plans
in date order NOWAIT; missing source is404. The actor is the iron-session UUID,
not Supabase Auth/global teacher role. SECURITY DEFINER has an empty search path,
qualified objects and execute privileges restricted to service_role.

Persisted source content is validated recursively before writing. Invalid nodes,
missing types, malformed marks/attrs, over100depth or10,000nodes fail503 without
changing the destination. Node type/text use UTF-8 byte bounds as a conservative
bound on JavaScript UTF-16 lengths: some otherwise valid non-ASCII values near
the100type/1,000,000text limits may be rejected. This temporary conservative
policy is intentional; it never permits oversized content to commit and then
fail the response decoder. Root docs with omitted content remain valid.

Copy writes both source `content` and its raw nullable `content_markdown`, without
Markdown conversion or normalization. A blank source is an upsert, not deletion.
Existing destination identity, artifact ID, created time, lineage and Blueprint
archive metadata remain unchanged. New destinations receive normal new identity
and null lineage, even when the source has lineage. Source rows never change.
Ordered heads are neither advanced nor reset; copy has no new sequence protocol.

The explicit eleven-field destination result is returned inside one strict SDK
envelope, including null error metadata. The app verifies classroom/date binding;
it does not re-read the row or normalize Markdown. Contention/deadlock/serialization
and lifecycle conflicts map409, invalid input400 and unavailable/unverifiable RPC503.
Database errors roll back content and both revision families together. Network
failure after commit remains ambiguous, as with existing unversioned operations.

No triggers or lifecycle guards are disabled. Content-only copy does not pretend
to check the Blueprint lineage purge lock: the existing lineage trigger does not
fire for these update columns. A rollback-only, random-fixture-scoped fault trigger
is instead used to test a genuine late database failure, with state comparison
inside the transaction before the harness's outer rollback.

## Verification and hold

Source TDD, route/SDK error and binding tests, unchanged legacy copy tests, SQL
static checks and a guarded synthetic harness are prepared. The harness requires
already-installed229 and the local pika container/54322; it never applies schema.
It covers both owner roles, both content representations, identity/lineage/heads,
malformed source, privileges, source/destination locks, real REST/SDK409, date/bulk/
legacy writes in both orders, source/destination deletion, fresh destination
insertion, reverse copy, owner transfer/archive, purge and late-failure rollback.
CI runs both its positive path and forced post-fixture cleanup proof with portable
two-sentinel checks. Teardown uses exact tagged UUID/operation pairs, clears both
durable audit tables, preserves guards and verifies zero synthetic residue.

These harness scenarios are requirements and prepared source, not runtime receipts.
SQL preapplication review, exact local229 approval after228 reconciliation, legitimate
generated types, real database runs, full focused checks, independent final reviewed
SHA and main PR Gate are still required. No production application, promotion,
account changes or cohort activation follows merely from this slice passing.
