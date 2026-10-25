# RepoLight report integration — implementation contract

Original implementation context, 2026-10-24. Pika base `c7ff0f1f0`; RepoLight service contract 1.0
is defined in its `docs/SERVICE.md` and `src/lib/service/contract.ts`. This note
does not enable a gate, configure a credential, apply a migration, or establish
hosted readiness. Risk: `runtime-platform` and `workspace-state`. Model:
GPT-6.1 Sol/high for the cross-service authorization and lifecycle boundary.

## Production checkpoint — 2026-10-25

[PR#1687](https://github.com/codepetca/pika/pull/1687) deployed reviewed production
`dbd1f62c12b3be8f359d6c35fde77a27d7f77987` to `pika.codepet.ca`; Vercel reported READY
on that exact SHA. CI40222687057 passed all ten jobs. The approved one-shot
[migration run](https://github.com/codepetca/pika/actions/runs/40226843818) applied only
293 and verified history 001–293 against the frozen source/digest. Shared local
was untouched. Direct catalog checks passed for ten tables/RLS/ACLs, 53 final
routine bodies, 13 preserved renamed bodies, 31 triggers, constraints/indexes and
current/V2 archive registrations. The public sign-in page returned 200 with an
email-code form; anonymous session/report APIs returned 401 and Pattern Lab 404. Existing cohort/provider settings were unchanged; the window is closed.

A separately authorized controlled pilot now has one installation-bound teacher
connection. Analyze is enabled in server configuration and database settings;
production redeployment `dpl_7687SPdP66G1yzrvXcdb2PeaDBQW` is READY on the same
reviewed source SHA. The original 24 provider controls and Home cohort are unchanged.
Paid AI remains OFF. No migration was reapplied.

The controlled student joined and submitted a public repository through the normal
UI. A blank optional GitHub login exposed an assignment-overview serialization
failure: the repository mapper emitted an own `undefined` property, which the strict
bounded JSON validator rejected. The fix omits absent optional metadata while
preserving supplied strings and strict raw-artifact checks. Its source/tests are
under review; production report creation and feedback import remain unverified.
The epic remains incomplete until the hosted pilot finishes.

The standalone `scripts/inventory-classroom-archives.ts` diagnostic still compares
the current registry against a V1-derived expectation and rejects the additive
RepoLight family. This nonblocking operator-tool follow-up is tracked in PR#1687;
correct it before using that command on the expanded registry. It was not run or
reported passing for this release. Runtime V2 resource graphs are additive-aware;
installation verification used the direct catalog checks above.

## Ownership and product boundary

RepoLight owns one public-repository collection, its pinned SHA, the contributor
bundle, deterministic facts and generated rule feedback. Pika owns assignment,
submission and membership identity, current teacher authority, the local saved
report, comments, marks, Return and student visibility. No AI call is necessary.
No route in this feature calls the old `artifact-repo/run` route,
`completeAssignmentRepoReviewRunAtomic`, AI grading, a grade-save RPC, or Return.
The old completion path writes score suggestions even with `markGraded=false`.

The teacher inspector is
`src/components/assignment-workspace/TeacherWorkInspector.tsx`. Its Repository
section opens the summary first, with contributor selection and detailed evidence
behind View evidence. The approved reuse/extend decisions are in
`docs/guidance/ui/repolight-change-brief.md`; cleanup dialogs have a separate
`repolight-cleanup-change-brief.md`. Repository reports remain separate from
repository marking and the old AI grading flow.

## Submission selection and source identity

Create a new `resolveAssignmentRepoLightSource`, leaving legacy review behavior
compatible. The new resolver must not consume the legacy resolver's inferred
username: `assignment-repo-targets.ts` falls back from `github_username` to
`repo_owner`, and treats an absent username as invalid.

Selection order is an explicit teacher repository override, the selected
structured `repo_link` artifact, then explicitly stored legacy `repo_url`.
With multiple artifacts, require a selected requirement instead of silently
choosing the first. Resolve a username only from an explicit analysis override,
explicit teacher username override, the selected artifact's `github_login`, or
the legacy document's explicit `github_username`. Repository ownership and email
must never supply a username. Missing username is a valid repository overview.
Malformed/unmatched usernames retain the RepoLight bundle's fallback notice.

The existing student checklist already submits `github_login` and can prefill
the saved account; public-repository artifact validation already permits an
absent login. The field is optional. Once an artifact exists, its saved login
value (including blank, null or absent) takes precedence over the saved account,
so clearing it survives reload. The optional compatibility marker
`github_login_selection: 'none'` is also respected when present. Only a new
artifact may prefill the saved account; that prefill remains editable and does
not retroactively reinterpret an old artifact.

The request period is explicit and half-open. Default to the assignment release
and due instants; if release is unavailable, use the last 60 local calendar dates
as a visibly disclosed default. Reject periods beyond the service's
366-day limit instead of truncating silently. Schedule dates come only from
configured `class_days.is_class_day=true` within that period, in
`America/Toronto`, or are explicitly unavailable. Send no attendance/student
activity. Baseline starts unreviewed; exclusions and baseline confirmation are
explicit teacher choices, not automatic starter-code attribution.

Canonical source v1 includes the current owner/connection reference, active
membership binding, assignment/requirement/artifact identity and selected repo,
explicit login provenance, requested branch/period/timezone/schedule, baseline
and exclusions. Compute a server SHA256 over sorted-key canonical JSON with
documented set-array normalization. The server rereads and hashes these durable
inputs under the same lifecycle locks at begin, admission and result acceptance.
Do not use `assignment_docs.updated_at` as the source fingerprint: ordinary
teacher comments/marks also advance it. Keep the document revision as a separate
feedback-import compare-and-swap guard.

## Server connection provisioning

Initial provisioning is operator managed, not a new browser credential store.
One existing RepoLight owner/workspace is connected to one Pika teacher. The
teacher creates an installation-bound API key in RepoLight's authenticated key
screen; the authorized operator installs it in Pika's server secret store. No
key appears in browser props, localStorage, sessionStorage, archives or logs.

Server settings: `PIKA_REPOLIGHT_ENABLED` (exact true, default off),
`REPOLIGHT_API_URL` (HTTPS origin; literal loopback HTTP only in development),
and a strict private `REPOLIGHT_TEACHER_CONNECTIONS_JSON` mapping. Each entry has
`connectionRef`, exact Pika `teacherId`, expected opaque `workspaceRef`,
`installationRef` and server-only `apiKey`. Retain old connection references for
saved-run reconciliation/erasure during rotation; never fall back to a different
teacher or a shared service user. Parse bounds and duplicate identities fail
closed. Routes cannot select a connection or change configuration.

The application may expose only `disabled`, `not_configured`, `ready` or
`unavailable`, with an instruction to connect the workspace through the operator.
A later credential-entry UI needs its own reviewed server secret-storage path.
No automatic registration, account linking, provider key issuance or key
rotation is authorized by this implementation.

RepoLight should add an authenticated connection/capabilities read returning
only contract version, opaque workspace/customer reference, bound installation
and scopes. Current create/status/result responses do not attest workspace
identity. The additive service lifecycle slice implements this read before Pika activation.
Until that read is verified, provisioning must independently verify the
key-issuance metadata against the configured workspace; runtime cannot claim
that a request body proves customer ownership. A rotation must preserve the
expected workspace and installation, and have erasure authority for old subjects.

## Remote contract and privacy

Vendor the minimal strict wire schemas into Pika's feature-owned contract module
with source version/hash and contract fixtures; Pika currently pins Zod 4.3.6. Vendor the canonical pure validation modules with
reproducible import-path rewrites and a source-hash manifest; use the existing
Zod dependency and add no package. Keep bundle validation equivalent,
including evidence/scope partition and cross-reference checks. Existing Pika
grading schemas are not substitutes.

```ts
type CreateEnvelope = {
  schemaVersion: '1.0'
  request: PublicRepositoryRequest
  clientBinding: {
    installationRef: string
    subjectRef: string
    sourceRevisionRef: string
  }
}
// POST /api/v2/analyses, Idempotency-Key: pika-<persisted-run-UUID>
// GET /api/v2/analyses/<persisted-analysisId>
// GET /api/v2/analyses/<persisted-analysisId>/result
```

Allocate/persist a random subject reference and local run before any egress.
The subject is scoped to teacher installation, classroom, assignment/submission,
learner and retained membership generation. Student/classroom cleanup enumerates
all of that target's subjects; deleting one assignment must not erase reports
for another assignment. New enrollment after erasure gets a new subject. Do not
require Pal/Bara provisioning just to obtain a generation: use the retained
membership evidence if available, otherwise a new Pika-owned opaque generation
whose enrollment/removal/restore transitions are explicitly fenced. A raw Pika
UUID, name, email, document, roster, instructions or grading state never crosses
this boundary. `sourceRevisionRef` is the immutable source fingerprint.

Persist the exact encoded create envelope and its SHA256 using RepoLight's
canonical JSON rules: sorted object keys, omitted undefined values, array order
preserved. This request fingerprint is distinct from Pika's source fingerprint.
An uncertain POST reuses the saved bytes and idempotency key, even after a
configuration rotation; it never guesses another analysis ID or generates a
new subject. No request-supplied callback URL, redirect following or credential
forwarding to GitHub is allowed. Use bounded connect/body timeouts, byte limits,
`cache:'no-store'`, typed safe errors and no upstream body logging.

Accept a status/result only when installation, subject, source revision,
request fingerprint and saved analysis ID match. A completed result additionally
requires `analysisId == reportRef == bundle.bundleRef`, a recomputed canonical
SHA256 equal to `reportDigest`, strict bundle validation and the current source
fingerprint. Old-source reports can remain inspectable with a stale label, but
cannot become current or be imported. A partial bundle is a completed report
with limitations; no matching contributor is not a zero student grade.

## Frozen Pika interfaces and writer boundaries

Suggested modules: `src/lib/server/repolight-config.ts`, `repolight-client.ts`,
`assignment-repolight-source.ts`, `assignment-repolight-runs.ts`,
`assignment-repolight-import.ts`, `repolight-decommission.ts`, and
`src/lib/validations/repolight.ts`. One server/data writer owns shared contracts.

```ts
type RepoLightTarget = { assignmentId: string; studentId: string }
type BeginRepoLightRequest = {
  requestId: string                 // UUID allocated once per explicit intent
  requirementId?: string
  analysisOptions?: {
    githubUsername?: string | null  // null explicitly requests the overview
    branch?: string
    period?: { startAt: string; endAt: string; timezone: 'America/Toronto' }
    scheduledProjectDates?: string[] | null
    baselineReviewed?: boolean
    exclusions?: { commitShas: string[]; pathPrefixes: string[]; botLogins: string[] }
  }
}
type RepoLightRunView = {
  id: string
  status: 'queued' | 'submitting' | 'running' | 'completed' | 'failed' | 'stale'
  sourceCurrent: boolean
  canAdvance: boolean
  canImport: boolean
  reportAvailable: boolean
  errorCode: string | null
  nextRetryAt: string | null
}
type ImportRepoLightRequest = {
  requestId: string
  scopeKey: 'repository' | `contributor:${string}`
  expectedDocUpdatedAt: string
  expectedReportDigest: string
  feedbackText?: string             // explicit bounded teacher edit to preview
}
beginAssignmentRepoLightRun(actorId, target, input): Promise<RepoLightRunView>
getAssignmentRepoLightRun(actorId, target, runId): Promise<RepoLightRunView>
advanceAssignmentRepoLightRun(actorId, target, runId): Promise<RepoLightRunView>
getAssignmentRepoLightReport(actorId, target, runId): Promise<ValidatedReportView>
importAssignmentRepoLightFeedback(actorId, target, runId, input): Promise<ImportResult>
```

Route family:
`/api/teacher/assignments/[id]/students/[studentId]/repolight/runs` (POST),
`runs/[runId]` (GET), `runs/[runId]/advance` (POST),
`runs/[runId]/report` (GET), and `runs/[runId]/import` (POST). `GET` on `runs` also returns the authorized
configuration/source summary and latest run so reload can reconnect without
browser-persisted identity or a guessed remote analysis ID.
Use `withErrorHandler`, named Zod request schemas, current-session teacher and
exact assignment/classroom ownership, enrollment and lifecycle checks. Initial
admission does not widen dormant contextual owner gates or rely on a role label
alone. Missing/mismatched relationships return unavailable/forbidden without
triggering external work. Every returned run is rebound to the requested target.

The UI writer receives a feature-local controller contract, not provider
credentials or server state: `run`, `report`, `busy`, `error`, `onAnalyze`,
`onRefreshStatus`, `onOpenReport`, `onImportFeedback`. Keep selection, dirty draft
and navigation ownership in the existing assignment controller. Ignore old-owner
responses after student/assignment navigation. Pause/flush existing autosave
before an explicit import, then use its acknowledged document revision.
Display a report summary and optional evidence view with repository/contributor
selection, coverage and fallback notices. Analyze/status/report remain teacher
only. Student UI changes only explain the optional username; existing sent-comment
visibility and Return remain authoritative.

## Durable local storage and RPCs

Reserve the next non-colliding migration (293 if still next); never edit applied
001–292. Add RLS, explicit table/sequence grants/revocations and service-only RPCs.
Browser code accesses no table/RPC directly. Use generated database types and
feature refinements, not handwritten generated files.

* `assignment_repolight_runs`: local intent UUID; classroom/assignment/student
  binding; source fingerprint/version; selected requirement; connection reference;
  subject binding; exact remote create JSON/fingerprint/idempotency key; remote
  analysis ID; lifecycle state; bounded retry/lease token/generation/expiry;
  safe error and timestamps. One active run per target; a repeated intent/source
  resumes its run. An explicit completed rerun allocates a new intent. Do not
  overwrite or silently reuse an older report for a changed source.
* `assignment_repolight_reports`: immutable run/target-bound validated bundle,
  report reference/digest, contract/metrics/rules versions and accepted timestamp.
  Bound JSON size to the service's eight-million-byte result budget. A report
  insert and run completion commit atomically.
* `assignment_repolight_feedback_imports`: unique explicit import request ID,
  run/report/scope/digest, owner/target, feedback digest and saved document
  acknowledgement. Keep the actual draft in `assignment_docs`; preserve original
  generated feedback in the immutable report. This receipt prevents duplicate
  append after a lost response without reapplying over newer edits.
* Private `repolight_subject_bindings`: exact installation/connection/workspace,
  saved owner/classroom/student/generation scope, opaque subject, permanent
  closed state, durable erasure operation UUID/receipt/retry/lease. The binding
  survives uncertain requests and parent deletion until cleanup is proved.
  Retained completed evidence clears unnecessary direct student identifiers and
  uses saved scope digests. No API key is stored here.

Implemented service-only atomic report RPCs:
`get_assignment_repolight_source_v1`, `begin_assignment_repolight_run_v1`,
`read_assignment_repolight_run_v1`, `advance_assignment_repolight_run_v1`,
`import_assignment_repolight_feedback_v1`,
`begin_repolight_subject_erasure_v1`, `record_repolight_subject_erasure_v1`.
The advance RPC fences claim, authorization, remote-ID acceptance, pending polls,
completion and retry actions with a token and generation. Cleanup uses separate
operation-specific subject snapshot RPCs; callers do not enumerate arbitrary
subjects and erase them before confirming the owning destructive intent.
Read/status adapters must bind saved owner/target as rigorously as mutation RPCs.

Use the existing submission fence, classroom-operation fence, target purge
subject/pair fences, parent row locks and enrollment/generation rechecks in the
established order (see migration 200). Authorize egress after claiming a bounded
lease and immediately before the HTTP request. Persist correlation before egress;
record remote ID under the same lease. Every later write checks token,
generation, live lease, owner, membership, source and erase state. No HTTP occurs
inside a database transaction. Deleted/archived/purged targets cannot start or
complete new work; saved remote copies still enter the erasure ledger.

GET is read-only. Explicit POST advance submits/reconciles one bounded step.
Teacher polling backs off and reconnects to the saved run after reload. An
existing authenticated cleanup invocation may resume already admitted work or
erasures with bounded fairness; it must not discover/start new analyses. Do not
add a sub-daily Vercel Hobby cron or claim browser polling alone is background
execution. Service jobs themselves progress in RepoLight's independent worker.

## Feedback import and Return protection

Import is a new, dedicated RPC, never a grade endpoint. Recheck current source,
report digest/scope, owner, enrollment, no cleanup fence and exact expected
document revision under locks. Deny import if work has been returned or feedback
sent, or either Return marker changed during the operation. A late result remains
readable but cannot alter returned work. Do not clear Return to make import pass.

Append the selected generated feedback, or explicit preview edit, to the current
teacher draft; do not replace existing draft text. Write only
`teacher_feedback_draft`, its timestamp and the normal document revision, plus
the import receipt in the same transaction. Preserve all score fields,
`graded_at/by`, sent feedback/history, Return markers and AI suggestion/provenance.
No import is automatically sent to a student. Returning/sending later uses the
existing teacher-reviewed workflow. A duplicate import request returns its saved
acknowledgement without modifying a newer draft. A new intent with a stale
revision returns 409 and keeps local edits. Do not label deterministic rule
feedback as an AI suggestion or reuse grading-review provenance.

## Remote erasure is an acceptance prerequisite

RepoLight's live jobs/reports/edits are external copies, not historical backups. A
per-job DELETE is insufficient if the initial create response was lost before
Pika saved an analysis ID. Revoking a key does not erase any report.

The additive service contract is implemented and locally verified before Pika activation:

```ts
// POST /api/v2/erasures, authenticated analyses:erase scope
type EraseRequest = {
  schemaVersion: '1.0'; operationRef: string; installationRef: string; subjectRef: string
}
type EraseReceipt = EraseRequest & { status: 'erased'; absenceVerified: true }
```

Require UUID operationRef, bounded opaque refs, credential-derived workspace and
exact key installation. Session owners may erase their own workspace subject.
The atomic service operation permanently tombstones workspace/installation/
subject, fences in-flight workers, deletes all matching jobs/reports/edits and
confirms absence before returning 200. Create uses the same subject lock and
returns 410 `subject_erased` after the tombstone. Same-operation replay returns
the identical receipt; reused operation with another scope conflicts. A different
operation for an already tombstoned subject may conflict: Pika always persists
and reuses its original operation. A timeout, generic 404 or 202 is not proof.
Credential rotation may authorize the same saved workspace/installation; a
revoked/expired key may not erase. Backups retain their actual separate policy.

Pika commits its closed subject and erase operation before network work. It
accepts only a strict receipt matching the saved operation, installation and
subject, then records it under a live local lease. A delayed analysis callback,
poll or retry cannot recreate cleared local state. Disable new analysis while
allowing authorized cleanup/reconciliation of existing bindings. Missing erasure
capability leaves an explicit `repolight_erasure_required` blocker; never report
complete purge or release a re-add fence without it.

## Archive, purge and provider adoption map

Local immutable reports and import receipts are classroom-derived evidence.
They must not become untracked descendant rows. Adopt the tables in
`src/lib/contracts/classroom-data.ts` (`CLASSROOM_RELATIONAL_RESOURCES`, actor
references, privacy classes, `gradex:'exclude'`) and the matching SQL resource
contract/inventory, export, restore and reverse deletion order. Keep the v1
archive contract immutable. Extend the v2 adapter only with an explicit
source-schema-aware rule allowing older archives to supply empty new tables;
otherwise introduce a new archive format. Do not silently change the strict
current manifest table list or claim old archives contain new reports.

Relevant implementation paths:

| Lifecycle | Required adoption |
| --- | --- |
| Archive/export/restore | `classroom-archive-resources.ts`, `classroom-artifacts.ts`, `classroom-archive-format.ts`, `classroom-archive-inventory.ts`, `classroom-archive-restore-operations.ts` and SQL `classroom_archive_resource_contract`. Preserve report bytes/digests; restored runs are detached/read-only and never resume remote work, import old feedback or reopen an erased generation. |
| Soft archive | Retain readable reports; deny Analyze/import/advance that causes egress. Freeze in-flight source acceptance. No remote deletion is implied by archival. |
| Cold compaction | `classroom-archive-compaction.ts` and exact source-row inventory must include new portable rows. Require a fresh verified archive before local deletion. Private provider bindings survive; remote jobs cannot resume from an archive. Do not rely on FK cascades as inventory proof. |
| Joined-student purge | Extend `student_purge_inventory_resources`, `student_purge_conflict`, begin/finalize checks and the exact FK-safe delete order from migration 123. Both start and finish require RepoLight erasure; count new rows and retain the same fence during uncertainty. |
| Removed-member live cleanup | Extend `private.removed_academic_resources`, row hashes, `removed_academic_blockers`, retained-generation/reference guards and provider finalization (173/175/179/288 current forward contracts). `student-provider-cleanup.ts` currently knows only Pal and Bara; add a separate RepoLight stage rather than interpreting either receipt as its proof. Historical verified archives may remain under the existing live-cleanup policy; current RepoLight reports/caches are live copies and must be erased. |
| Whole hot/cold classroom purge | Extend `classroom_purge_conflict`, exact inventories and finalizers used by `classroom-purge.ts` / `cold-classroom-purge.ts`; require all classroom subject receipts, including unknown initial-create outcomes. Preserve other classrooms and account-level workspaces. |
| Assignment/document deletion or reset | Reserve/close affected subjects or their source references under the same parent lock before cascade. Retain a durable erasure binding outside deleted assignment rows until proof; never lose the only remote locator through a cascade. A later fresh source/generation gets a fresh subject when old subject is closed. |
| Provider-owned references | Explicitly register private binding relationships through the governed non-owning/provider-owned schema-audit path in `CLASSROOM_NON_OWNING_REFERENCES`; do not pretend control tombstones are portable classroom content. Extend source actor/reference auditing for any public projection. |

Teacher/customer decommission must enumerate and erase every subject for its
saved connection before discarding the connection's last cleanup credential.
Account deletion is not implemented by revoking a key. Never invoke whole
classroom Bara decommission for a RepoLight subject or infer remote absence from
Pika row absence. Existing private membership-generation guards remain intact.

## Tests and release gates

The testing writer should add behavior tests before implementation:

1. Resolver: explicit/no/cleared/saved-account username, no owner inference,
   legacy fallback, multiple requirements, invalid/unmatched selection, no raw
   identity egress, schedule/DST boundaries and overlong period denial.
2. Transport/contract: HTTPS origin and development loopback rules, redirect/body
   byte/time limits, canonical fingerprint/digest parity with service fixtures,
   wrong ID/binding/snapshot/scope/digest denial and sanitized error categories.
3. Authorization/routes: foreign teacher/class/student/run, removed membership,
   disabled/missing connection/schema, archived/deleted targets and student
   access; every denied begin/advance makes zero external calls.
4. Native database: duplicate intent in two sessions; active-source resume versus
   changed-source conflict; lease takeover and old-worker denial; source edit,
   archive, reset/delete and purge races in both winning orders; snapshot/result
   immutability and exact source/connection binding.
5. Import: append only, no score/provenance/Return/sent-history changes, no dirty
   draft loss, duplicate receipt replay after later edits, stale revision/report,
   unknown contributor, returned work and navigation ownership rejection.
6. Cross-service erasure: unknown initial create response, concurrent create and
   erase, finalizing worker and erase, same operation retries, key rotation,
   timeout/404/wrong receipt, permanent old-subject denial and fresh generation.
7. Lifecycle inventory: archive old/new schema adapter and detached restore;
   compaction equality; joined/removed purge inventory, provider blocker and
   finalizer; whole-class hot/cold purge and other-class/classmate isolation.
8. UI: teacher Analyze/status/reconnect/partial/failure/stale/report/scope/import
   states, optional student username, keyboard/mobile/dark/light, and existing
   sent-feedback/Return regression. Use local Playwright screenshots, not mock
   screenshots, for final visual verification.

Add feature-owned unit/API/controller tests and rollback-only database contracts
under `scripts/check-repolight-*.sql/.sh` plus real two-session concurrency checks.
Use Pika's existing isolated native/ephemeral database harness; do not point a
RepoLight fixture at Pika or reset the shared local database. Update the schema
resource audit, Data API migration policy checks and exact CI classifier paths.
Regenerate `src/types/database.generated.ts` from the authorized local migration
schema; keep JSON/RPC refinements in `src/types/database.ts`. Run
`check:data-api-migrations`, database ACL/contracts, `db:types:check`, architecture,
focused tests and `pnpm check:focused -- --base origin/main`, then independent
risk-matched review and exact-head CI before publication/merge under authority.

This design grants no migration application authority. Create and review source
first, then obtain a direct one-time approval naming the exact Pika migration
and target before applying to shared local or production. Disposable CI replay
does not apply it to either environment. Service migration 0004/erasure,
credential provisioning, application promotion, live cleanup and rollout-gate
activation are separate actions with their own applicable authority. Keep new
Analyze off until source, native tests, erasure contract and approved credentials
are complete; report local/test acceptance separately from hosted operation.
