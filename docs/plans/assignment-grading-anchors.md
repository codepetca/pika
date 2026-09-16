# Assignment score anchors

Per-assignment score-band descriptors, generated once and reused for every
submission, so the grader has a reason to use the middle of the scale.

Risk profiles: grading-behavior, schema, provider-egress. Rollout is flag-gated
and staged; stage 1 ships no schema change.

## Problem

`pika-assignment` grades with three criteria whose only definition is a one-line
question ("Does the work show depth of thought?"). Nothing tells the model what
separates a 6 from a 9 on a particular assignment, so scores cluster near the top
and stop discriminating between students.

Test grading already solves the adjacent problem: `ai-test-grading.ts` prefers a
teacher `answer_key` and otherwise generates and caches reference answers per
question. Assignments have no equivalent.

## Why anchors and not an exemplar

The assignment rubric is Completion / Thinking / Workflow: a quality rubric, not
a correctness rubric. A single model-written "correct solution" makes the grader
score similarity to that solution, which penalises valid alternative approaches
on the divergent half of Pika's assignments (reflections, narratives, open
projects). Band descriptors state observable qualities per score range instead,
so a different-but-strong submission can still reach 9-10, and they work for
convergent assignments too because the top-band descriptor naturally contains the
solution shape.

Known risk: the same model generates and applies the anchors, so it can favour
its own style. Mitigated by descriptors-not-answers, by the flag-gated A/B below,
and later by per-criterion evidence quotes and teacher editing.

## Stage 1 — shipped, no schema change

Landed in this branch. Nothing persists; anchors are passed in memory.

| Piece | Location |
|---|---|
| Anchor generation profile | `src/lib/grading/profiles/pika-assignment-anchors.ts` |
| Anchored grading profile | `src/lib/grading/profiles/pika-assignment-anchored.ts` |
| Adapter entry points | `generateAssignmentAnchors`, `gradeStudentWork({ anchors })` |
| Flag | `ASSIGNMENT_GRADING_ANCHORS_ENABLED` (default false) |
| Offline A/B | `pnpm eval:assignment-anchors <class-code> <title>` (add `--show` to print the payload without calling the provider) |

Design decisions worth keeping:

- **Bands are fixed in code** (`9-10`, `7-8`, `4-6`, `0-3`). The model supplies
  descriptors only, so it cannot emit overlapping or missing ranges.
- **Anchored grading is a separate profile**, not a flag inside the existing one.
  It shares the rubric, the output schema and `normalizeOutput`, and differs only
  in prompt and version identifiers. A persisted grade therefore records whether
  anchors were used, through `promptVersion` and `gradingProfileVersion`, with no
  change to `assignment-grading-provenance-v1` and no migration.
- **Rubric version does not move.** Criteria, scales and weights are unchanged;
  only the guidance around them changed.
- **Thin instructions are surfaced, not hidden.** Anchors derive from the
  instructions alone, so `hasThinAnchorInstructions` flags assignments where the
  anchors are guesswork.
- Anchor text is sanitized on the way out with `sanitizeAiOutputText` because it
  is teacher-facing, and generation failures stay content-free.

### Gate before stage 2

Run the A/B on real A1 submissions. The evaluation reads them through
`buildAssignmentGradingRequest`, so the text it sends is byte-for-byte the text
normal grading sends: same instruction extraction, same submission body, same
attached artifacts, same roster-aware sanitization. `--show` prints that payload
and makes no provider calls.

Sanitization replaces roster names with initials and redacts emails, phone
numbers, URLs and identifiers. It does not remove the substance of what a student
wrote, so a sanitized reflection is still that student's reflection. Treat the
output as classroom data.

Proceed only if the anchored arm widens score spread without inverting the
teacher's own ranking. If spread is unchanged, the anchors are not the bottleneck
and the instructions probably are.

## Stage 2 — persistence and a read-only teacher surface

Only worth building once stage 1's gate passes. `src/types/database.generated.ts`
must be regenerated in the same commit as the migration or the CI
`Database Contract` job fails.

### Regenerating types without Docker images

`pnpm db:types:generate` needs `supabase start`, and `supabase gen types` shells
out to the `supabase/postgres-meta` image, so both need image pulls. In a sandbox
where the registry is unreachable the whole chain can still be run locally, and
this was verified against the 175 migrations on this branch:

1. Run a plain PostgreSQL 16 server as a non-root user.
2. Apply a small bootstrap: roles (`anon`, `authenticated`, `service_role`,
   `authenticator`, `supabase_admin`, `supabase_storage_admin`), schemas `auth`,
   `storage` and `extensions`, `pgcrypto` and `uuid-ossp` into `extensions`, and
   stubs for `auth.uid()`, `auth.role()`, `storage.buckets`, `storage.objects`
   and `storage.foldername()`. That is the entire Supabase-specific surface the
   migration set touches.
