# RepoLight assignment review — UI change brief

2026-10-24 · Preparation only · Pika base `c7ff0f1f0`

No UI, API, schema or shared component implementation is authorized by this brief.
The coordinator owns contract acceptance, reference captures and later implementation
assignments. The service/request/import contract remains pending in
[`docs/integrations/repolight.md`](../../integrations/repolight.md); do not invent
endpoint names, persistence fields, permissions or import semantics from this document.

## Acceptance target

Extend the selected teacher assignment/student work surface with public-repository
analysis and review. Keep Pika's existing classroom shell, student document, grading
controls, comment draft and Return behavior. Analyze queues work; status and collected
reports support review; only a separate explicit feedback-import action may change
the Pika comment draft. Collection completion never changes a grade, sends a comment,
returns work or changes student visibility.

Primary signal: a compact, named Repository section and its current textual analysis
status. Blue remains the action/focus accent. Coverage and source-selection notices
sit beside the facts they qualify. Do not add a marketing header, RepoLight brand
chrome, authenticity percentage, inferred effort, contribution ranking, legacy
Contribution/Consistency/Iteration scores, or permanent new sidebar.

## Sources and exact target

Read: `AGENTS.md`, `.ai/START-HERE.md`, `.ai/CURRENT.md`,
`docs/ai-instructions.md`, `DESIGN.md`, `src/ui/README.md`,
`docs/guidance/ui/{README,stable,change-brief,teacher-work-surfaces,teacher-operational-tables,audit-teacher-work-surfaces,composite-widget-accessibility}.md`,
`docs/guidance/assignment-ux-language.md`, `docs/guides/ai-ui-testing.md`, and
`.codex/skills/{pika-ui-change,pika-ui-verify}/SKILL.md`.
The coordinator reported startup/install/session verification passing; this bounded
preparation did not run servers, access credentials or call a database/service.

Exact product owners:

- `src/components/TeacherStudentWorkPanel.tsx` owns selected student work, the
  required-submission links and composition of `TeacherWorkInspector`.
- `src/components/assignment-workspace/TeacherWorkInspector.tsx` owns the collapsible
  History / Grade / Comments sections. Extend this feature owner with Repository
  review, rather than reintroducing the old repo marking controls.
- `src/components/assignment-workspace/useTeacherStudentWorkController.ts` owns
  student identity, read/write suspension, comment draft and section preferences.
  Its current section order is `history,grades,comments`; defaults expand grades
  and comments. A new Repository section must preserve existing saved preferences.
- `src/components/assignment-workspace/types.ts` declares `InspectorSectionId` and
  `StudentWorkData.repo_target`. Existing effective/owner metadata is not authority
  to infer a contributor login. Read submitted repo artifacts and the explicit
  username according to the frozen integration contract.
- `src/components/StudentAssignmentSubmissionChecklist.tsx` already presents
  Repository URL and GitHub username inputs through `FormField`/`Input`. It uses
  explicit artifact metadata or a saved `githubIdentity.github_login`; it does not
  derive the username from the repository owner. Keep username optional, editable
  and clearable; verify an explicitly empty submission stays empty in analysis.

`tests/components/TeacherStudentWorkPanel.test.tsx` deliberately asserts in
“hides the repo marking section even when repo data exists” that Repo / Analyze Repo
and the legacy scores are absent. The new feature requires a reviewed, explicit
acceptance change to this test. Preserve the prohibition on legacy scores and on
unconfigured/unsupported repo actions; add positive assertions for the new guarded
Repository analysis flow. Do not delete the regression wholesale.

## Approved references and capture targets

Nearest approved structural reference: the current selected assignment work panel
and the teacher-family canon. Pattern Lab demonstrates the real shared shell/split
owners; it does not currently render the full production `TeacherWorkInspector`.
Do not mistake placeholder “History · Grade · Comments” text for an inspector fixture.

Coordinator capture targets (use the chosen local server origin):

