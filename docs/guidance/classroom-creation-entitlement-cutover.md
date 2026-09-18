# Classroom creation entitlement cutover

Status: migration 181 is an additive implementation slice. Its source landing does not
authorize local, staging or production application, account classification, strict
activation, app deployment or neutral onboarding. Follow
[`schema-rollout-checklist.md`](schema-rollout-checklist.md) for each environment.

## Resulting policy

- Free is the default for accounts created after migration 181: joining remains available
  through the existing role-compatible paths, but `classrooms.create` is disabled with a
  zero quota.
- Access is a manual `classrooms.create` grant with `enabled=true` and `quota_limit=1`.
- Existing classrooms are preserved. Accounts already above one active owned classroom can
  continue using and editing them, but cannot create, restore or receive another active
  classroom until their active count is below the grant limit.
- Trial remains a separate future grant. Plus and Pro remain product labels, not roles.
- `users.role` and the current teacher-only creation route are unchanged by this slice.

## Two-release boundary

### Release A — additive schema

Apply migration 181 only after exact target/file authorization. It:

1. creates a private, disabled strict-enforcement singleton;
2. provisions every subsequently inserted `public.users` row with one audited Free
   `classrooms.create` snapshot in the same transaction;
3. adds service-only readiness and activation RPCs;
4. updates the authoritative creation assertion so a missing snapshot fails closed only
   after controlled activation (or when audit history proves the account was managed).

Migration 181 does not backfill, classify or deny existing unmanaged accounts, and it does
not activate strict enforcement. The signup trigger, creation assertion and activation RPC
share a transaction-held settings-row lock, so activation cannot cross an in-flight legacy
creation or commit an account without its default Free snapshot.

### Release B — controlled classification and activation

Use unique operation UUIDs and the existing service-only
`set_effective_feature_entitlement_v1` RPC. Do not put production account IDs or email
addresses in source control.

1. Record the exact application SHA, migration state, operator, change window and current
   classroom-owner inventory.
2. Grant Access only to the explicitly approved existing owners. Classify every other
   current account as Free. Each write needs an actor reference, reason code and expected
   revision; retain the operation IDs in the private release record.
3. Read `get_classroom_creation_entitlement_cutover_status_v1`. Require
   `unclassified_account_count=0`, the expected account total and strict enforcement still
   disabled. Reconcile any difference before continuing.
4. Run the pre-activation canaries below.
5. With separate production authorization, call
   `activate_classroom_creation_entitlement_cutover_v1` once using a new operation UUID and
   named operator reference. The database rechecks complete coverage while holding the
   cutover lock. Activation is one-way through the service API; reversal requires a reviewed
   forward change.
6. Re-read status and retain the activation operation, actor, timestamp and canary results.

Classification itself is enforcement for each managed account. Stage and verify grants in
small, named batches; strict activation only removes the remaining legacy-missing fallback.
If a classification is wrong, correct it through the revisioned setter rather than deleting
the live snapshot or changing `users.role`.

## Required canaries

Use synthetic accounts/classes where possible and preserve active teaching data.

- Free: join an allowed classroom; ordinary creation and Blueprint creation are denied.
- Access with zero active owned classrooms: ordinary creation succeeds once; an unchanged
  retry replays the same classroom.
- Access at one active owned classroom: ordinary creation, Blueprint creation, ownership
  transfer and restore of another archived classroom are denied by the active limit.
- Archive the active classroom: one replacement creation succeeds; restoring the archived
  classroom while the replacement is active is denied.
- Existing over-limit owner: existing classrooms remain readable/editable; no additional
  active-classroom consumption succeeds.
- Unknown/missing snapshot after strict activation: creation returns unavailable rather
  than silently restoring legacy access.
- Existing login, join, submission, grading and attendance smoke tests remain healthy.

Stop if counts drift, any unapproved account has Access, joining/student work regresses,
existing classrooms change ownership/lifecycle state, or a creation path bypasses the
database assertion. Do not delete classrooms, archive them automatically or rewrite roles
as remediation.

## Recovery

- Before strict activation, stop classification and correct individual snapshots through
  the setter. Unmanaged accounts still use legacy creation compatibility.
- After strict activation, repair a missing/malformed account snapshot through the setter.
  A systemic rollback requires a reviewed forward migration; direct settings edits are not
  an operator interface.
- Changing a grant never deletes or archives a classroom. Restore capacity by correcting
  the grant or intentionally archiving a classroom through the normal owner workflow.
- Migration application and hosted writes remain separately authorized actions. A source
  merge or application deployment is not permission to perform either.