3. Replay `supabase/migrations/*.sql` in filename order with `ON_ERROR_STOP=1`.
4. Generate with the `@supabase/postgres-meta` npm package instead of the image:
   `getGeneratorMetadata(pgMeta, { includedSchemas: ['public'] })` piped into the
   package's `templates/typescript.js` `apply`, then the blank-line normalization
   from `scripts/supabase-types.sh`.

Result: all 11,370-odd lines of table, column, relationship and function types
match the committed file exactly. The only difference is prettier formatting of
the static helper types in the footer, because postgres-meta bundles its own
prettier. Splice the committed footer back, or run the repo's formatter, before
committing a regenerated file produced this way.

This is a fallback for constrained environments. A normal checkout with Docker
should still use `pnpm db:types:generate`.

### Migration 176

Mirrors the `test_questions.ai_reference_cache_*` shape from migration 044.

```sql
-- Cache generated score anchors per assignment so auto-grade reuses one
-- generation across every submission.

alter table public.assignments
  add column if not exists ai_anchor_cache_key text,
  add column if not exists ai_anchors jsonb,
  add column if not exists ai_anchor_model text,
  add column if not exists ai_anchor_generated_at timestamptz;

alter table public.assignments
  drop constraint if exists assignments_ai_anchors_check;

alter table public.assignments
  add constraint assignments_ai_anchors_check
  check (
    ai_anchors is null
    or (
      jsonb_typeof(ai_anchors) = 'object'
      and ai_anchors->>'schemaVersion' = 'assignment-grading-anchors-v1'
      and jsonb_typeof(ai_anchors->'criteria') = 'array'
      and jsonb_array_length(ai_anchors->'criteria') between 1 and 20
      and pg_column_size(ai_anchors) <= 16384
    )
  );

alter table public.assignments
  drop constraint if exists assignments_ai_anchor_cache_complete_check;

-- All four columns move together; a half-written cache entry is not reusable.
alter table public.assignments
  add constraint assignments_ai_anchor_cache_complete_check
  check (
    (
      ai_anchor_cache_key is null
      and ai_anchors is null
      and ai_anchor_model is null
      and ai_anchor_generated_at is null
    )
    or (
      ai_anchor_cache_key is not null
      and ai_anchors is not null
      and ai_anchor_model is not null
      and ai_anchor_generated_at is not null
    )
  );
```

No RLS change: `assignments` is already teacher-scoped and students never select
these columns. Add the four names to the explicit teacher select lists only.

### Cache key

Same construction as `buildTestOpenResponseReferenceCacheKey`: SHA-256 over
`{title, instructions, rubric_version, anchor_profile_version, model}`. Editing
the instructions or changing the model invalidates the cache, which is the
behaviour we want — stale anchors describing different instructions are worse
than none.

### Coordinator

`gradeAssignmentDocWithAi` currently grades one document with no assignment-level
preamble. Resolve anchors once per tick in `tickAssignmentAiGradingRun`, before
the chunk loop, and thread the result into each item:

1. Read the cached anchors; reuse when the key and model both match.
2. On a miss, generate once and write the four columns.
3. On generation failure, log and grade unanchored. Anchors must never fail a
   run — the unanchored path stays the fallback.

### Read-only teacher surface

- `GET /api/teacher/assignments/[id]/anchors` returns `ai_anchors`,
  `ai_anchor_generated_at`, `ai_anchor_model`, and a `thin_instructions` flag.
- A collapsed panel on the assignment grading view renders the bands per
  criterion, the model notes, and the thin-instructions warning.
- No editing, no regenerate button in this stage. The panel exists so a teacher
  can judge whether the standard being applied is defensible.

## Stage 3 — teacher editing

Deliberately deferred. Once teachers edit anchors, the edited copy becomes the
authority and the trust hierarchy matches test grading's `teacher_key` over
`generated_reference`. That needs an `ai_anchor_source` column
(`generated` | `teacher_edited`), edit-conflict handling against concurrent
grading runs, and a decision about whether editing anchors invalidates grades
already produced under the old ones. None of it is worth designing until stage 1
proves anchors change the scores.

## Verification map

| Surface | Verification |
|---|---|
| Anchor profile | `tests/lib/grading/assignment-anchors-profile.test.ts` |
| Adapter, flag, profile dispatch | `tests/unit/ai-grading-anchors.test.ts` |
| Grading quality | `pnpm eval:assignment-anchors` on de-identified samples |
| Stage 2 schema | migration replay, `pnpm db:types:check`, `Database Contract` CI job |

## Related

- [Grading architecture](../guidance/grading-architecture.md)
- [AI grading egress](../guidance/ai-grading-egress.md)
- [Schema rollout checklist](../guidance/schema-rollout-checklist.md)
