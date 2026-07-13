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
- AI does not apply migrations locally; humans do

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
