# Pika–Bara attendance operational recovery

Status: production completed this sequence through migration 132 and the
enabled `teacher_entitlements` 4/4 deployed smoke on 2026-08-24. The steps below
remain the control sequence for future deployments or recovery.

This runbook is a control document, not authorization to deploy, migrate,
change flags, or requeue hosted events.

## Release and smoke order

1. For future changes, review and merge the Bara change before its companion
   Pika change so the receiving contract exists before Pika can call it. Do not
   run hosted recovery as part of a normal release.
2. Read-only verification must confirm that the named production project
   records Pika migrations through 132 and that the intended runtime remains
   `enabled` in `teacher_entitlements` mode. Do not reapply a recorded migration
   or infer flag, entitlement, or scope authorization from this runbook. Any
   missing record or unexpected runtime state requires a stop and a new review.
3. Deploy matching Bara and Pika commits only with fresh deployment
   authorization. Confirm the Bara production deployment completed its guarded
   Vercel build before invoking the deployed gate from a trusted operator
   environment. Bara's attendance values live in Convex and are proven by this
   runtime round trip, not by the Vercel build or a downloaded environment.
4. For a verification that does not change the current scope, run the deployed
   gate with the current and target scope both fixed to
   `teacher_entitlements`:

   ```bash
   pnpm attendance:smoke:deployed -- \
     --mode enabled \
     --scope-mode teacher_entitlements \
     --target-scope-mode teacher_entitlements \
     --stage production \
     --expected-pika-origin "https://pika.codepet.ca"
   ```

   The command calls the deployed Pika operator route. The route checks the
   actual Vercel Sensitive values against reviewed, pinned production Pika,
   Bara, and Supabase targets and requires the current attendance flag to match
   `--mode`. Only after that audit passes does deployed Pika sign a
   fresh Pika-to-Bara request; deployed Bara verifies it and signs a separate
   callback to deployed Pika. Passing therefore proves both receiver-held
   credential pairs, not a local comparison of secret values. Pika accepts the
   signed legs only without redirects, so a pinned receiver cannot forward a
   signed body or authentication headers to another origin. Pika accepts the
   callback only for the active rate-bounded run's five-minute challenge,
   persisted as a hash and atomically consumed with its transport nonce. Output
   is aggregate only. Any skip, 401, 409, 429, 5xx, scope failure, malformed
   response, or failed direction blocks deployment and rollout expansion.
   After successful operator authentication, a deployed-environment audit
   failure returns only fixed check identifiers and aggregate pass/total counts;
   it never returns configured values. Unauthorized responses contain neither
   those identifiers nor configuration diagnostics.
   The CLI pins `--expected-pika-origin` to the independently configured
   `NEXT_PUBLIC_APP_URL` before reading the dedicated
   `BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET`; the route fails closed unless that
   secret is at least 32 characters and distinct from
   `CRON_SECRET` and every attendance HMAC secret.
   `vercel env pull` and `vercel env run` intentionally return empty values for
   Vercel Sensitive variables. A local static audit using those downloads is
   advisory and is expected to fail closed; it is not hosted rollout evidence.
5. The exact reviewed teacher/Classroom pair remains the smoke scope, while
   runtime admission remains limited to active, audited teacher entitlements.
   An unentitled teacher must remain disabled. Any entitlement change, flag or
   scope-mode change, recovery operation, or rollout expansion needs separate
   explicit authorization and must follow
   `pika-bara-attendance-entitlement-rollout.md`.

## Preview rule when no staging database exists

Preview must never point at or probe the production Supabase database. Running
the deployed smoke command with `--mode pre-enable --stage preview` records
`production_only_no_staging_database` and performs no database or network call.
The reverse callback also rejects before configuration or database access in
Preview.
That skip is expected for preview build evidence but never satisfies a
production rollout gate. A production invocation must return `passed` with all
four aggregate checks true.

Smoke runs and nonces are aggregate-only operational evidence. Each new
production challenge removes at most 100 runs and 100 nonces older than 24
hours; active five-minute challenges are retained. Smoke-only foreign keys
cascade on an otherwise-authorized teacher or Classroom deletion, so the gate
cannot create a permanent tenant-deletion blocker.

## Pika no-claim behavior

`claim_attendance_outbound_message_v1` returns a PostgreSQL composite. Depending
on the PostgREST client representation, no matching dependency-ready row can be
literal `null` or an object containing every composite field with `null`.
Changing the already-deployed RPC return type solely to normalize that wire
shape would create unnecessary migration and generated-type churn. Pika now
defends at the client boundary: both verified no-claim shapes become retryable
`delivery_pending`, while partial or malformed non-null rows fail closed with a
sanitized `invalid_stored_message` error. The durable queued row is unchanged.

## Failed Bara event recovery

Credential failures in Bara remain terminal until a human explicitly authorizes
a recovery run. Snapshot reconciliation may already have restored current Pika
state. Bara's internal recovery operation therefore compares every eligible
failed event with current authoritative Bara revisions:

- current revision: move to `pending` without changing payload or event ID;
- older revision: terminal `superseded`, never replayed;
- missing, future, malformed, non-credential, or attempt-exhausted: unchanged.

The operation is installation-scoped, fixed to `http_401`/`http_403`, limited to
50 rows, capped at 20 delivery attempts and three recovery attempts, idempotent
by request ID, and append-only audited with opaque operator/reason references
and aggregate counts. Each page accepts an audited opaque cursor and returns
`nextCursor`/`isDone`, so an authorized operator can continue past unchanged
rows without increasing the per-call bound. It is an internal Convex mutation,
not a client API.

After fresh authorization naming the deployment, installation, bounds, opaque
operator/reason references, and request ID, an operator may run the equivalent
of:

```bash
pnpm exec convex run --prod pikaOutboxRecovery:recoverFailedEvents \
  '{"installationRef":"<configured-ref>","requestId":"<unique-opaque-id>","operatorRef":"<opaque-operator>","reasonCode":"credentials_repaired","limit":10,"maxDeliveryAttempts":5,"maxRecoveryAttempts":1,"cursor":null}'
```

First inspect the aggregate result. If `isDone` is false, repeat only under the
same authorization with a fresh request ID and the exact returned `nextCursor`.
The normal outbox worker, not the recovery operation, performs delivery. Never
delete, rewrite, or bulk-select hosted events, and never use this command for
the nine known pre-repair failures without fresh explicit authorization.
