# PNG/JPEG test references

Date: 2026-09-24
Status: PR #1355 implementation and local verification complete. Final cumulative review found an archive-restore interaction; third correction is verified locally and awaits targeted closure review, then ready CI.
Owner: current coordinator task; branch `codex/test-reference-images`, baseline `37af5a17`.
User decision: PNG/JPEG only; SVG deferred. Implementation and normal PR workflow authorized. User approved exact migration208 on local Supabase and review continuation; production changes and merge require their own authority.
Risk profiles: `exam-mode`, `workspace-state`.
Model recommendation: GPT-5.6 Terra high for bounded implementation and browser coverage; coordinator integrates and verifies.

## Intended outcome

Teachers attach PNG or JPG/JPEG through Reference Documents → Upload. Students open them beside questions, with fit, zoom and scrolling; teacher preview uses the same renderer. Karel start/end worlds may be separate named references or one combined picture. These remain test-wide references. Question-level attachments, image comparison layouts, SVG and multimodal grading are out of scope. Essential world state must remain in the prompt and answer key for grading.

## Implementation

- Extend the existing MIME rules and picker; preserve the 25MB file limit and 20-document limit.
- Place uploaded images in a server-created `/images/` path segment with `.png` or `.jpeg` suffix based on accepted MIME. The display helper requires both namespace and suffix as a presentation hint; existing server authorization and managed-object bindings remain authoritative.
- Before upload finalization, read at most 64KiB with a 5s timeout and validate format headers and declared dimensions (10,000px maximum side, 40MP total). This is structural validation, not a full decoder: later corruption produces a viewer error. Failed image finalization or cancellation retains the reservation for existing expiry cleanup, avoiding races with successful verification. Reservations expire after one hour; cleanup is manually operated, so deletion is not promised within that hour. Verified finalization retries return without rereading Storage.
- Preserve the image namespace during classroom archive restore from verified manifest MIME, keeping non-test-image restore paths unchanged.
- Preserve the image namespace across managed classroom ↔ course-blueprint copies using resolved source MIME; copied PNG/JPEG references retain the image viewer. Portable exported course-blueprint files remain a separate links/text-only feature.
- Reuse private uploads, exact test references and teacher/student file endpoints. No new attachment table, public bucket, persisted presentation metadata or dependency.
- Migration 208 `allow_test_document_png_jpeg` extends the bucket MIME allowlist while retaining other entries, privacy and size. Approved local migration applied successfully; history001–208 matches, generated types match, bucket stays private with its25MB limit.
- Add the image branch to ExamDocumentWorkspace. Existing links/PDFs/text keep their rendering paths. Images use an ordinary image element through the authenticated file endpoint.
- Fit initially without enlarging beyond native dimensions. Zoom ranges from 1× to 4× of fit in 25% increments. Retry calls the authorized endpoint again for fresh delivery. Controls preserve keyboard interaction and exam activity signals; question forms remain mounted.
- Preserve a white canvas behind transparent diagrams in both themes with a semantic token.

## UI brief and reuse decisions

Surface: Reference Documents dialog and shared student/teacher-preview pane.
Reference: ExamDocumentWorkspace shell plus canonical IconButton, Button and PageState, inspected in live `/pattern-lab?role=student#controls` at 1440×900. Baseline screenshot: `/tmp/pika-image-controls-reference.png`.
Roles: teacher and student. Viewports: 1440×900 and 390×844. Themes: light and dark.
States: upload selection/pending/error; image loading/fit/zoom/error/retry; keyboard focus, Back return and split resizing.
Primary signal: the image; quiet control row, existing pane header and question layout.
No new modal or carousel. Feature-owned Pattern Lab evidence does not promote a new cross-product pattern.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Upload/list | TestDocumentsEditor | extend | Existing title, save and removal controls fit. |
| Access/storage | Managed upload and file routes | reuse | Same teacher ownership/student availability and cleanup. |
| Workspace | ExamDocumentWorkspace | extend | Both preview and test taking already share it. |
| Image renderer | TestImageDocumentViewer | create | Teacher preview and student test taking share one narrow interaction contract. |
| Controls/states | IconButton, Button, PageState | reuse | Shared focus, targets, tooltips and state semantics. |

Composite checklist reviewed: yes. Keep separator keyboard values and Back focus restoration. Image actions are an ordinary labeled button group. Async owner is test/document/file-endpoint identity: image state resets on identity change, without remounting question input. A later response for an old image cannot update the new component.

