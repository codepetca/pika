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

## Empty-placeholder correction (2026-10-16)

The owner requested a fix after the bounded rehearsal isolated the empty-state
placeholder check. A real-editor CPU reproduction with installed Tiptap 3.31.4
shows that `includeChildren: true` leaves `is-empty` but temporarily omits
`is-editor-empty` after deleting all content. The incremental plugin reads the
old editor-wide state while applying the new document. Waiting does not repair
this stale marker; adding a selection transaction merely hides the defect.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Placeholder after clearing the editor | Shared `simple-editor.scss` placeholder rule | extend | Also match the correctly updated `is-empty` marker on the sole direct paragraph; do not depend only on the stale editor-wide marker. |
| Empty/editing reference | Pattern Lab Student image upload shared editor | reuse | Real production editor with deterministic content; both authenticated roles exercise the same owner. |
| Capture acceptance | Existing visible-placeholder and viewport checks | reuse | The fix must render the placeholder, not relax the test or add artificial user actions. |

Keep the existing rule and all its visual declarations. Add only a selector for
`.tiptap > p.is-empty:only-child`; it must not match an empty first paragraph
when another content block exists, a nested empty paragraph in a nonempty
document, or a paragraph containing text. No dependencies, content mutations,
keyboard/focus changes, new controls, tokens, or permission changes. Composite
interaction/ARIA review is not applicable because those contracts do not change.
Stable guidance remains unchanged; no experimental pattern or promotion needed.

The existing teacher/student, desktop/mobile, light/dark, preview/read-only/
editing/empty matrix remains required. Add real-editor CPU regression coverage
for deletion and the nonempty boundaries before the selector repair. Until visual
verification passes, keep the production stylesheet uncommitted and bind the
combined font-removal plus placeholder-selector candidate through the explicit
before/after-hashed isolated overlay. Original frozen application and all
production/shared-local/provider/rollout holds remain unchanged.

### Empty-state interaction follow-up

The fresh 2026-10-16 isolated run at `49f77ce0` completed teacher login and
cleanup, but empty readiness also reported nonempty text. It remains failed;
three preceding screenshots do not verify the empty state or the full matrix.
Independent source/dependency preservation and exact resource absence passed.

A separate real-editor CPU reproduction demonstrates that Playwright 1.58's
`fill('')` DOM-range selection can leave ProseMirror's model selection at the old
cursor until `selectionchange`. A Delete key before that event is prevented at
the paragraph end without deleting text. This is a proven possible ordering,
not a retained browser trace proving that exact ordering in the failed run.
The normal Select All keymap updates the model synchronously; Backspace then
deletes the selection. Use that single user-like keyboard sequence in the
rehearsal. Do not add post-deletion selection transactions, retries, content
injection, longer timeouts, or exceptions to the existing empty/visible checks.
CPU regressions cover both orderings and the fixed matrix action sequence.
This runner correction does not itself establish browser or visual acceptance.

### Matrix state reset (2026-10-16)

The approved fresh run at `d2c3b7a6` collected 20 hash-verified font captures:
all 16 teacher-actor cases and the four student desktop/light cases. Both real
logins, all five captured empty states, cleanup and independent preservation
passed. The run then timed out before the next screenshot; it remains failed.
No network/body/request violation or page error was recorded. The exact timeout
line was not retained, so do not present the source diagnosis as a browser trace.

Student reference URLs differ only by fragment. That navigation preserves the
closed preview from the previous case and does not rerun the mounted theme
initializer. The next case waits for a preview button that does not reopen.
A stateful matrix regression reproduces this failure. Reset each case with the
existing runtime-owned reload after navigating to the history reference. This
uses the existing request-drain, ownership, origin and deadline checks; it adds
no direct browser bypass, retries, limits or capture exceptions.

All 20 captures were visually inspected. Text is readable in the captured areas;
mobile focused previews intentionally show the changed block in an inner scroller
and do not prove visibility of the document heading or the start of Section 1.
Editing/empty references are still shared student-editor surfaces authenticated
as each actor. The remaining 12 font captures and all 16 workflow captures are
unverified. Do not accept the full matrix or commit the product stylesheet yet.

## Failure and scope

The failed isolated run completed both original login body reads and authenticated
identities, then rejected an origin before creating a new Test. Its old receipt
does not identify that request. Source tracing finds an unconditional Google
Fonts stylesheet import reachable from the first classroom page. This is a
concrete forbidden-network dependency, not proof of the exact historical request.

The initial repair removed only that remote import. Keep the existing font-family declaration and all
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
rehearsal, the fixed overlay helper applies only the font transformation and the
explicit empty-placeholder selector correction described above
to the disposable app copy, requiring the exact before and after SHA-256. The
manifest digest is explicit in the plan, execution seal, binding and receipts.
The runner and original frozen source retain their clean committed-tree checks.

The frozen application `21e755d36037214b32dc6ddd5af68f4247587ca8` remains unchanged.
The newly authorized rehearsal binds this base plus the explicit combined overlay;
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
UI components, visual declarations, auth changes or production settings are introduced.
