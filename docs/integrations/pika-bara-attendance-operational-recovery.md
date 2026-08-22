# Pika–Bara attendance operational recovery

This runbook is a control document, not authorization to deploy, migrate,
change flags, or requeue hosted events.

## Release and smoke order

1. Review and merge the Bara PR first. It adds the internal bounded event
   recovery operation and the mutation-free signed smoke endpoint. Do not run
   hosted recovery.
2. Review and merge the Pika PR second. It adds migration 131, the reverse
   signed smoke ingress, and the operator-protected deployed gate.
3. With both attendance flags still false, obtain one-time authorization for
   Pika migration 131 and apply only that migration to the named production
   project. Deploy matching Bara and Pika commits only with fresh deployment
   authorization.
4. Run both static production `pre-enable` audits, then invoke the deployed
   gate from a trusted operator environment:

   ```bash
   pnpm attendance:smoke:deployed -- \
     --stage production \
     --expected-pika-origin "https://pika.codepet.ca"
   ```

   The command calls the deployed Pika operator route. Deployed Pika signs a
   fresh Pika-to-Bara request; deployed Bara verifies it and signs a separate
   callback to deployed Pika. Passing therefore proves both receiver-held
   credential pairs, not a local comparison of secret values. Output is
   aggregate only. Any skip, 401, 409, 429, 5xx, scope failure, malformed
   response, or failed direction blocks enablement and rollout expansion.
5. Enable or expand only after separate explicit authorization, then rerun the
   static `enabled` audits and the deployed smoke before the exact controlled
   canary. Keep every non-canary teacher/classroom disabled.

## Preview rule when no staging database exists

Preview must never point at or probe the production Supabase database. Running
the deployed smoke command with `--stage preview` records
`production_only_no_staging_database` and performs no database or network call.
That skip is expected for preview build evidence but never satisfies a
production rollout gate. A production invocation must return `passed` with all
three aggregate checks true.

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
and aggregate counts. It is an internal Convex mutation, not a client API.

After fresh authorization naming the deployment, installation, bounds, opaque
operator/reason references, and request ID, an operator may run the equivalent
of:

```bash
pnpm exec convex run --prod pikaOutboxRecovery:recoverFailedEvents \
  '{"installationRef":"<configured-ref>","requestId":"<unique-opaque-id>","operatorRef":"<opaque-operator>","reasonCode":"credentials_repaired","limit":10,"maxDeliveryAttempts":5,"maxRecoveryAttempts":1,"now":<epoch-ms>}'
```

First inspect the aggregate result. The normal outbox worker, not the recovery
operation, performs delivery. Never delete, rewrite, or bulk-select hosted
events, and never use this command for the nine known pre-repair failures
without fresh explicit authorization.
