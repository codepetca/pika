# Final student removal

User-approved change: removal has no recovery guarantee. Block re-adding a removed
student to the same class until their old class data has been purged. This pass
does not implement or schedule that purge, erase records, or change Pal erasure.

Surface/reference: teacher Roster removal confirmation and Add Students / CSV
inline errors; reuse the production ConfirmDialog demonstrated by Pattern Lab
Settings and Daily. Student join remains denied by the existing membership guard.
Primary signal: explicit consequence text, not decoration or a new action.
Teacher and student: desktop 1440x900, mobile 390x844, light/dark. Verify single
and batch confirmation, pending/failure/success, blocked re-add, and student
access/error boundaries. No new pattern, shared API, or layout change.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Finality warning | Roster ConfirmDialog | reuse | Existing accessible confirmation owner |
| Re-add rejection | Add/CSV inline errors | reuse | Keep the form open with a clear reason |
| Student denial | Join page error state | reuse | Existing access boundary and failure presentation |

Composite checklist reviewed: keep dialog role, focus trap, Escape/Cancel, focus
return and disabled-in-flight behavior; verify keyboard and semantic state with
tests and screenshots. No experimental guidance or promotion required. Nearby
add/CSV parsing duplication is deferred; this pass shares only the removal guard.

Implementation: stop calling the restoring RPC, preflight add/import without
mutating retained rows, and map database race rejection to the same inline error.
Forward migration 165 retires restoration and enforces the retained-identity
boundary for roster writes and enrollment. Migration 164 stays immutable. Apply
165 before deploying this change; exact target/migration permission is separate.
Risk profile: none (no workspace, grading, exam, or runtime-platform change).
Model recommendation: GPT-6 Astra - cross-layer membership and retention boundary.

Verification (2026-09-11): focused gate214tests/19files plus architecture, UI/design,
TypeScript and lint pass; affected suites80tests pass. Existing browser matrix14/14
plus blocked re-add4/4 pass on local3041. Teacher/student desktop/mobile light/dark
captures were visually inspected; dialogs and inline error fit without overflow.
Pattern Lab Settings confirmation was inspected as the shared dialog reference.
Artifacts: `test-results/student-purge-visual-*`, `output/playwright/readd/`, and
`output/playwright/final-removal-pattern-reference.png`. These were captured from
the uncommitted implementation based on main `e289fd18`; product source remains
unchanged when committed. Existing legacy Add Students modal geometry is retained,
not promoted as a new shared dialog pattern. Composite checklist reviewed; removal
focus/Cancel and disabled states remain covered by existing component tests;
re-add error and Cancel are covered by the browser matrix. No manual UI follow-up.
Migration165 was subsequently applied once, with explicit approval, to disposable
local `pika_removal_165_final`; removal, archive replay in both UUID orders, and
grade-write race fixtures pass. Direct generation from that schema matches the
committed database types. Shared-local `db:types:check` intentionally refuses the
unapplied165 history; exact-head CI must independently replay the full lineage.

Independent review found one archive compatibility edge: old interrupted re-adds
can leave an active invitation beside the retained identity. The forward guard
now permits INSERT-only archive replay of that existing state; removed-row edits
and enrollment remain denied. The database fixture covers both placeholder/tombstone
UUID orders and exact preservation without granting readmission. These checks now
pass in the disposable database. No shared-local or hosted migration was applied.