| URL / surface | Exact anchor or selector | Capture purpose |
| --- | --- | --- |
| `/pattern-lab?role=teacher#teacher-patterns` | `[data-testid="teacher-pattern-examples"]` | Teacher shell, quiet action hierarchy and Classwork left-pane composition |
| Same URL | `[data-testid="continuous-inspector-example"]` | Approved real-owner disclosure/resizing; select Alex Chen / Sam Patel, then close; preserve primary pane and reduced-motion behavior |
| Same URL | `[data-testid="attached-shell-example"]` | Shared tab/tabpanel owner only if report Summary/Evidence becomes tab navigation |
| `/pattern-lab?role=student#student-assignment-attachments` | `#student-assignment-attachments` | Existing production submission controls and missing-attachment confirmation, with deterministic data |
| `/classrooms/<fixtureClassroomId>?tab=assignments&assignmentId=<fixtureAssignmentId>&assignmentStudentId=<fixtureStudentId>` | `[data-testid="grading-inspector-pane"]`, `[role="region"][aria-label="Student work"]`, `[data-testid="inspector-section-comments"]` | Exact live target with submitted repo, current comment/grade and chosen student; verify the existing route selects the intended fixture |

Pattern Lab is dev-only and requires its documented enablement/auth or explicit E2E
fixture mode. The `assignment-controller` fixture is an assignment-edit modal, not a
repository-review reference. Do not enable broad UI-gallery flags in production.
Reference screenshots have not been taken by this preparation worker. Before code,
coordinator must inspect/capture the production target and nearest references at
matching sizes/themes and attach provenance using the visual-evidence template.

## Component decisions

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Selected student inspection | `TeacherStudentWorkPanel` and `TeacherWorkInspector` | extend | Existing feature owners already bind the submission, grades and comments; Repository belongs to the selected workspace only. |
| Desktop/mobile pane behavior | `TeacherWorkspaceSplit` and current classroom shell | reuse | Preserve approved resizing, stable controller identity, mobile composition and reduced motion. |
| Repository disclosure | Feature-owned `InspectorSection` in `TeacherWorkInspector` | extend | Add a domain section, collapsed initially; retain keyboard expansion and visible-section preferences without a new accordion primitive. |
| Labeled optional username / repository controls | `FormField`, `Input`, `Select`, `Button`, `Tooltip` from `@/ui` | reuse | Existing semantics, error wiring, focus treatment and 44px targets cover this need. |
| Large report review | `ContentDialog` / `DialogPanel` from `@/ui` | reuse | Explicit View report can present a contained review surface without a third pane, separate app shell or external navigation. |
| Report summary, contributor list and evidence | A feature-local `AssignmentRepositoryReport` under `assignment-workspace` | create | No existing Pika owner renders the frozen contributor bundle. Compose canonical controls/tables in this one domain owner; do not add a shared `src/ui` report system. |
| Scope selection | `Select` + `FormField` | reuse | Repository overview plus many contributors is a selection, not a new listbox/tab implementation. |
| Summary/evidence disclosure | `Button`; `Tabs`/`TabPanel` only if separate persistent panels are justified | reuse | Keep summary first and evidence on demand. Avoid adding redundant workspace mode chrome. |
| Loading/failure/empty report region | `PageState`, existing inline status/notice conventions | reuse | Failed or missing evidence must not look like verified zero activity. Keep the surrounding work usable. |
| Feedback import | Current controller's guarded draft update/import boundary | extend | Pika owns comments and source freshness; importing must preserve existing text and be an explicit revision-checked operation. |

No shared component extraction or experimental shared pattern is proposed. A later
second adopter with the same stable report behavior could justify extraction; the
assignment feature alone does not. Nearby legacy score-control target sizes and
native-control debt are not permission to copy those styles into the new section.

## Interaction and state contract to carry into implementation

- `entry`/`summary`: no repository inspector, no passive report pane or new mode tabs.
- `workspace`/`inspector_active`: selected assignment and student own Repository.
  Show no stale prior-student report during a new ownership load. Preserve the
  existing read refresh notice and pause Analyze/import while writes are unsafe.
- Missing repo / private or invalid URL / integration unavailable: precise quiet
  unavailable state. Never imply zero commits. No hidden fallback to legacy analysis.
- Ready: submitted public repo and optional explicit username; Analyze is a named
  local action. If several repo artifacts exist, require an explicit supported
  source choice; do not silently pick the first link.
- Queued/running/retry/failed: textual domain status and bounded safe recovery.
  Repeated reads use `fetchJSONWithCache`; polling backs off/stops on unmount or
  owner/source change. An uncertain POST retry reuses its admission identity under
  the frozen server contract rather than creating duplicate jobs.
- Succeeded: concise summary first, source/snapshot/period and material coverage
  limits visible. Username match initially selects that contributor. Missing,
  malformed or unmatched username opens repository overview with an honest notice.
  Never infer identity from repository ownership. All collected contributors remain
  accessible without starting a new collection.
