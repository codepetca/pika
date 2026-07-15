# Legacy Quiz Contract Cleanup

Use this guide when auditing or changing remaining internal `quiz` / `quizzes`
names after the product surface moved to **Tests**.

The current product contract is:

- User-facing navigation, labels, and active routes should say **Tests**.
- Legacy quiz routes/tabs are removed from the product surface.
- Some database tables, payload aliases, TypeScript aliases, package fields, and
  tests intentionally still use `quiz` names while compatibility is maintained.
- AI agents may create migration files after approval, but humans apply
  migrations manually.

## Current Inventory

### Database, Migrations, RPC, And Storage

Retain until an approved schema migration exists:

- Legacy quiz tables and columns referenced by archive contracts, legacy-only
  helpers, and tests:
  `quizzes`, `quiz_questions`, `quiz_responses`, `quiz_student_scores`,
  `quiz_id`, and quiz update functions/policies.
- Historical migrations that created or hardened quiz tables, indexes, and RLS.
- `assessment_drafts.assessment_type = 'quiz' | 'test'`, because historical or
  imported drafts may still carry `quiz`.
- Gradebook database columns and response tombstones, including
  `quizzes_weight`, `quizzes_percent`, and empty `quizzes` arrays. These remain
  compatibility data only; active gradebook calculations and persistence must
  not read legacy quiz tables.

Do not rename these in app code as a cosmetic cleanup. They require a planned
migration, deterministic backfill, compatibility reads, rollback notes, and
explicit approval.

### API Routes And Payload Contracts

Retain during the compatibility window:

- Active Tests APIs emit both current and legacy response keys through
  `src/lib/test-api-contract.ts`: `{ tests, quizzes }` for lists and
  `{ test, quiz }` for details.
- Student and teacher Tests UI reads current keys first and falls back to
  legacy keys.
- Tests that assert `data.tests === data.quizzes` or `data.test === data.quiz`
  protect this compatibility contract.
- Server access helpers may return both `assessment` and legacy `quiz` aliases.

Next compatibility decision: choose the deprecation point for legacy response
keys, then remove fallback readers in the same or next release after clients
have moved to `test` / `tests`.

### TypeScript Domain Types

Retain while persisted and API compatibility names remain:

- `TestAssessmentType = 'quiz' | 'test'`.
- `Quiz*` aliases in `src/types/index.ts`.
- Gradebook union members and payload fields that still include `quiz`.

Safe cleanup is limited to comments, fixtures, and local variable names that are
not documenting or exercising a legacy contract.

### Server And Library Code

Retain for compatibility or schema-backed behavior:

- `src/lib/assessments.ts` legacy quiz exports and default handling for missing
  assessment type.
- `src/lib/server/assessment-drafts.ts` quiz draft helpers and
  `quiz_questions` sync for legacy rows.
- `src/lib/server/assessments.ts` access aliases.
- `src/lib/quiz-markdown.ts` and `tests/lib/quiz-markdown.test.ts`, which cover
  legacy quiz markdown import/export aliases.
- Gradebook response tombstones for older clients. The active gradebook server
  must never read quiz tables or include quiz rows in calculations.

The active Tests, gradebook, and student-notification workflows do not query
legacy quiz tables. Legacy-only server helpers and type aliases may be removed
in isolated passes once an import audit proves they have no runtime callers.

### UI Compatibility Wrappers

Retain until their callers are removed:

- Component props such as `quiz`, `quizId`, `quizTitle`, and `onQuizUpdate`
  when paired with explicit compatibility tests.
- `student-quiz-action-footer` test ids while component tests still use the old
  identifier.
- Legacy `tab=quizzes` route fallback tests, which prove old URLs fall back to
  the supported tab instead of exposing a removed product surface.

Safe cleanup: rename current-path fixtures and test descriptions from quiz to
test when they are not exercising a compatibility fallback.

### Tests

Remaining quiz references usually fall into one of these groups:

- Compatibility regressions for legacy response keys, props, route params, or
  helper aliases.
- Database-shaped mocks that must still use `quiz_id` or legacy table names.
- Gradebook tests that prove legacy quiz response fields remain inert and the
  active server never queries quiz tables.
- Course blueprint/package tests that cover persisted `quizzes` package fields.
- UI absence tests that assert "Quizzes" is not visible.

Before renaming any test fixture, confirm whether the fixture is a current Tests
path or a deliberate legacy fallback.

### Docs

Docs may keep legacy quiz references when they are:

- Historical architecture context.
- Explicit legacy drift warnings.
- Course package compatibility notes.
- Experimental UI notes that mention old surfaces.

Docs should not introduce new user-facing "Quizzes" guidance.

## Safe Now

Safe without schema or API migration:

- Rename arbitrary fixture text from "quiz" to "test" when no contract depends
  on the string.
- Rename local variables and comments that describe the active Tests path, as
  long as compatibility assertions stay explicit.
- Move compatibility helpers behind clearer `test`-named wrappers while keeping
  old exports as aliases.
