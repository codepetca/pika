# Schema And Query Rollout Checklist

Use this checklist for migrations, Supabase query-shape changes, compatibility shims, and any PR that changes stored fields or API payload shaping.

## Read This When

- adding or editing a migration
- changing a Supabase `select(...)` shape
- introducing a new persisted field
- adding a fallback for pre-migration or partially rolled-out environments
- changing a teacher or student API response contract
- renaming an active contract while legacy keys, props, or helpers remain supported

## Pre-Change Checks

- Name the rollout risk: schema mismatch, query widening, backfill correctness, payload drift, or compatibility window
- Prefer explicit column lists over `select('*')`
- Confirm browser-side Supabase access is not being added
- Confirm writes stay in server routes with existing auth helpers
- Identify whether reads must tolerate both pre-migration and post-migration schemas during rollout
- Name the compatibility boundary explicitly: persisted schema, API payload, TypeScript alias, prop contract, or test fixture contract

## Migration Checklist

- Backfill is deterministic and scoped correctly
- Constraints/defaults match the intended application behavior
- Migration numbering does not collide with `origin/main`
- Any compatibility window is documented in the PR notes
- Migration application remains human-controlled unless the authorization contract below is satisfied

## AI Migration Application Authorization

Migration application is human-controlled by default. An AI agent may execute it only when the user
gives a direct, one-time instruction in the current task that names both the target environment
(`local`, `staging`, or `production`) and the exact migration number(s) or filename(s). Broad requests
such as "apply migrations", "continue", or approval from an earlier task are not authorization.
Permission expires after one attempted non-dry-run application command and cannot be reused for a
retry or a different target.

Before applying an authorized migration:

1. Resolve the repository root and verify the checkout containing the approved migration.
2. Verify the Supabase target binding without printing credentials or secrets.
3. Run `supabase migration list` and then `supabase db push --dry-run` with the explicit `--local` or
   `--linked` target. Stop if the preview includes any unapproved migration or history drift.
4. Confirm applicable tests and migration replay checks passed. If the migration contains destructive
   or irreversible SQL, the permission must explicitly acknowledge that impact.

During and after application:

- Apply reviewed migration files through `supabase db push` with the verified target flag. Do not
  paste migration SQL into the Dashboard SQL editor or `psql` unless separately authorized.
- Apply only the approved migration set to the approved target. Do not add `--include-all`,
  `--include-roles`, `--include-seed`, change the linked project, or use an alternate `--db-url`
  without separate permission.
- Migration approval never authorizes `supabase db reset`, migration history repair, rollback/down
  operations, seeding, data cleanup, or Storage deletion. Each requires separate explicit approval.
- Stop on unexpected prompts, target mismatches, extra migrations, or partial failure. Report the
  durable state and obtain new permission before retrying.
- Re-run `supabase migration list`, verify the relevant database contract with read-only checks, and
  report the target, applied migration numbers, and verification result without exposing secrets.

## Generated Database Contract

- Do not edit `src/types/database.generated.ts` by hand
- Regenerate it from the local migration schema with `pnpm run db:types:generate`
- Generation stops if the running local database migration history differs from the current worktree
- Keep application-specific JSON/status/RPC refinements in `src/types/database.ts`
- Use `TableRow`, `TableInsert`, or `TableUpdate` for persisted payloads instead of `Record<string, ...>`
- Run `pnpm run db:types:check` before opening the PR
- Confirm the CI `Database Contract` job passes; it replays the branch migrations in an ephemeral Supabase database before checking drift
- If a compatibility shim intentionally writes a pre-migration shape, isolate and document that exception instead of weakening the shared current-schema contract

## Query And Payload Checklist

- Narrow the select list to rendered or returned fields
- Avoid accidentally exposing extra columns while adding a new field
- Keep teacher/student response shaping explicit when rollout fallbacks exist
- Decide whether the pass is dual-read, dual-write, or dual-read plus dual-write; do not leave that implicit
- List every in-repo producer and consumer that still touches the legacy key or shape
- Add a regression for any current-path reader that must prefer the new key while still accepting the legacy fallback
- Add a regression for the fallback path when a new column is unavailable
- Add a regression for the steady-state path when the column is present

## Compatibility Migration Slice

When the change is a naming or contract migration, split the work into narrow passes:

- producers: where the contract is emitted or stored
- active consumers: current UI, hooks, and server readers
- compatibility aliases: wrappers, fallback readers, legacy response keys
- tests and fixtures: current-path wording versus deliberate fallback coverage
- docs: guidance that should explain what remains intentionally legacy

Each pass should say what is intentionally not changing yet.

## Review Prompt

Before opening the PR, answer:

```text
What widened?
What fallback exists?
What breaks if the migration has not been applied yet?
Which regression proves the intended payload shape?
Which readers now prefer the new contract first?
Which legacy readers or aliases are intentionally still alive after this pass?
```
