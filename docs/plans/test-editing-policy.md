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
| options | Entire ordered array frozen, including strings; positions are answer identities |
| correct_option, answer_key, sample_solution, points | Frozen; no regrading |
| response_max_chars, response_monospace | Frozen |
| Other current/future authored fields | Frozen by database default |
| AI reference cache and timestamps | Existing operational exception preserved |
| Blueprint version provenance | Existing owner-only exact-column exception preserved |
| Test title/documents/result visibility | Existing separate policies unchanged |

Start must persist before questions become answerable. It uses the existing atomic
attempt RPC with NULL responses meaning Start/Resume; existing responses are retained.
Classroom then Test locks serialize Start/save/submit against teacher authoring.
The Test retains an irreversible questions_locked_at even after close, unsubmit or
student-work deletion. Existing attempts/responses backfill conservatively because
historical blank closure rows are indistinguishable from starts. Future teacher-only
closing does not itself set the boundary. Opening a list/detail or teacher preview
is not Start. A successful Start reloads current questions before exposing the form.

Only prompt corrections are mechanically enforceable: teachers remain responsible
for keeping the meaning of the question intact. Option-text corrections are excluded
because this schema cannot distinguish a correction from replacement of an answer.

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

142_test_prompt_corrections_after_start.sql is prepared, not applied. The new
application fails closed if the column is missing. Generate database types and
run database replay/concurrency checks after exact local-migration authorization.
No hosted migration, merge or deployment is authorized.
