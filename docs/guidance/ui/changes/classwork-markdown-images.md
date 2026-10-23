# Approved classwork Markdown editors — 2026-10-22

The owner approved the standalone four-editor prototypes and requested their
application to Assignment, Material, Test and Survey. Reference: the reviewed
material-header-prototype/editors gallery, versions 6–9, and Pattern Lab's actual
AssignmentForm, MaterialCreationDialog and controlled assessment owners. This
refines the earlier modal-close and item-context briefs. Risk profile:
workspace-state; protected image storage and its migration require high-risk
security/correctness and compatibility review.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Type and fading classroom header | CreationModalContextHeader | extend | Spacious left header shared by all four editors |
| Title, details and publication | Existing feature form owners | reuse | Preserve labels for assistive technology, placeholders and save semantics |
| Question header | Test/Survey question control rows | create | QuestionAuthoringHeader shares bold Q number, centered navigation, status and icon modes |
| Mode buttons | SegmentedControl, Lucide Pencil/Code | reuse | Named and tooled 44px targets, shared keyboard behavior |
| Close and saving | DialogCloseButton, SaveStatus | reuse | One top-right X and quiet circular progress in the control bar |
| Question actions | TeacherWorkSurfaceIconMenuButton | extend | Green Plus FAB at the lower right in question editing mode |
| Compact formatting and images | RichTextEditor, MarkdownContentEditor | extend | Image beside Link; Markdown-safe inline images round-trip |
| Image insertion | ModalLayer, Tabs, FormField, Input, Button | create | Shared feature dialog for file/URL, preview and accessible description |
| Student reading | LimitedMarkdown, RichTextViewer | extend | Render authoritative Markdown images safely while preserving legacy rich documents |

The left type/classroom header and right controls occupy the same top band.
The editable title appears below the left header, without visible Title or
Unsaved labels. Test/Survey show bold Q1, centered question navigation and
Pencil/Code modes with X; Test also keeps Points in the left part of that bar.
At narrow widths navigation may use a second row without overlap. Image is next
to Link; Format retains the existing safe formatting menu. No new dependency.

Markdown is authoritative. Opening or changing modes does not rewrite or save
content. Assignment and question prompts retain their existing Markdown fields;
Material keeps exact Markdown in content.attrs.authoring_markdown with derived
compatibility nodes. Legacy material remains untouched until a content edit;
conversion warnings identify unsupported content. Student documents keep their
existing full rich editor and upload limits.

Image upload and URL import accept PNG/JPEG/GIF/WebP up to 2 MB. The browser
imports URLs with a bounded fetch, then uses the same protected classroom upload.
The server enforces MIME, byte size and raster headers. Stable authorized image
URLs are stored in Markdown. Migration 291 attaches source references in the
same transaction as content saves, including deferred bulk question replacement
and archive/snapshot pins. Unclaimed removed images have a one-hour private Undo
window; same-class source saves may revive only that narrow retained state.
Claimed, attempted, expired or unrelated cleanup objects cannot be revived.
It must be applied before enabling this image flow.
No migration application or production deployment is implied by this brief.

Portable course Blueprints cannot yet copy these private inline assets. Capture,
export, import, instantiation and proposal writes reject protected image URLs
before copying private assets or applying content, with a clear message. Existing classroom content stays
usable; no global source-reader restriction or asset-authority expansion is added.

Verification matrix: teacher 1440×900 and 390×844, light/dark; all four editors,
empty/long title and classroom, Write/Markdown, navigation, Points, FAB menu,
image upload/URL/preview/oversize/cancel, save/error/retirement, nested Escape and
focus return. Student desktop/mobile light/dark covers image reading through
the actual Markdown owners; student teacher-authoring controls are n/a.
Composite review includes mode/button roving focus, menus and nested dialogs.

Actual-source Playwright verification passed 16 teacher editor/viewport/theme
cases plus four student image-reading cases. Captures include Write, Markdown,
image insertion, protected Markdown syntax, 2 MB rejection and source-preserving
mode changes. Eight existing teacher/student authoring browser cases also pass.
All API calls used deterministic intercepted transport; this establishes UI
behavior, not storage/database execution. Evidence is retained in ignored
output/playwright/approved-editors with provenance. Component/source checks are
recorded in PR 1662: canonical one-worker gate passed 10,162 tests across500
files (8 tests skipped), architecture, UI/design policies, TypeScript and lint.
The explicit Data API migration policy and Pika audit also pass.
Isolated replay001–291 and all four rollback behavior proofs passed, including
image attachment, sequential question move/swap/Undo and ACL/default-deny checks.
Historical and absent-default Data API privilege replay also passed. The first
harness run stopped only at generated-type equality: the exact new291 ledger
metadata is not generated yet. Shared source schema/history stayed unchanged.

