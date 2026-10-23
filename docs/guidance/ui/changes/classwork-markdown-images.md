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
Migration replay, generated metadata and independent review
remain pending; the PR must remain draft until those gates pass.
