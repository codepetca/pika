# October 2026 Data API grant audit

The October 20 owner email concerns [Supabase's October 30 change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
to default privileges for newly created public tables and sequences. Existing
object grants remain intact. This assessment covers migration replay as well as
the currently deployed access model; it is not a general security audit.

## Final readiness — 2026-10-20 (America/Toronto)

All three current runtimes are ready for this change; no further migration or
application deployment is required solely for October 30.

- **Pika production:** owner-approved migrations 266–282 were applied once and
  verified, leaving history through 282. The [apply run](https://github.com/codepetca/pika/actions/runs/39476697299)
  and read-only verification confirmed 47 routine bodies/ACLs, 775 service-role
  privilege checks, no browser relation leaks and no automatic relation-default
  leaks. Migration 282 makes the server-only contract explicit. Its one-time
  application approval is consumed; later migrations require new exact approval.
- **HQ active local runtime:** the persistent self-hosted database is unaffected
  by the hosted rollout. Separately approved alignment removed 4,447 excess
  direct privileges and restored 16 source Storage policies and one maintenance
  guard. History now contains 75 **adopted compatibility-baseline** versions
  through `20260917182744`, plus actually applied health migration
  `20261020123940` (`SELECT(id)` on `public.organizations` for `service_role`).
  The health role's bounded read passed. The adopted rows retain NULL statements;
  they do not prove historical execution, backfill completion, restore lineage
  or Storage payload preservation. Local receipts are retained privately.
- **RESPMax:** audited source `85d54cf6a45c2fb6c5ecf49c62dcbccf6add6c55`
  uses direct Postgres access and private schemas. No October 30 migration was
  needed or applied for RESPMax in this work.

**HQ paused hosted project:** it was not resumed, migrated or verified by the
local work. Before any separately authorized resume, deployment or migration,
review that exact hosted target's history/baseline, schema, permissions and
unproved backfill/Storage effects. Local readiness is not hosted acceptance.
Do not replay migrations or repair hosted history based on the adopted local
baseline. The same holds apply to any future reconstruction.

Future public tables and sequences still need explicit role grants/revokes,
appropriate RLS and the existing migration/replay checks. Existing grants are
preserved by the platform change; this status does not authorize new database
writes, feature activation, imports or provider changes.

## Pika

The initial audited source foundation was main `df5525a9c`, migrations 001–280.
Integration extends the replay baseline through main `daaf1a64b`, migration 281.
That migration adds a private attendance-decommission capability table with all
direct client/server access revoked. The grant restatement leaves that denial
intact; the database contract checks it explicitly.
`src/lib/supabase.ts` uses the service-role Data API client. Migration 075 grants
automatic server access, while later contextual migrations remove direct writes
and use narrowly owned RPCs. Removing implicit grants without replacing those
required by server reads/writes would break replay. Granting everything to the
server would reopen deliberately closed access.

Migration 282 records the audited per-object table/sequence privileges, preserves
the normal-path effective ACL matrix, and closes automatic table/sequence grants
for public objects created by Pika's migration owner, `postgres`. Platform-owned
`supabase_admin` defaults remain outside this migration's authority. It does not change
function ACLs, owners, RLS, private schemas, Storage, or feature activation.
Historical migration bytes stay unchanged. Resequencing the grant migration
from 281 to 282 also preserves its previously reviewed SQL bytes.

`scripts/check-data-api-grants-database.sh` verifies both the historical path and
replay with automatic public grants removed. The migration-source policy and
canonical [schema checklist](schema-rollout-checklist.md#explicit-data-api-access-october-30-2026)
govern future objects. Native source profiles admit only the exact new migration
seal, preserving unknown-tail rejection and existing execution authority gates.

## Other owner projects

| Project and audited source | Finding | Treatment |
| --- | --- | --- |
| RESPMax `85d54cf6a45c2fb6c5ecf49c62dcbccf6add6c55` | All 16 migrations use private `app`, `billing`, and `ops` schemas; application transport is Postgres.js with named restricted roles and explicit executor grants. No public tables/sequences are created. | No October 30 SQL change needed. Keep explicit custom-schema ACLs and direct SQL access. |
| Codepet HQ `089c7217099aa914ff5bdaa04a825d2180afec13` | Active persistent runtime is self-hosted. Local alignment, 75-version compatibility adoption and health migration `20261020123940` are verified; paused hosted state is separate. | [HQ #129](https://github.com/codepetca/hq/pull/129)'s explicit health SELECT(id) is applied locally. Review the paused hosted target before any separately authorized resume or migration; see final status above. |
| Attend | Hosted project inactive. No source/replay audit completed in this task. | Review before resumed development; do not infer readiness from inactivity. |

The RESPMax hub was dirty and behind its remote; the assessment used the committed
remote source above rather than changing that checkout. The initial HQ audit was
read-only; its later local alignment/adoption and health application were
separately authorized and verified as recorded above. No business-row migration
replay, historical import or reset occurred. Neither this cross-project audit
nor local application establishes deferred hosted restore acceptance.
