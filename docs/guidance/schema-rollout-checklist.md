# Schema And Query Rollout Checklist

Use this checklist for migrations, Supabase query-shape changes, compatibility shims, and any PR that changes stored fields or API payload shaping.

## Read This When

- adding or editing a migration
- changing a Supabase `select(...)` shape
- introducing a new persisted field
- adding a fallback for pre-migration or partially rolled-out environments
- changing a teacher or student API response contract

## Pre-Change Checks

- Name the rollout risk: schema mismatch, query widening, backfill correctness, payload drift, or compatibility window
- Prefer explicit column lists over `select('*')`
- Confirm browser-side Supabase access is not being added
- Confirm writes stay in server routes with existing auth helpers
- Identify whether reads must tolerate both pre-migration and post-migration schemas during rollout

## Migration Checklist

- Backfill is deterministic and scoped correctly
- Constraints/defaults match the intended application behavior
- Migration numbering does not collide with `origin/main`
- Any compatibility window is documented in the PR notes
- AI does not apply migrations locally; humans do

## Query And Payload Checklist

- Narrow the select list to rendered or returned fields
- Avoid accidentally exposing extra columns while adding a new field
- Keep teacher/student response shaping explicit when rollout fallbacks exist
- Add a regression for the fallback path when a new column is unavailable
- Add a regression for the steady-state path when the column is present

## Review Prompt

Before opening the PR, answer:

```text
What widened?
What fallback exists?
What breaks if the migration has not been applied yet?
Which regression proves the intended payload shape?
```