- Repository overview distinguishes linked accounts, bots, unlinked authors and an
  unknown-author bucket. Repository totals are not student work. Unknown-author
  scope can represent multiple people; retain that caveat in summary and evidence.
- Evidence reveals commit links, dates and file activity on demand. Missing dates,
  unknown schedule/history/files and partial cells remain unavailable/unknown.
  Commit date does not establish push time, effort, attendance or AI authorship.
- Feedback import previews the displayed scope and exact text, then performs an
  explicitly named Add to comment draft action through the frozen guarded boundary.
  Preserve existing teacher text; do not silently replace it. Recheck selected
  classroom/assignment/student, submission revision, analysis/source binding and
  current draft revision before accepting late results or imports. Duplicate/stale
  imports must be rejected or reconciled explicitly. Returned comments stay intact.
- Grades, Final/Draft, Send comment and existing Return controls remain Pika-owned.
  RepoLight completion/import cannot activate any of them automatically. Do not label
  deterministic rule feedback as an AI draft or alter authenticity signals.

## Verification matrix and keyboard review

Composite-widget checklist reviewed: yes, for planning. Keyboard/semantic test
coverage and final visual verification remain pending implementation.

| Dimension | Required coverage |
| --- | --- |
| Teacher | Submitted repo with blank, matched, unmatched and malformed username; bot/unlinked/unknown scope; source switch; queued/running/retry/failure; complete/partial/empty/unavailable evidence; explicit import; dirty/changed/returned comment; disabled/write-paused state. |
| Student | Existing submission URL/optional username save/clear/Submit; no analysis, report-import or teacher-only controls; imported draft remains private until the normal Pika visibility action. Required even if its composition is unchanged. |
| Unauthenticated | No report data or mutations; existing login/access boundary only. |
| Viewports | Desktop 1440×900 and mobile 390×844; report dialog long content and narrow-width overflow; selected student/source changes at both sizes. |
| Themes | Light and dark, same layout/geometry, semantic token contrast. |
| Focus / hover | Analyze, View report, contributor selector, evidence and import controls; focus remains visible and async status never steals it. |
| Keyboard | Tab/Shift+Tab order; Enter/Space section toggles without nested-control double activation; native Select options; shared dialog Escape/close and trigger focus return; Tabs arrow/Home/End semantics only if Tabs are used; table scroll region named and keyboard reachable. |
| Motion / continuity | Normal and reduced motion; existing inspector disclosure/resizing; no remount or loss of comment draft/focus/scroll when changing report scope or opening evidence. |
| Status semantics | Announce queued/result/save/import status politely; actionable failures as alerts; text accompanies colors; stale result never presents another student's evidence. |

## Candidate implementation ownership and focused checks

After contract freeze, coordinator can assign the feature-local UI owner:

- `src/components/TeacherStudentWorkPanel.tsx`
- `src/components/assignment-workspace/{TeacherWorkInspector,types,useTeacherStudentWorkController}.tsx` / `.ts` as appropriate
- Proposed `src/components/assignment-workspace/AssignmentRepositoryReport.tsx`
  and a dedicated feature hook/controller for polling/source ownership, with business
  validation in the integration module owned separately.
- `src/components/StudentAssignmentSubmissionChecklist.tsx` only for an approved
  optional-username label/help or clearing behavior change; avoid unrelated layout work.
- `tests/components/TeacherStudentWorkPanel.test.tsx`, new report component/hook
  tests, existing `StudentAssignmentSubmissionChecklist.test.tsx` if affected.
- A deterministic Pattern Lab fixture using the production feature owner, if
  needed for report-specific state capture; no real service calls or synthetic
  authentication bypass. Root coordinates `src/app/__ui` ownership separately.

Keep auth/API/source validation, result persistence, migrations, credentials and
integration schemas with their assigned server owner. Do not re-use legacy repo
run endpoints until the integration contract explicitly approves them.

Focused tests must cover the ownership/source race, one-collection local scope
selection, optional username without owner inference, exact import preview/action,
revision conflicts preserving the teacher draft, duplicate/stale/late result after
student/source change, no grade/Return/visibility mutation, partial/unknown evidence,
and retained existing inspector keyboard and draft continuity behavior.

Run relevant Vitest files, `pnpm check:ui-policy`, `pnpm check:design-policy`, then
required Playwright verification through `pika-ui-verify` for this matrix. Record
source SHA, fixture route, role, size, theme, state and reference for retained captures.
This brief claims source inspection only, not a verified UI or a frozen API.