## Coordination and phase exits

1. Backend worker owns shared upload/helper/migration and tests. Coordinator owns UI, documentation, integration, PR lifecycle. Browser worker owns experience-matrix cases and a gated development fixture. Workers do not commit, migrate or publish.
2. Implementation exit: affected unit/API/component tests and types pass; no new dependencies.
3. Verification exit: teacher/student desktop/mobile light/dark browser screenshots inspected, loading/error/fit/zoom/access/input preservation covered; focused checks pass. Mocked UI evidence is labeled separately from actual Storage validation.
4. Review exit: draft PR, fixed-SHA independent security/migration and architecture/compatibility review, accepted fixes batched, reviewed SHA stable. Mark ready only when required verification is complete.
5. Rollout: apply exact approved local migration for real Storage checks. Hosted migration must precede application upload enablement. No production migration or deployment authorized here.

## Acceptance

- Both PNG and JPG/JPEG upload, persist, reload and render; SVG remains rejected.
- Legible Karel grid details, transparent background, wide/tall images, zoom/reset and useful error/retry states.
- Student answers survive document navigation/resizing; reference interaction does not produce false exam violations.
- Unauthorized/mismatched test references fail closed; signed URL refresh remains behind authorization.
- Existing PDF/text/link behavior, save/publish and managed cleanup preserved. Portable course-blueprint files currently support only links/text; no new portability claim.
- Storage migration tests/read-only checks verify added MIME types and preserved existing settings.

## Verification ledger

- Startup/environment passed with frozen-lockfile dependencies.
- Final implementation including the archive correction focused gate: 1000 tests across 76 files passed, plus architecture, UI/design policy, TypeScript and lint (`pnpm check:focused -- --base origin/main`; log `/tmp/pika-image-restore-gate.log`). Pika pre-commit audit passed.
- Browser matrix: teacher/student × desktop/mobile × light/dark, 8 cases; screenshots inspected by coordinator. Mocked API/storage covers upload metadata, save/reload, fit/zoom, retry, retained answers and no spurious focus requests. Tests assert decoded image content before capture. Real local Storage smoke also passed: PNG/JPEG reservation, upload, finalize and idempotent retry; saved/reloaded references; authenticated teacher and enrolled-student delivery; anonymous denial. Temporary local test removed through normal API. Log `/tmp/pika-image-storage-smoke.log`.
- Capture provenance: 2026-09-24, local dev server port 3014, baseline `37af5a17` plus this branch's implementation and remediation diff; synthetic Karel raster only. Routes `/e2e-fixtures/student-test-list` and `/e2e-fixtures/test-reference-images`. Artifacts under `test-results/experience-matrix-keeps-a--683b2-oming-a-PNG-reference-image-*/student-test-image-*.png` and `test-results/experience-matrix-uploads--4beaa--and-retries-a-failed-image-*/teacher-test-image-*.png`.
- UI fixes verified from real browser evidence: cached-image load before hydration and mobile document pane collapse. New image viewer adds no animations; existing workspace transitions retain reduced-motion overrides.
- Initial independent Sol/Terra review found ambiguous filename-based rendering and a duplicate-finalization/cancellation cleanup race. One correction batch adds a server-owned image path namespace and preserves expiring reservations after image failures. Targeted regressions failed before correction; follow-up verification and review are recorded on the PR.
- Targeted review caught loss of the image namespace during managed blueprint copies. A second batch preserves it from authoritative source MIME and adds PNG/JPEG/PDF round-trip and copied-viewer regressions; six regression failures reproduced before the fix, all 53 affected tests then passed. Its first full check stalled with timeouts; after approved continuation, the unchanged implementation passed all910tests and policies/types/lint. Audit passed.
- Review continuation: user approved resuming after the elapsed-time checkpoint. Targeted launch4 confirmed the managed-copy correction and previous concurrency fixes; final cumulative review follows. Final cumulative launch5 found archive restore discarded the image marker. Third correction preserves it from verified manifest MIME; four regressions failed before,35 affected tests pass after. Producer audit covers all test-upload writers: direct uploads, blueprint copies and archive restore; snapshots are links, archive/Gradex exports use separate buckets. Targeted closure review follows under the approved continuation.
- Migration208 applied once to local Supabase after exact approved dry run. All208 history entries match; generated types match. Bucket MIME additions verified; public=false and file_size_limit=26214400 preserved. No hosted migration, merge or deployment performed.


## Evidence

[Supabase bucket restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets).
