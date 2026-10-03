# Contextual announcement member read receipts

Status: PR1439 merged main at98887743 on2026-10-03 after clean initial reviews,
final integration review on2166a3c6 and all five exact-head CI37118772779 gates.
Reviewed migration233 is installed locally and immutable; genuine generated types
match; installed proofs pass. Shared admission and live cutover stay off.
Production remains001–225. This follows owner writes PR1438.

## Existing handler, current relationship

Only POST `/api/student/classrooms/[id]/announcements` gains an early shared-admission
branch. Authenticate the iron-session actor before admission configuration or route
parameters. Missing admission and unmatched actors retain the existing legacy POST;
the independent announcement exact-pair read gate grants no receipt-write permission.
Malformed configured admission returns503. Admitted errors never fall back.

Both global account-role values may mark announcements read as a current, non-owner
member of an active classroom. Owner precedence denies historical self-enrollment.
Neither plan nor a request-supplied role grants access. Hidden joined-list preferences
do not revoke membership. GETs, UI, account plans and production settings are unchanged.

Public success stays `{success:true,marked}`. `marked` counts every eligible
announcement, including existing receipts; it is not the number inserted. The atomic
operation covers the entire set, including more than1,000 rows. Conflict-discarded
receipts retain their ID/read_at and existing BEFORE INSERT archive-revision behavior.

## Atomic operation

`mark_announcements_read_for_member_v1(actor,classroom,cutoff)` is service-only,
SECURITY DEFINER with empty search_path and qualified objects. PUBLIC, anon and
authenticated cannot execute it. Trusted server code supplies the authenticated
actor and one UTC cutoff captured immediately before the RPC, never a request body.

Lock order: classroom-operation advisory fence; existing nonblocking membership
subject/pair locks; hot/cold-purge and attendance-decommission guard; explicit
student-purge fence check; classroom FOR UPDATE NOWAIT; exact actor enrollment
FOR SHARE NOWAIT; every eligible announcement FOR SHARE NOWAIT. Current owner,
archive and enrollment checks apply even to empty or all-duplicate sets. NOWAIT and
the nonblocking subject lock avoid cycles with legacy row-first writers and
subject-first purge. Current membership/resource locks last through the operation.

Eligibility remains `NOT is_draft AND (scheduled_for IS NULL OR scheduled_for <= cutoff)`.
No extra `published_at` filter is introduced. A schedule maturing while the operation
waits remains excluded for that request. Content/publication state is evaluated at
the eligible-set statement, not as a historical snapshot at the cutoff.

The RPC locks/materializes the whole eligible set, inserts actor-bound receipts
with ON CONFLICT DO NOTHING, verifies inserted bindings and then verifies every
selected announcement has its actor-bound receipt. A suppressed/substituted write
or late failure rolls back all receipt and revision changes. Its private result
contains exact actor/classroom bindings and nonnegative `marked`/`inserted` counts.
The server validates canonical IDs, strict SDK envelopes and safe integers with
inserted<=marked, and projects only the existing public success fields.

42501 maps403; P0002 maps404;22023 maps400; PT409 maps409. SQL contention codes
40001/40P01/55P03/55000 become PT409 to avoid PostgREST serialization retries.
Unknown SQL, transport, missing-RPC or malformed-result evidence returns generic503.
A transport503 can follow a committed operation; idempotent retries are safe, but
response validation cannot undo a previously committed transaction.

## Verification and rollout hold

Source TDD, existing legacy regressions and focused checks are required. The local
rollback harness rehearses proposed definitions without applying migration history;
it checks ACLs, both roles, owner/archive/tenant denials, publication/count semantics,
actual lifecycle fence rows and late/suppressed-insert rollback before outer rollback.
Installed-schema concurrency, actual application-adapter SDK probes and exact
synthetic cleanup including durable provisioning audits pass. Final independent
high-risk integration review and CI passed on2166a3c6 before the normal main merge.
Source TDD93 new tests and311 combined announcement regressions pass;
217 focused checks plus static gates pass. Initial two independent reviews were
clean. After verifying exact pika/54322 binding, history001–232 and one-file preview,
coordinator applied233 once under the explicit task-local waiver. Genuine generated
types/check match001–233; the helper uses the typed RPC without a provisional cast.

233 SHA256:03183be05ca88736cd7558844594ee56dec8161cdd65966b934be04a272efb26.
The initial live harness exposed an incorrect immediate-removal-conflict expectation;
real enrollment row locks instead block removal until the receipt transaction ends.
The corrected proof observes the actual wait/commit order. SDK probes
exercise the real application adapter, not just raw service RPC envelopes. No SQL
source alteration, history repair, reset or reapplication is permitted.

Installed harness passes both global roles via the live SDK adapter, current-member
removal/move in both orders, subject/pair-first purge locking, owner/archive/class
deletion, legacy row-first resource and contextual owner-RPC serialization, receipt
contention/duplicates, cutoff crossing and complete1,003-row coverage. Deliberate
post-fixture failure exits1 with unconditional exact audit/revision cleanup. Baseline
returns to3 users/1 classroom/0 announcements/0 receipts/0 tagged audits/sessions.

The user's task-scoped local-migration approval waiver applies only after reviewed
source, exact local target/history and a one-file forward preview. Production
migrations, promotion and cohort activation remain separate. This slice does not
complete batch1 or make the live classroom page/home safe to enable; materials,
roster and later assessment/grade integrations still require their phase exits.