Owner approved local291 and three additional review launches. The first local
dryrun found history001–243, so application stopped. On October23 the owner
explicitly approved244–291 locally. Fresh preview and48-file manifest matched;
one supabase db push --local --yes applied exactly244–291. History001–291 and
read-only exact291catalog PASS. Official db:types:generate/check PASS, adding
only the new ledger; output exactly matches isolated replay. Final native replay
/tmp/pika-material-post-date.r5fxEg passes behavior, type equality and unchanged
shared schema. No reset, seed, production migration or rollout flag change.
Both initial Sol/high reviews completed on d5bd64337 (launch10/11, prior9
historical launches; owner-approved maximum12). Two unique P2 archive blockers
were accepted: stale compatibility nodes must not require removed images, and
absolute protected URLs must be remapped to the restored app/identity. One
correction batch fixes both, with canonical Material/Assignment/snapshot source
discovery and relative restored links; archive regressions include missing active
assets and case-normalized UUIDs. Correction canonical gate passed10,168tests/500files (8skipped), architecture,
UI/design policy, TypeScript and lint. The final IPv6 URL variant was added during
that run; a subsequent exact-source archive run passed71tests across5suites.
No editor UI source changed, so prior visual hashes remain applicable.
Official metadata generation and native/schema gates are complete. Final full
selection ran10,169tests:10,168passed, one startup-context budget failure. The
CURRENT note was compacted (16,965/17,000chars), without changing the budget.
All160affected startup/UI-guidance/archive tests then passed across7suites,
including the realistic rich_instructions fixture correction. Remaining
architecture/UI/design/TypeScript/lint checks pass. Production source is identical
to checked00ae6b071; only closing docs/test fixture change afterward.
The reserved fresh Sol/high reviewer (launch12) completed the behavioral scope: both
P2issues resolved, no new blocker. Final exact-head verdict/CI receipt is tracked
in PR1662. Native DB and Docker Desktop are stopped again; no merge authorized. Effective reviewer configurations and per-turn tokens were
not exposed. PR1662 remains draft until native types and review gates pass.

CI follow-up (same approved layout; no new pattern): dark Pattern Lab exposed
legacy prototype Question actions under the shared X and older layout assertions.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Prototype question-menu clearance | CreationModalShell modal-question-controls-tail | reuse | Same reserved X slot as the production question header |
| Header/layout assertions | Approved spacious context + right mode bar | extend | Assert current panes and X alignment without relaxing target size |
| Posted-material example readiness | openPatternLab readiness helper | reuse | Wait for hydration before the example action |

Affected role: teacher prototypes; student control n/a. Verify desktop/mobile,
light/dark, question menu open/keyboard, headers, Material Write/Markdown/Preview
and existing published date. Production editor owners and schema stay unchanged.

The first ready-head run passed Test & Build, including coverage and production
build. Three database/browser setup jobs hit ECR image rate limits before tests;
returning the PR to draft cancelled two remaining lanes. The completed dark
Pattern Lab lane identified outdated assertions and the prototype X collision.
Posted-material date coverage now uses the shared hydration readiness helper.
Mobile content focus may scroll the dialog, so action placement is measured
relative to its details pane. Classroom boxes end at the close slot, with the
existing 24px fade providing visible separation. Target sizes stay unchanged.
All28affected browser cases pass across desktop/mobile and light/dark; screenshots
were inspected and retained with provenance under ci-correction-2026-10-23.

The completed publication native lane also exposed a nested PL/pgSQL name
collision: its caller's pg_proc record named p shadowed the additive catalog's
policy/procedure SQL aliases. The helper now uses distinct authoring_policy and
authoring_catalog_proc aliases. A READ ONLY execution of the complete nested
publication catalog reproduces the old failure and passes after correction;
all capability predicates, migration hashes, ACLs and trigger checks are retained.
The83affected unit/source checks pass. Isolated native execution and the final
review/CI status are recorded on PR1662; no production schema changed in this
correction batch.

The16focused close/prototype component checks also pass, including keyboard menu
entry, Escape focus return, and the independent enabled corner X. Composite
widget checklist reviewed: yes; keyboard and semantic-state coverage: yes;
remaining manual follow-up: none. Architecture, UI/design policy, TypeScript,
lint (warnings only) and Pika audit pass for this batch.
