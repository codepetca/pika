# Test corrections after Start

Risk profiles: workspace-state, exam-mode; migration/concurrency risk is high.

## Field policy

Before first Start, existing versioned authoring is unchanged. After Start:

| Field | Policy |
|---|---|
| question_text | Editable prompt wording, typos and instructions (including Markdown formatting) |
| Question ID, artifact/source identity, test_id | Frozen |
| Question membership and position | Frozen (no add/delete/duplicate/reorder) |
| question_type | Frozen |
| options | One existing multiple-choice choice string per question editable per save; choice count and position indices remain fixed because indices are answer identities |
| correct_option, answer_key, sample_solution, points | Frozen; no regrading |
| response_max_chars, response_monospace | Frozen |
| Other current/future authored fields | Frozen by database default |
| AI reference cache and timestamps | Existing operational exception preserved |
| Blueprint version provenance | Existing owner-only exact-column exception preserved |
| Test title/documents/result visibility | Existing separate policies unchanged |

## First-version MC choice corrections

The teacher question editor now keeps existing MC option text fields enabled
after Start. Its add, remove, reorder and marked-answer controls stay locked.
Markdown saves use the same field policy. The server checks that at most one
option string changes per question per save, along with choice count and all
frozen fields. The database trigger enforces the same boundary for materialized
questions and requires every replacement choice to remain text. This change
requires migration 219; deploy the migration before the application code. Until
then, the database rejects choice corrections with a conflict rather than
silently saving them.

UI reference: existing teacher Test question cards and `/pattern-lab` controls.
Surface: teacher test authoring in card, accordion, detail and split editors.
Roles: teacher; student view is checked because corrected choice text appears
there. Viewports: 1440×900 and 390×844. Themes: light and dark. States: before
Start, after Start, choice edit/save, locked answer controls, student answer view.
Primary signal: existing editable option input beside disabled answer control.
No new icon, dialog, status color or composite widget is introduced; existing
keyboard and focus behavior is retained.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Choice text editing | TestQuestionEditor | extend | Owns the MC option inputs |
| Boundary notice | Existing inline lock notice | extend | Must state the revised rule |
| Student display | StudentTestForm | reuse | Renders the updated option strings |

Start must persist before questions become answerable. It uses the existing atomic
attempt RPC with NULL responses meaning Start/Resume; existing responses are retained.
Classroom then Test locks serialize Start/save/submit against teacher authoring.
The Test retains an irreversible questions_locked_at even after close, unsubmit or
student-work deletion. Existing attempts/responses backfill conservatively because
historical blank closure rows are indistinguishable from starts. Future teacher-only
closing does not itself set the boundary. Opening a list/detail or teacher preview
is not Start. A successful Start reloads current questions before exposing the form.

Prompt and choice-text corrections cannot be distinguished mechanically from a
change in meaning. Teachers remain responsible for preserving the intended
question and answer. The editor keeps choice positions fixed; the server and
database reject multi-position replacements, including a direct reorder. With
strings alone, sequential edits could still change meaning or reorder text.
Students already taking the Test retain their loaded wording until they reload.
This first version does not add an audit or student notification flow.

## UI brief

Surface: teacher question authoring and Markdown; student Start confirmation.
Reference: teacher work-surface canon, current question cards, Pattern Lab controls,
feedback and teacher work surfaces. Primary signal: concise inline boundary notice
and read-only structural/grading controls; editable prompt remains unchanged.
Roles: teacher/student. Viewports: 1440x900 and 390x844. Themes: light/dark.
States: before Start, after Start, safe prompt edit, blocked Markdown edit, stale
editor conflict, pending/failed Start, resumed work. Composite controls: verify
existing split button, accordion and focus behavior; no new shared widget.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Prompt correction | TestQuestionEditor | extend | Separate prompt and structure permissions |
| Markdown correction | TestDetailPanel | extend | Validate same allowlist before applying |
| Controls/notice | @/ui and inline feedback | reuse | Existing semantics/tokens |

No menu redesign, no preview-icon changes, no automatic regrading. PRs 1137/1138
were open at audit (f69b2346 / e0787da7); their worktrees and ports remain untouched.
Follow-up outside scope: Close should confirm discarding unapplied Markdown.

## Rollout

143_test_prompt_corrections_after_start.sql was applied and verified locally under
its original version 142 before `main` introduced the Attendance migration now at
142. After resequencing, replay both migrations through 143 and regenerate the
database types. The application fails closed if the Test editing column is
missing. No hosted migration or deployment is authorized.
