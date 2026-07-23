# Legacy Quiz Contract Cleanup

Use this guide when auditing or changing remaining internal `quiz` / `quizzes`
names after the product surface moved to **Tests**.

The current product contract is:

- User-facing navigation, labels, and active routes should say **Tests**.
- Legacy quiz routes/tabs are removed from the product surface.
- Some database tables, persisted discriminants, package fields, component
  wrappers, and tests intentionally still use `quiz` names while compatibility
  is maintained.
- AI agents may create migration files after approval. Application follows the
  one-time authorization contract in the schema rollout checklist.

## Current Inventory

### Database, Migrations, RPC, And Storage

Retain until an approved schema migration exists:

- Legacy quiz tables and columns referenced by archive contracts and tests:
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

The legacy response-key compatibility window is closed:

- Active `/api/student/tests/**` and `/api/teacher/tests/**` routes emit only
  `{ tests }` for lists and `{ test }` for details.
- In-repo Tests consumers read only current keys. Tests reject the retired
  `quiz` / `quizzes` aliases on representative list and detail routes.
- `src/lib/test-api-contract.ts` remains a current-contract normalizer for
  optional or error payloads; it no longer accepts legacy response keys.

Deprecation decision: the first release containing this contract retirement is
the cutoff. Pika has no active quiz routes or in-repo quiz-key consumers, and
the active endpoints are product-internal rather than a separately versioned
public API. An older independently deployed client that still reads only
`quiz` / `quizzes` will stop receiving assessment data and must upgrade with
the server. Rollback is code-only: restore the response helpers and fallback
readers; no stored data changes are involved.

### TypeScript Domain Types

Retain while persisted and API compatibility names remain:

- `TestAssessmentType = 'quiz' | 'test'`.
- Gradebook union members and payload fields that still include `quiz`.

The unused exported `Quiz*` aliases have been retired. Persisted discriminants
and payload fields use explicit current types rather than recreating those
aliases.

### Server And Library Code

Retain for compatibility or schema-backed behavior:

- `src/lib/assessments.ts` default handling for persisted legacy assessment
  types.
- `src/lib/server/assessment-drafts.ts` assessment-named draft helpers and their
  `quiz_questions` sync behavior for legacy rows. The unused quiz-named wrapper
  exports have been retired.
- Gradebook response tombstones for older clients. The active gradebook server
  must never read quiz tables or include quiz rows in calculations.

The active Tests, gradebook, and student-notification workflows do not query
legacy quiz tables. The unused quiz server access module, re-export shims,
quiz-named helper/type aliases, API response aliases, and the standalone quiz
markdown module have been removed. Architecture and route regressions protect
those boundaries.

### UI Compatibility Wrappers

Component and automation aliases are retired:

- Test components and `useDraftMode` require current `test`, `testId`,
  `assessmentId`, `assessmentTitle`, and `onTestUpdate` props.
- Student and teacher Test components no longer accept an assessment-mode
  switch or render alternate quiz submission, results, authoring, preview, or
  grading branches.
- The orphaned quiz-only multiple-choice editor and individual-response panel
  have been removed; current grading uses the dedicated Test grading surface.
- The student test action footer uses the current
  `student-test-action-footer` automation id.
- Exam-mode E2E setup reads only the current Tests API response keys.

Retain the legacy `tab=quizzes&quizId=...` route fallback tests. They prove old
URLs fall back to the supported tab instead of exposing a removed product
surface. This URL tombstone is separate from component and API contracts.

### Tests

Remaining quiz references usually fall into one of these groups:

- Compatibility regressions for legacy route params or persisted data.
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
- Remove dead aliases after an import audit proves they have no application
  callers.
- Add or update tests that make legacy fallback behavior explicit.
- Update docs to classify a remaining quiz reference as intentional legacy
  compatibility.

## Requires Migration Or Backward Compatibility

Requires a follow-up design and approval:

- Renaming database tables, columns, functions, indexes, policies, or migration
  history from quiz to test.
- Removing a TypeScript compatibility alias that still has application callers.
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
   - Completed: active Tests APIs emit only `test` / `tests`.
   - Completed: removed `withLegacyQuizKey`, `withLegacyQuizListKey`, and
     quiz-key fallback readers in one coordinated pass.
   - Route tests prove representative current payloads omit legacy aliases.
   - Rollback remains code-only; no data rollback is required.

4. **Type and wrapper retirement**
   - Completed: removed unused `Quiz*` types, quiz-named assessment helper
     aliases, and dead server/re-export modules after proving they had no
     application callers.
   - Completed: removed quiz-named component prop aliases after proving they had
     no production callers.
   - Completed: renamed the internal student action-footer test id and updated
     repository automation.
   - Retain the old `tab=quizzes&quizId=...` URL tombstone independently.
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
   - Apply only under the one-time target-and-migration authorization contract.

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

The API response-key window, gradebook/course-package decisions, dead draft
aliases, UI compatibility wrappers, standalone quiz markdown, and unreachable
quiz-mode rendering are complete. Active application surfaces now use only the
Tests contract.

The next pass is migration design and production evidence, not another cosmetic
rename:

- completed: added a target-pinned read-only inventory for the four legacy Quiz
  tables, Quiz drafts, blueprint assessments, and verified archive manifests;
- completed: recorded production counts and designed the versioned archive,
  deterministic envelope backfill, compatibility, validation, and rollback
  sequence in
  [`legacy-quiz-schema-retirement-plan.md`](./legacy-quiz-schema-retirement-plan.md);
- next: implement the additive retired-resource envelope and archive-v2/v1
  adapter pass, but only after explicit approval to create its named migration;
- retain `tab=quizzes` as a URL tombstone and keep database-shaped `quiz_id`
  fields until an explicitly approved migration replaces them.

Schema removal remains blocked on archive-format support and production
verification. Gradebook tombstones and course package compatibility fields
remain until their separately documented versioned migrations.
