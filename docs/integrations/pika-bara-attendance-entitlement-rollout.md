# Pika–Bara attendance entitlement rollout

This runbook is a control document. It does not authorize a migration,
deployment, entitlement change, flag change, smoke invocation, or production
mutation.

## Authorization model

The global Pika and Bara flags remain the emergency kill switches. Pika runtime
admission has two modes:

- unset or `PIKA_BARA_ATTENDANCE_SCOPE_MODE=exact_canary`: only the configured
  teacher/classroom UUID pair is admitted;
- `PIKA_BARA_ATTENDANCE_SCOPE_MODE=teacher_entitlements`: an active teacher
  entitlement admits every active classroom owned by that teacher. Attendance
  hours remain explicit per classroom; no policy means available but not
  configured, and schedules nothing.

The exact Codepet Labs pair remains configured in both modes and remains the
only scope used by the deployed bidirectional credential smoke. It is not an
authorization fallback in entitlement mode. Classroom
`feature_visibility.attendance` is only the teacher's UI preference and never
grants access.

Entitlements are keyed by stable Pika `users.id`. The service-role-only setter
requires a unique operation UUID, optimistic expected revision, bounded actor
and reason codes, validity window, and source. Every accepted request appends an
audit row. Reusing an operation UUID with identical input is a no-op; different
input is rejected. There is no browser or public operator route.

## Revocation invariant

Revocation immediately denies new policy changes, syncs, session commands,
marks, QR issuance, student check-in, and new normal outbox claims. Each mapped
classroom then advances through `active -> deactivating -> inactive` in bounded
worker pages. Pika supersedes unresolved stale messages and sends only the
latest higher-revision empty schedule. Bara cancels future scheduled
occurrences but preserves open and closed history. An already-open session may
close naturally; signed close/cancel/event and authoritative snapshot cleanup
remain accepted through opaque stored mappings.

An entitlement ending during the 90-day horizon is scheduled conservatively
only through the Toronto calendar day before expiry. The worker later performs
the same deactivation path after expiry.

## Release order

1. Review and merge the Bara contract/test PR first. It proves empty-schedule
   cancellation preserves an already-open occurrence and adds no Pika IDs or
   entitlement fields to Bara.
2. Review and merge the Pika PR second. Migration
   `132_attendance_teacher_entitlements.sql` is additive and the application
   defaults to `exact_canary` when the new mode variable is absent.
3. With fresh authorization naming the exact target and migration, apply 132
   before deploying the Pika commit. Regenerate and verify database types from
   that migrated target. Do not change the scope mode yet.
4. Deploy Bara, then Pika, only under fresh deployment authorization. Keep
   exact-canary mode and run the deployed signed smoke. With the existing
   global flags enabled, use `--mode enabled --scope-mode exact_canary`; any
   skip or failure blocks expansion.
5. Dry-run the initial entitlement operation. The command requires UUIDs and
   explicit timestamps; it never looks up a teacher by email:

   ```bash
   pnpm attendance:entitlement:set -- \
     --operation-id "<new-uuid>" \
     --teacher-id "<pika-users-id>" \
     --status active \
     --valid-from "<iso-timestamp>" \
     --valid-until none \
     --source operator \
     --actor-ref "<opaque-operator-ref>" \
     --reason-code "authorized_attendance" \
     --expected-revision 0
   ```

6. After separate authorization for that exact entitlement operation, set
   `PIKA_ATTENDANCE_ENTITLEMENT_AUTHORIZATION` to the same operation UUID and
   repeat with `--execute`. Inspect only the closed status/revision/duplicate
   result and the aggregate worker health.
7. Seed the verified teacher entitlement while runtime remains exact-canary.
   Then, under a separate flag-change authorization, set
   `PIKA_BARA_ATTENDANCE_SCOPE_MODE=teacher_entitlements` and redeploy Pika.
   Rerun the deployed signed smoke with
   `--mode enabled --scope-mode teacher_entitlements`; the smoke must still use
   the exact pair.
8. Verify that the entitled teacher sees Attendance in every active classroom,
   that a classroom without hours reports not configured, and that saving hours
   produces only that classroom's opaque roster/schedule. Expand by adding
   teacher entitlements, never by adding classroom UUIDs or weakening the
   global flags.

## Kill switch and rollback

For an immediate incident, disable both global attendance flags. This denies
new Pika actions and pauses Bara's schedule automation, but intentionally does
not erase state. For a selective teacher rollback, revoke that entitlement
while both services remain operational long enough for bounded empty-schedule
cleanup to reach `inactive`; then verify aggregate outbox/reconciliation health.
Do not blindly replay superseded work.

Changing back to exact-canary mode is a runtime admission rollback, not remote
schedule cleanup. Revoke affected entitlements and allow their deactivation to
finish before narrowing the mode unless the global emergency kill switch is
required first.

## Preview rule

There is no staging database. Preview must not use, probe, migrate, or compare
against production Supabase. Preview build/type/test evidence may record
`production_only_no_staging_database`, but that skip never satisfies a
production rollout gate. Migration, entitlement, deployment, smoke, and mode
changes require separate production-specific authorization.
