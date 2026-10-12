# Contextual owner whole-Test deletion

Prepare dormant current-owner access to the existing bodyless
`DELETE /api/teacher/tests/[id]`. Reuse complete-experience admission: absent or
unmatched admission retains the literal legacy teacher branch; an admitted
failure never falls back or retries. Current active Classroom ownership, not
global account role, Test creator, enrollment or subscription, authorizes the
new path. No UI, confirmation, rollout switch or provider operation changes.

## Compatibility-first scope

Preserve migration094's `delete_test_atomic` algorithm and response:
`{ success: true, responses_count }`. This is whole-Test deletion, not pristine
draft discard or attempt reset. Existing FK cascades, score-override cleanup,
Blueprint/archive revisions, removed-academic-parent/provider-purge fences,
managed reference removal and durable cleanup queues still execute normally.
Do not invoke Storage deletion, cleanup workers, providers or purge services.

Do not introduce a retention policy in this permission slice. The existing
polymorphic Draft remains as094 leaves it; no new Draft cleanup/repair is added.
Existing queued/running AI and former-member work behavior remains subject to
the inherited transaction and trigger rules, not a new blanket eligibility
restriction. Future retention or AI-cancellation changes need separate policy,
service-lifecycle design and review. Preserve other-Class corrupt override
behavior rather than silently repairing unrelated records.

## Transaction and acknowledgement plan

Add one `delete` operation to the existing seven-argument owner transaction in
an additive migration. Preserve its settings, Test advisory, Classroom
operation/membership, parent, actor and Test lock order; active owner/fixed
parent, archive/retired Blueprint/purge/maintenance and absolute deadline fences;
and full expected-Test CAS. Call the existing delete RPC once under those locks.
Do not modify094 or any installed predecessor migration.

Deletion needs an explicit absence postcondition: a successful legacy result
is not enough if deletion was suppressed or the same ID reinserted. A deletion
acknowledgement binds the actor, operation, original Test and fixed Classroom;
its Test witness is the captured pre-delete source, not a surviving row. Validate
that source and the strict legacy deletion result before exposing only the
existing public response. Keep the original captured CAS; do not refresh it
from a mutation acknowledgement. Do not claim the Test-row CAS covers every
child/history/grade revision or add a new child-confirmation protocol.

## Acceptance

Tests precede implementation. Cover literal dispatch, both current-owner account
roles, self-enrollment, member/former-owner/foreign-creator/wrong-parent denials,
archive/Blueprint/purge/provider fences, stale source, strict absence/result
acknowledgements, deadlines/cancellation and no fallback/retry. Prove precise
existing cascades, response counts, retained Draft and shared material behavior,
other-Class/user preservation, suppressed deletion/reinsertion/late-fault atomic
rollback and actual writer contention. Reuse the existing finite native engine
and exact sealed successor profiles, not another verification framework.

Source/mock tests are not native acceptance. Complete fresh reviewed-source
disposable replay, genuine types, rollback/ACL, populated concurrency, real SDK,
cancellation/backend settlement, full restoration/preservation and exact cleanup
before final reviewed-head CI/PR Gate and normal protected-main merge.

This document grants no database execution or activation authority. Standing
reasonable-work delegation covers source implementation, review and normal main
merge; independently reviewed exact disposable attempts remain separately bound.
Shared local249+, production259+, promotion, provider/billing/account and
admission/home/page/cohort/cutover holds remain unchanged. This slice alone does
not establish Tests-phase or overall goal completion.
