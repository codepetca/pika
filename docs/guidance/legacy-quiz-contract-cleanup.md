# Legacy Quiz Contract Cleanup

Use this guide when removing remaining internal `quiz` / `quizzes` contracts
after the product surface moved to Tests.

## Current Decision

Quiz is not a compatibility domain. Existing Quiz rows, drafts, copied
envelopes, and Quiz portions of archive-v1 artifacts are disposable. Active
code must use Tests and must not fall back to Quiz tables or v1 archive RPCs.

Historical migration text is immutable and may retain Quiz names. A narrow v1
artifact reader may identify Quiz resources only to discard them while
restoring non-Quiz classroom data.

Migration creation and migration application are separate permissions.
Applying any migration still requires one-time authorization naming the target
and exact filename.

## Completed

- Removed the product Quiz routes, navigation, labels, API response aliases,
  type aliases, and UI wrappers.
- Removed active gradebook reads of Quiz tables.
- Added explicit archive-v1/v2 contracts and migration-controlled v2 RPCs.
- Froze and rehearsed the legacy graph in migration 106.
- Prepared migration 107 and strict application dispatch:
  - direct source-contract-2 export;
  - v2-only restore and compaction;
  - no pre-107 fallback;
  - Quiz draft and copied-envelope deletion;
  - v1 restore discards Quiz resources.

## Active Compatibility To Remove

The hard-removal pass must address:

- database tables, policies, triggers, indexes, update functions, and grants
  for `quizzes`, `quiz_questions`, `quiz_responses`, and
  `quiz_student_scores`;
- `quiz_id` database-shaped fields and generated types;
- assessment draft unions and dead Quiz question-sync branches;
- gradebook `quizzes_*` and empty `quizzes` response tombstones;
- course package, site configuration, and blueprint `quizzes` fields;
- current server/type/UI names that still accept `'quiz'` even though no
  product route produces it;
- retirement inventory/backfill utilities after the destructive catalog audit
  no longer needs them.

Legacy URL tombstone tests may remain only when they prove an old URL cannot
reopen a removed surface. UI absence tests may mention Quizzes as a negative
assertion.

## Hard-Removal Exit Criteria

After migration `108_drop_legacy_quiz_schema.sql` and its application cleanup:

1. No active application query references a Quiz table.
2. No current API payload or TypeScript domain type exposes Quiz keys.
3. No current package producer writes a Quiz field.
4. PostgreSQL catalog inspection finds no live Quiz table, function, trigger,
   policy, index, or grant.
5. Tests and generated database types match the post-drop schema.
6. Remaining repository hits are restricted to immutable migrations,
   migration-history validation, the discard-only v1 artifact boundary, and
   explicit negative/tombstone tests.

## Validation

Run:

```bash
rg -n --hidden --glob '!node_modules' --glob '!.git' \
  '(?i)\bquiz(?:zes)?\b|quiz_|_quiz'
pnpm exec tsc --noEmit
pnpm lint
pnpm check:architecture
pnpm check:ui-policy
pnpm test
bash scripts/check-legacy-quiz-freeze-backfill.sh
```

The final migration also needs a disposable full replay, post-drop catalog
assertions, independent review, and exact-head CI. Do not apply it to shared
local or hosted databases without exact target-and-filename authorization.
