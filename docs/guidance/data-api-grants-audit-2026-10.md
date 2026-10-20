# October 2026 Data API grant audit

The October 20 owner email concerns [Supabase's October 30 change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
to default privileges for newly created public tables and sequences. Existing
object grants remain intact. This assessment covers migration replay as well as
the currently deployed access model; it is not a general security audit.

## Pika

The audited source foundation is main `df5525a9c`, migrations 001–280.
`src/lib/supabase.ts` uses the service-role Data API client. Migration 075 grants
automatic server access, while later contextual migrations remove direct writes
and use narrowly owned RPCs. Removing implicit grants without replacing those
required by server reads/writes would break replay. Granting everything to the
server would reopen deliberately closed access.

Migration 281 records the audited per-object table/sequence privileges, preserves
the normal-path effective ACL matrix, and closes automatic table/sequence grants
for public objects created by Pika's migration owner, `postgres`. Platform-owned
`supabase_admin` defaults remain outside this migration's authority. It does not change
function ACLs, owners, RLS, private schemas, Storage, or feature activation.
Historical migration bytes stay unchanged.

`scripts/check-data-api-grants-database.sh` verifies both the historical path and
replay with automatic public grants removed. The migration-source policy and
canonical [schema checklist](schema-rollout-checklist.md#explicit-data-api-access-october-30-2026)
govern future objects. Native source profiles admit only the exact new migration
seal, preserving unknown-tail rejection and existing execution authority gates.

## Other owner projects

| Project and audited source | Finding | Treatment |
| --- | --- | --- |
| RESPMax `85d54cf6a45c2fb6c5ecf49c62dcbccf6add6c55` | All 16 migrations use private `app`, `billing`, and `ops` schemas; application transport is Postgres.js with named restricted roles and explicit executor grants. No public tables/sequences are created. | No October 30 SQL change needed. Keep explicit custom-schema ACLs and direct SQL access. |
| Codepet HQ `92dd91bc9322cac029071d20662806f60de1bafb` | Hosted project paused; persistent owner runtime is self-hosted and unaffected by this platform rollout. `daily-database-health/handler.ts` nevertheless reads `public.organizations.id` via service_role without an explicit table grant in the replay source. | Prepare a separate additive column-level SELECT grant and actual-role regression in HQ. Its deployment/application authority remains separate. |
| Attend | Hosted project inactive. No source/replay audit completed in this task. | Review before resumed development; do not infer readiness from inactivity. |

The RESPMax hub was dirty and behind its remote; the assessment used the committed
remote source above rather than changing that checkout. HQ's persistent owner
database was inspected only for ACL metadata; no owner rows were copied or reset.
The cross-project audit does not establish deferred hosted restore acceptance.
