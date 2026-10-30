# Managed RepoLight connection source

This source slice adds a private provisioning registry and server adapter. It is
dormant: existing environment-configured connections, reports and cleanup remain
on their current adapters. No hosted migration, credential creation or rollout
has occurred. Migration 297 depends on the eligibility contract in 296.

`createManagedRepoLightRegistry(store, options)` exposes:

* `ensure(teacherId)`: requires `PIKA_REPOLIGHT_MANAGED_ENABLED=true` and the
  trusted database eligibility resolver's `allowed=true`, including when its
  enforcement flag is false. It durably prepares one encrypted credential and
  operation, provisions, attests `/api/v2/connection`, rechecks eligibility, then
  activates under database plan/owner locks. Uncertain retries use the saved
  operation, tenant, key ID, hash and ciphertext.
* `rotate(teacherId)`: service maintenance only; the caller must authorize the
  owner's recovery intent before invoking it. Rotation can repair cleanup access
  after a downgrade and grants no analysis permission. Persist the replacement
  encrypted credential and expected current key ID before HTTP. Resume any pending
  rotation before allocating another. Attest the replacement before activation.
  Provider rotation revokes the predecessor key; queued/running jobs may fail.
  Existing completed reports and local report rows remain retained.
* `resolveSaved(teacherId, connectionRef)`: read only; performs no provisioning or
  entitlement check. After caller authorization of the report or destructive
  lifecycle, it resolves the saved locator to the latest confirmed credential in
  the same tenant/workspace/installation/origin. A pending rotation blocks lookup
  because the old key may already be revoked. Old ciphertext and locators remain
  retained. An injected `keyring` permits this path without control credentials or
  current provisioning configuration.

The response is `{connection: RepoLightConnection, apiOrigin: string}`. Connection
objects contain a plaintext server credential in memory; never send them to the
browser, persist them in report JSON or log them. Continue storing only the saved
connection reference and workspace/installation binding in report runs/subjects.

## Configuration and transport

All variables are server only:

| Variable | Meaning |
| --- | --- |
| `PIKA_REPOLIGHT_MANAGED_ENABLED` | Separate new-provisioning flag, default false |
| `REPOLIGHT_API_URL` | Existing validated HTTPS origin; literal loopback HTTP only in development |
| `REPOLIGHT_MANAGED_INSTALLATION_REF` | Opaque installation configured on the service |
| `REPOLIGHT_MANAGED_CONTROL_SECRET` | Dedicated canonical 32-byte base64url control bearer |
| `REPOLIGHT_MANAGED_ACTIVE_ENCRYPTION_KEY_ID` | Identifier for new ciphertext |
| `REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON` | Identifier-to-canonical 32-byte-base64url AES key map; retain old entries |

Use independently generated control and encryption keys. AES-256-GCM uses a fresh
96-bit nonce and authenticates owner, tenant, operation kind/ID, predecessor key,
new key/hash, connection locator, origin and installation as associated data.
The private table has RLS and no direct grants, including to `service_role`.
Only explicitly granted server RPCs can prepare, read or activate records. No FK
cascade discards cleanup keys when an account is removed. Retention/deletion of
this private operational evidence needs an explicit future decommission policy.

`POST /api/v2/managed/provision` receives exactly
`{schemaVersion:'1.0',tenantRef,operationRef,keyId,secretHash}`.
`POST /api/v2/managed/rotate` additionally requires `expectedKeyId`.
Both use `Authorization: Bearer <control secret>`; `secretHash` is lower-hex
SHA256 of the secret suffix, never the plaintext key. UUIDs are canonical lowercase.
The strict response is `{schemaVersion:'1.0',workspaceRef,installationRef,keyId}`.
The adapter checks binding, then attests the bearer
`rl_v2_<keyId>.<32-byte-base64url-secret>` using `/api/v2/connection`, requiring
create/read/erase scopes. It rejects redirects, bounds JSON to 8192 bytes, enforces
an 8-second default operation timeout (maximum 15 seconds), and logs no responses.

## Required integration before rollout

1. Replay 296+297 in the owned disposable full Pika schema, generate database
   types using the established tool, and supply the exact typed RPC wrappers to
   `createManagedRepoLightDatabase`. The source adapter deliberately accepts an
   injected RPC transport rather than casting missing names into generated types.
   Update the closed migration inventory/profile and schema-resource audit for
   this private operational table. Do not manually edit generated types.
2. Invoke `ensure` automatically from the authenticated eligible teacher feature
   entry/begin path. For immediate setup after successful subscription/trial,
   commit a provisioning outbox intent with the plan event and process it in a
   bounded existing worker after commit. This slice adds no event hooks, worker,
   manual setup UI, scheduler or automatic entitlement activation.
3. Resolve saved run/cleanup connection references through the registry while
   retaining the existing environment resolver for old locators. Saved lookups
   require exact actor/resource/lifecycle authorization before credential use.
   Never silently move an uncertain create to a different subject or installation.
4. Recheck new-analysis eligibility inside begin/authorize SQL and immediately
   before HTTP. Provision locks settings → account-plan-subject → effective
   feature → registry owner → workspace. Rotation takes owner → workspace and
   never acquires plan locks. Recheck timed access after blocking locks. The
   unavoidable transaction-commit-to-HTTP gap remains a boundary; a provisioning
   credential alone never authorizes new analysis.
5. Route credential recovery to the authorized service-maintenance operation;
   resume a pending rotation when cleanup sees `repolight_managed_pending`.
   Keep report/cleanup usable after downgrade. The service credential still has
   create scope; Pika must keep its entitlement gate on every new create.

The isolated registry harness replays 297 against a stub eligibility boundary in
its own networkless disposable container and checks ACLs, duplicate provisioning,
activation replay, denied activation, cross-owner lookup/workspace denial,
credential history, rotation after eligibility loss and stale predecessor denial.
It does not replace full-chain native plan-lock races or generated schema checks.
Unit tests cover authenticated encryption, durable unknown-outcome retries,
strict bounded transport, late entitlement loss, response attestation, rotation
replay and saved cleanup resolution after downgrade.
