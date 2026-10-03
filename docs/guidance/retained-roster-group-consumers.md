# Retained-roster group consumers — compatibility slice

Status: source prepared, not applied or rolled out. Risk: runtime-platform
(authorization, tenant privacy, destructive-finalization exactness, concurrency).
Model recommendation: GPT-6.1 Sol/high for bounded implementation; GPT-5.6
Sol/high for security and GPT-6.1 Sol/high for compatibility review (Terra unavailable).

This is batch-3 Slice A of the classroom-access roadmap. Migration239 prepares
consumers before the separate grouped-removal writer. Migration164's singleton
index and migration236's duplicate-removal rejection remain installed. Do not
drop the index independently or rewrite applied migrations001–238.

## Authority and exact completion

The private validator locks current classroom ownership and the complete retained
learner generation. Every roster row must agree on enrollment identity and time,
removal time, retained attendance state and stable binding. There must be no active
enrollment; immutable168 Pal evidence must show the same removed scope. Current
owners cannot be cleanup subjects, including historical self-enrollments.

The existing173 academic and175/177 provider consumers use that validator. Live
finalization snapshots exact roster/binding IDs, requires exact deletion counts
and absence, and verifies mapping, generation, operation and fence transitions.
Suppressed, substituted or late writes roll back. OLD/NEW retained identities and
bindings remain fenced independently of a caller-set legacy finalize GUC.
Migration179's queue kicks only after the first inserted job for a generation.
Existing provider policy, cutoff, quarantine, backup exclusion and168 immutability
remain unchanged. The legacy175 global-role prerequisite is intentionally retained;
role-neutral lifecycle integration follows separately.

## Discovery and compatibility

`discover_retained_student_cleanup_groups` is service-role-only. Each100-group
keyset page, including an empty terminal page, proves current ownership and exact
retained identities. A digest binds roster, bindings, operations, fences and Pal
generation metadata across pages. Unknown cursors, changed snapshots or uncertain
responses invalidate the whole projection rather than return partial labels.
Completed operations do not repopulate personal identity.

Apply239 before deploying the new discovery caller. A missing RPC returns503;
there is no permissive table-query fallback. The old application remains compatible
while the singleton writer stays closed. No new provider, account, plan, billing,
shared-admission or UI activation is included.

## Verification boundary

Offline tests and fixed-source review precede local application. The rollback SQL
proof transiently drops the singleton index only inside its transaction to test
future multirow consumers; it restores the exact index, all168 functions/triggers/
RLS/ACL metadata and global table-row fingerprints. Synthetic101-group paging,
ownership/snapshot revocation, exact finalization faults and OLD/NEW fences are
required. The queue callback is replaced with a rollback-only counter: this proves
one local callback attempt, not HTTP delivery. All provider settings changes roll
back. No Storage bytes or real provider operation are exercised.

The wrapper's `--force-failure` fails only after actual SQL rollback/teardown;
it is not a crash-after-commit proof. Actual PostgreSQL execution, genuine generated
types, real SDK/ACL checks, observed two-session concurrency and exact-head CI remain
separate evidence gates. This slice alone completes neither grouped removal nor
batch3, cutover or production rollout.
