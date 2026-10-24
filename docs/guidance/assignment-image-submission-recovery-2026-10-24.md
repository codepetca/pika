# Assignment image submission recovery — 2026-10-24

Copying a managed image through HTML preserved its UUID but omitted its Storage
bucket/path. An ordinary external HTML image acquired an explicit null managed
UUID from Tiptap defaults. The deployed identity walker rejected both shapes with
`managed_storage_embedded_owner_mismatch`, rolling back draft saves; Submit first
saves the draft, so earlier saved work stayed visible while submission failed.

## Repair and authority

- Extend `ManagedImage` with escaped data attributes for the existing bucket/path
  fields, retaining protected delivery URLs and presentation attributes.
- Normalize image references in both authorized save and submit routes, including
  the contextual paths. Strip only null optional image identity defaults; retain
  external images and all text, marks, presentation and ordering.
- Recover omitted managed identity fields from explicit, scoped registry reads.
  Require the exact document, student, purpose, resource kind, live status and,
  when already available from route authorization, Classroom. Contextual save
  binds document/student and leaves the existing atomic database Classroom check
  in force. Reject unknown, foreign, conflicting or unavailable evidence; never
  silently drop an image or overwrite an explicit conflicting location.
- Complete existing managed references remain subject to the transaction's
  original ownership/status validation. No SQL, schema, flags, grants, auth
  routes, quotas, deadlines, grades or student records are changed by rollout.
- Build patches/history from normalized content. Restrict metadata-aware equality
  to submission acknowledgement so successful recovery does not falsely report
  new edits; actual new text/image/presentation changes still preserve drafts.
- Already-open clients can retry Save/Submit against the repaired server without
  discarding their local document. Older cached JavaScript may preserve an extra
  recovery copy after successful submission; it does not lose work.

## UI acceptance brief

Risk: `workspace-state`; ownership-sensitive server recovery requires independent
security/correctness and compatibility review. No new visual pattern, layout,
controls, styling, focus, keyboard or ARIA contract. Composite-widget review is
n/a because those contracts do not change. Reference: existing student assignment
editor and teacher viewer, plus `/pattern-lab` student-image-upload and
history-preview references. Primary signal remains the existing Saved/Submitted
state and visible student work. Experimental patterns: none; no promotion needed.

| Need | Existing owner | Decision | Reason |
| --- | --- | --- | --- |
| Clipboard identity | ManagedImage | extend | Preserve its existing image contract |
| Safe old-draft recovery | Assignment save/submit routes | extend | Normalize only after authorization |
| Editor/viewer and feedback | StudentAssignmentEditor / RichTextViewer | reuse | Preserve workspace and established states |

Matrix: teacher/student, 1440×900 and 390×844, light/dark, image render/HTML
roundtrip and edit states. Full student assignment flow also covers a damaged
managed image and external null-ID image in the same open document, successful
save/submit, latest text and both images, and no false newer-edit warning.

## Validation evidence

- Initial `pnpm check:focused -- --base origin/main`: 138 files passed, 2 skipped;
  2,463 tests passed, 8 skipped; architecture/UI/design/type/lint passed.
  Four additional legacy-path/ownership unit regressions then passed. The batched
  review corrections passed167 targeted tests. A final unbounded run hit4
  timeouts in unchanged UI tests during concurrent capture; all244 tests in those
  three files passed when rerun with2workers and capture stopped. A final required
  focused run with2workers is in progress; its receipt belongs on the PR.
- Added 24 endpoint regressions across both authorization modes and both writes;
  rejected lookup evidence never invokes an atomic writer. Added real Tiptap
  clipboard regressions, submission comparison regressions and component tests
  preserving actual in-flight edits.
- Local rollback-only proof passes repaired payloads produced by the real helper
  through `save_assignment_doc_atomic` and `submit_assignment_doc_atomic`.
  Original payloads reproduce the production failure; repaired payloads retain
  exact content, owned-image reference and ready status. Synthetic fixtures only,
  rolled back; no migrations applied. Existing local database history 001–292.
- Playwright CLI captures the eight role/viewport/theme combinations and full
  student submitted state using repository fixtures and the real bundled server
  recovery helper against a synthetic scoped registry. Browser API data is
  intercepted; this is not an authenticated production canary. The normal local
  launcher could not find a local API URL while only the shared DB was running;
  fixture server uses loopback-only unusable credentials and makes no live API
  connections. Shared database/services were not stopped or reset.
- Local artifacts: `artifacts/a4-image-recovery/` (ignored). Includes browser
  proof, eight matrix captures, submitted-state capture, bundled helper and
  rollback proof. Screenshot provenance is recorded there against the rendered
  implementation revision. Review screenshots before accepting visual evidence.
- `pika-audit` and `git diff --check` passed. No new dependencies.

## Review and release ledger

Implementation owner: current task, `codex/a4-image-submission-recovery`.
Worker: GPT-6.1 Sol/high, bounded clipboard/API/comparison assignments, delivered
and coordinator-verified. Weekly remaining 75% at implementation start; per-turn
usage and active-time totals unavailable. No cost-savings claim.

Independent review planned: one initial full-diff wave, two high-reasoning
reviewers (security/correctness and compatibility/state preservation), separate
fixed detached checkout; no edits/publication by reviewers. Budget: at most7
launches,4 remediation batches,60minutes elapsed; single reviewer30minutes.
Initial complete reviews at29b4a5449: GPT-6 Astra/high security/correctness and
GPT-6.1 Sol/high compatibility. Both reported one accepted P2 each. Batched
remediation1 retains URL-path evidence and rejects conflicts before writer calls,
and recognizes same-origin absolute IDs plus unambiguous acknowledged legacy
paths during submission comparison. Foreign source hosts, ambiguous aliases and
real edits remain unequal. New regressions failed before fixes and pass after.
Current launches2, remediation1; one targeted review planned against the new fixed
SHA. Initial review began10:17:22Z; limits remain unchanged. PR1675 is draft.
Final review, exact-SHA CI, promotion and live-preservation receipts will be
recorded on the PR and in the task; no pending step is implied complete here.

Production preservation baseline was read privately for the three reported A4
drafts: existing content hashes/statuses and saved references intact; additional
verified uploaded files for two drafts still present. Do not add names, content,
private Storage paths or record identifiers to repository notes. Do not submit
on students' behalf or replace browser drafts from older server copies.
