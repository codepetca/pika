# Contextual announcement owner writes

Status: implementation and rollback-definition rehearsal; not yet reviewed,
schema-applied, merged or approved for cohort activation. This is the next bounded
batch-1 slice after announcement reads PR1436, merged as `66fa5de3`.

## Scope and compatibility

The existing teacher POST and announcement PATCH/DELETE handlers gain early
`PIKA_CLASSROOM_EXPERIENCE_ADMISSION` branches. Authentication precedes admission
configuration, route params and bodies. Admission grants no classroom permission.
An admitted account may mutate only a currently owned, active classroom, regardless
of global role. Absent admission or a non-admitted account keeps the existing role
guard and legacy code; the announcement exact-pair read gate grants no write access.
Malformed present configuration fails503; admitted failures never fall back.

GETs, member read-receipt POST, UI, navigation, account plans, billing and production
settings are unchanged. Member read receipts and remaining reachable domains must
be integrated before the classroom experience can roll out.

Feature-owned named schemas validate strict params/bodies once at the request
boundary. The reusable server helper additionally checks canonical actor/resource
bindings for non-route callers. Request decoders live in the validation module,
so the file-level API ratchet does not falsely claim unchanged legacy body debt
has been migrated. Its baseline is unchanged.

Content uses JavaScript trim and must remain nonblank. Titles use the existing
nullable/blank-clear normalizer and60 UTF-16-code-unit limit, also enforced by SQL.
Schedules retain Date-compatible parsing, normalize to ISO and must be future at
request validation; years outside0001–9999 are rejected before persistence to match
the response timestamp contract. A schedule crossing its publication time during a
lock wait remains valid. Immediate publication is computed inside the transaction.

PATCH omission differs from null. Content/title-only edits preserve publication.
Draft=true clears publication/scheduling; scheduling presence publishes either at
that timestamp or immediately for null; draft=false publishes only a formerly
draft row and otherwise preserves timestamps. These decisions use the locked row,
not an earlier preflight. Creation binds author to the trusted actor; edits preserve
historical author and creation time after ownership transfer.

One intentional admitted-path correction: draft=false alone on an already-published
row succeeds as an unchanged no-op, without advancing update time or archive revision.
Actual legacy SDK `update({}).select().single()` returns406/PGRST116 and the old route
returns500 despite no mutation; `scripts/check-announcement-legacy-noop.ts` records
that behavior. The legacy path remains unchanged. Explicit draft=true or content/title
saves still invoke the normal update and revision triggers.

## Atomic database boundary

Provisional migration232 introduces three service-only RPCs:

- `create_announcement_for_owner_v1(actor,class,content,draft,schedule,title)`
- `update_announcement_for_owner_v1(actor,class,announcement,patch)`
- `delete_announcement_for_owner_v1(actor,class,announcement)`

Each validates inputs, acquires the existing classroom-operation advisory fence,
checks purge/decommission lifecycle, locks the classroom `FOR UPDATE NOWAIT` and
checks current owner/archive state. PATCH/DELETE then lock the resource using both
announcement and classroom IDs. Writes repeat both predicates, verify returned
bindings and keep all existing receipt cascades, removed-academic guards and revision
triggers. Late failures roll back within the RPC. NOWAIT avoids lock cycles with
legacy writers holding rows before reaching trigger fences.

The RPCs use SECURITY DEFINER with empty search_path and qualified objects, and
revoke PUBLIC/anon/authenticated execution; only service_role may invoke them.
This matches the established lifecycle protocol: service_role is explicitly denied
direct execution of its internal purge guards, and attendance-decommission tables
are private. This is not a new browser RPC or JWT/RLS authorization design.

Create/update emit only the existing ten announcement fields inside a private
`{announcement}` result. Delete emits `{deleted:true,announcement_id,classroom_id}`;
the server checks both bindings before returning public `{success:true}`. Named
strict schemas reject unknown fields, invalid publication state, malformed SDK
envelopes, simultaneous data/error and substituted bindings. Create verifies author;
PATCH deliberately does not require historical author=current owner.

Status mapping:42501→403; P0002(class) or PT404(resource)→404;22023→400;
PT409/contention→409; transport/unknown SQL/missing RPC/malformed result→generic503.
Creation stays201; PATCH/DELETE stay200. No schema-mismatch fallback to legacy.

## Verification and rollout hold

Focused helper, schema and API tests cover both global roles, strict admission,
auth-before-params/body, publication presence semantics, denied/cross-bound bindings,
malformed response evidence and legacy regressions. TypeScript and lint pass.

`scripts/check-contextual-announcement-owner-rollback.mjs` rehearses definitions,
privileges, title/publication transitions, transferred authorship, owner/archive
denials, real hot-purge/decommission fences and receipt cascades in one transaction.
When functions are absent their definitions are rolled back too; when installed,
the harness uses them without changing schema. It verifies zero synthetic residue
and unchanged installed-function state; it does not apply a migration.

The prepared concurrency/SDK harness requires separately approved migration232:
`scripts/check-contextual-announcement-owner-concurrency.mjs`. It is not verified
until the actual local schema is installed. Its post-fixture failure mode must prove
unconditional exact cleanup including durable provisioning/entitlement audits.
CI replays canonical migration files in an ephemeral database before these checks.

Local schema was observed through230; billing owns installed immutable230 and
provisional231. Keep232 provisional until source/history/numbering are reconciled.
Do not edit generated database types manually or generate from mismatched history.
Exact local migration approval remains required, independent of routine review/main
merge authority. Production schema, cohort admission and full classroom/home cutover
remain held for the five-batch integrated release gates.