- Add or update tests that make legacy fallback behavior explicit.
- Update docs to classify a remaining quiz reference as intentional legacy
  compatibility.

## Requires Migration Or Backward Compatibility

Requires a follow-up design and approval:

- Renaming database tables, columns, functions, indexes, policies, or migration
  history from quiz to test.
- Removing `quiz` / `quizzes` API response keys.
- Removing TypeScript `Quiz*` aliases used by callers or tests.
- Changing gradebook quiz category fields, weights, override routes, or report
  payloads.
- Changing course blueprint/package `quizzes` fields or exported package shape.
- Removing legacy route and prop fallbacks before older URLs/clients are out of
  the compatibility window.

## Recommended Phased Plan

1. **Inventory and guardrails**
   - Keep this guide current.
   - Add targeted tests before each compatibility removal.
   - Risk profile: `none` for docs/fixture-only cleanup; `workspace-state` only
     if UI stateful shells are changed.

2. **Low-risk naming cleanup**
   - Continue replacing non-contract test fixture wording and local variable
     names.
   - Preserve explicit fallback tests for `quiz` / `quizzes`.
   - Prefer narrow slices: active callers first, compatibility helpers next,
     fixtures/docs last.
   - For each slice, record the exit criterion up front, for example:
     "all active Tests readers prefer `test/tests` first" or
     "remaining `quiz` hits are compatibility tests only".
   - Validate with focused tests for touched areas, then `pnpm lint` and
     `pnpm test`.

3. **Payload deprecation**
   - Pick a release where active Tests APIs stop emitting legacy `quiz` keys.
   - First add telemetry or targeted tests that prove all in-repo readers use
     `test` / `tests`.
   - Remove `withLegacyQuizKey`, `withLegacyQuizListKey`, and fallback reads in
     one coordinated PR.
   - Rollback: restore the helpers and response aliases without data changes.

4. **Type and wrapper retirement**
   - Remove `Quiz*` type aliases and legacy component prop aliases only after
     payload deprecation lands.
   - Rename remaining test ids if no external automation depends on them.
   - Rollback: restore aliases; no data rollback required.

5. **Gradebook and course package decision**
   - Decision: legacy quiz gradebook rows are archival compatibility data, not
     an active category. Keep database columns and null/empty response
     tombstones until production verification permits their removal.
   - Decision: version 3 course packages keep the `quizzes` site-config key for
     backward compatibility, always normalized to `false`. Remove it only in a
     future package version with an old-package reader.
   - Executable architecture tests must prevent quiz-table reads from returning
     to the gradebook workflow and package tests must keep the legacy flag off.

6. **Schema migration**
   - Only after explicit approval, create migrations for table/column/function
     renames or archival handling.
   - Follow `docs/guidance/schema-rollout-checklist.md`.
   - Include deterministic backfill, compatibility views or aliases if needed,
     regression tests for pre/post shapes, and rollback notes.
   - Do not apply migrations as an AI agent.

### Archive v1 gate

The four legacy quiz tables cannot be dropped while classroom archive format
v1 lists them as resources. Export and restore dynamically replay that resource
contract, including `quiz_student_scores`; dropping a table or silently
discarding those rows would break existing archives and can lose historical
grades.

Before any schema retirement:

- Add a versioned archive adapter that preserves or maps all four quiz
  resources for existing archives.
- Prove a restore round trip with non-empty quiz, question, response, and manual
  override rows.
- Verify production row counts for all four tables, legacy quiz drafts and
  blueprint assessments, plus non-empty quiz resource counts in stored archive
  manifests.
- Keep the existing archive-v1 reader after introducing any newer format.

## Validation Checklist

For each implementation pass:

- Run `rg "\b[qQ]uiz(?:zes)?\b|\bquiz(?:zes)?\b|quiz_"` and classify new or
  changed hits.
- For payload changes, answer the schema checklist questions:
  "What widened?", "What fallback exists?", "What breaks if the migration has
  not been applied yet?", and "Which regression proves the intended payload
  shape?"
- For active contract renames, also answer:
  "Which readers prefer the new contract first?" and
  "Which legacy aliases are intentionally still alive after this pass?"
- Run focused tests for the touched area.
- Run `pnpm lint`.
- Run `pnpm test`.
- If UI text or layout changes, run the required Playwright visual verification.

## Next Implementation Pass

The gradebook/course-package decision is complete. The next safe pass should
continue fixture-only cleanup in tests that still use arbitrary "Quiz" titles
while not exercising a legacy fallback. Start with:

- `tests/lib/quiz-markdown.test.ts` only if the test is rewritten to clearly say
  it covers legacy quiz markdown compatibility.
- Gradebook tests may remove dead quiz-table mocks, but must retain assertions
  for null/empty compatibility response fields.
- Course blueprint tests must retain the version 3 `quizzes: false` package
  contract.

Payload and schema removal remain blocked until the deprecation window and
production verification prove the compatibility aliases are no longer needed.
