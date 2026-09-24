# PNG/JPEG test references

Date: 2026-09-24
Status: implementation complete; local Storage smoke awaits migration permission; independent PR review follows.
Owner: current coordinator task; branch `codex/test-reference-images`, baseline `37af5a17`.
User decision: PNG/JPEG only; SVG deferred. Implementation and normal PR workflow authorized. Local migration permission requested separately; production changes and merge require their own authority.
Risk profiles: `exam-mode`, `workspace-state`.
Model recommendation: GPT-5.6 Terra high for bounded implementation and browser coverage; coordinator integrates and verifies.

## Intended outcome

Teachers attach PNG or JPG/JPEG through Reference Documents → Upload. Students open them beside questions, with fit, zoom and scrolling; teacher preview uses the same renderer. Karel start/end worlds may be separate named references or one combined picture. These remain test-wide references. Question-level attachments, image comparison layouts, SVG and multimodal grading are out of scope. Essential world state must remain in the prompt and answer key for grading.

## Implementation

- Extend the existing MIME rules and picker; preserve the 25MB file limit and 20-document limit.
- Place uploaded images in a server-created `/images/` path segment with `.png` or `.jpeg` suffix based on accepted MIME. The display helper requires both namespace and suffix as a presentation hint; existing server authorization and managed-object bindings remain authoritative.
- Before upload finalization, read at most 64KiB with a 5s timeout and validate format headers and declared dimensions (10,000px maximum side, 40MP total). This is structural validation, not a full decoder: later corruption produces a viewer error. Failed image finalization or cancellation retains the reservation for existing expiry cleanup, avoiding races with successful verification. Reservations expire after one hour; cleanup is manually operated, so deletion is not promised within that hour. Verified finalization retries return without rereading Storage.
- Reuse private uploads, exact test references and teacher/student file endpoints. No new attachment table, public bucket, persisted presentation metadata or dependency.
- Migration 208 `allow_test_document_png_jpeg` extends the bucket MIME allowlist while retaining other entries, privacy and size. Local history 001–207 matches; dry-run lists only 208. Application pending exact user permission.
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
- Final focused gate: 903 tests across 70 files passed, plus architecture, UI/design policy, TypeScript and lint (`pnpm check:focused -- --base origin/main`; log `/tmp/pika-image-remediation-gate.log`). Pika pre-commit audit passed.
- Browser matrix: teacher/student × desktop/mobile × light/dark, 8 cases; screenshots inspected by coordinator. Mocked API/storage covers upload metadata, save/reload, fit/zoom, retry, retained answers and no spurious focus requests. Tests assert decoded image content before capture. Local Storage smoke remains pending.
- Capture provenance: 2026-09-24, local dev server port 3014, baseline `37af5a17` plus this branch's implementation and remediation diff; synthetic Karel raster only. Routes `/e2e-fixtures/student-test-list` and `/e2e-fixtures/test-reference-images`. Artifacts under `test-results/experience-matrix-keeps-a--683b2-oming-a-PNG-reference-image-*/student-test-image-*.png` and `test-results/experience-matrix-uploads--4beaa--and-retries-a-failed-image-*/teacher-test-image-*.png`.
- UI fixes verified from real browser evidence: cached-image load before hydration and mobile document pane collapse. New image viewer adds no animations; existing workspace transitions retain reduced-motion overrides.
- Initial independent Sol/Terra review found ambiguous filename-based rendering and a duplicate-finalization/cancellation cleanup race. One correction batch adds a server-owned image path namespace and preserves expiring reservations after image failures. Targeted regressions failed before correction; follow-up verification and review are recorded on the PR.
- Migration 208 local dry run: only 208 pending; no application performed.

## Evidence

[Supabase bucket restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets).
