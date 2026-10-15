# Contextual Test editor font dependency repair

## UI change brief

- Surface: shared Tiptap rich-text viewer/editor stylesheet, loaded by classroom
  pages. The isolated rehearsal forbids external network requests.
- Reference: existing `RichTextViewer` / `RichTextEditor` fallback behavior and
  `/pattern-lab?role=teacher#history-preview` (also `role=student`), which renders
  those production owners. `DESIGN.md` permits content-owned Tiptap typography.
- Primary signal: existing readable content; this is not a new visual pattern.
- Roles: teacher and student. Viewports: desktop and mobile. Themes: light and
  dark. States: read-only content, editable content, history preview, empty editor.
- Must not add: controls, icons, layout changes, new font assets/dependencies,
  external-network exceptions or rehearsal-only style substitutions.
- Composite-widget review: no new widget behavior; existing focus/keyboard and
  editor semantics must remain intact.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Offline content typography | Existing `"DM Sans", sans-serif` declaration | reuse | Preserve the already supported locally available font/fallback without downloading remote CSS or fonts. |
| Editor and viewer rendering | Existing production Tiptap owners | reuse | Both consumers share the stylesheet; no new component or duplicate styles are needed. |
| Visual comparison | Pattern Lab history-preview production owners | reuse | Deterministic teacher/student examples cover the existing content surface. |

## Failure and scope

The failed isolated run completed both original login body reads and authenticated
identities, then rejected an origin before creating a new Test. Its old receipt
does not identify that request. Source tracing finds an unconditional Google
Fonts stylesheet import reachable from the first classroom page. This is a
concrete forbidden-network dependency, not proof of the exact historical request.

Remove only that remote import. Keep the existing font-family declaration and all
network rejection predicates. Add fixed-label rejection diagnostics so another
unexpected origin can be identified without retaining URLs, queries, credentials,
bodies, hashes or arbitrary error text.

## Verification and release gates

CPU checks cover the source dependency, rejected external font/foreign/credentialed
requests, unchanged counters, no dispatch, context closure and diagnostic privacy.
The combined focused gate passed 3,446 tests (8 skipped), architecture, UI/design
policy, TypeScript and lint. Two independent source reviews found no actionable
security/correctness or integration/compatibility issue in the repair snapshot.
Visual verification is **pending**, not waived: compare the named production
owners for both roles, both viewports and both themes, including the states above.
The production stylesheet change must remain uncommitted until that evidence is
collected. Its exact candidate bytes are preserved privately. For the approved
rehearsal, the fixed overlay helper applies only that one known transformation
to the disposable app copy, requiring the exact before and after SHA-256. The
manifest digest is explicit in the plan, execution seal, binding and receipts.
The runner and original frozen source retain their clean committed-tree checks.

The frozen application `21e755d36037214b32dc6ddd5af68f4247587ca8` remains unchanged.
The newly authorized rehearsal binds this base plus the explicit font overlay;
it must not substitute the current runner branch for that frozen app or import
unrelated/held application work.
Do not edit historical failed attempts or treat recovery as a passing rehearsal.
Production, shared-local migration, rollout and provider holds remain unchanged.

## Approved visual evidence scope

Keep all 16 original workflow screenshots. Add 32 fixed font-state screenshots:
teacher/student authenticated actors, desktop/mobile, light/dark, and preview,
read-only, editing and empty states. All PNGs share a 64 MiB aggregate ceiling,
with the existing 4 MiB per-image bound. The original 45-minute work deadline,
request limits, mutation limits, single attempt and cleanup reserve remain.

Use only the named editor reference sections of authenticated Pattern Lab, with
the isolated development gallery enabled and fixture-auth bypass still disabled.
Both actors use the existing shared student-editor reference for editing/empty
states; record this as reference provenance, not as a teacher product screen.
Do not interact with unrelated gallery sections or held feature probes. No new
UI components, styling, auth changes or production settings are introduced.
