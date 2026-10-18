# Contextual Survey workflow — dormant source preparation

Prepared against main `22efa4826300d5895b3549d7b74dd0ff4262e4a5` in
`codex/contextual-surveys-workflow`. This is one owner/member Survey workflow
group in batch 2. Genuine generated types and one disposable database component
have been verified. Full Tests/Survey native and app acceptance, independent
cumulative review and protected-main CI remain required.
No admission, migration, provider, billing or product navigation activation is
authorized by this source receipt.

The existing teacher/student Survey URLs and legacy branches remain. The shared
experience admission contract is the sole cohort selector. Admitted users use
current Classroom ownership or current nonowner membership, independent of
their global role. Owners take precedence over historical self-enrollment.
Current `surveys.created_by` is an immutable author field, not permission.
Existing Survey creation still uses migration 193's mixed-classwork allocator.

Migration `263_contextual_surveys_workflow.sql` adds explicit service-role-only
read/write RPCs. Their private context helper acquires the existing Classroom
operation and subject/pair fences, denies existing purge fences and archive
maintenance, locks Classroom→archive revision→Survey with NOWAIT row locks,
and rereads the fixed parent before acting. Existing legacy BEFORE `car_*`
triggers update the same archive revision row before Survey/question/response
changes, so the read snapshots and aggregates fence direct legacy writers too.
The revision is locked, never manually bumped. Existing archive and Blueprint
revision triggers remain authoritative. Row lock inversions fail retryably;
native two-direction race proof is still required before accepting this design.

Owner reads retain archived Classroom inspection. Owner mutations and all member
operations deny archived Classrooms. Member detail denies drafts; it retains
answered history and closed results access. Member results remain visible before
responding when configured and open, and strip classmate IDs/name/email while
retaining response IDs, text and timestamps.
Every disclosed member aggregate response subject acquires the existing
subject/pair fences in UUID order and is checked for a persisted purge fence in
the same locked Classroom/revision transaction. A purge-fenced classmate causes
retryable denial before aggregate disclosure, even when the requester is unfenced.
This does not grant member requests owner authority. Contextual current-roster stats
exclude the owner and include nonowner members of either global role. Legacy
current-roster stats are unchanged. Contextual member list excludes drafts even
if an inconsistent historical response exists; the legacy list is unchanged.

Publication keeps draft→active, active→closed/draft, closed→active, first-question
requirement and prohibition on returning an opened Survey to draft. Same-status
PATCH remains invalid. Opening/reopening uses supplied date or now; explicit
null during opening means now; draft clears `opens_at`. Owner question editing
after opening remains allowed. No Test-style draft lock was introduced.

Canonical JavaScript question/answer validators remain the normalization
authority. Partial question PATCH and response submission capture the complete
atomic question snapshot and pass it to the write transaction; changed question
type, choices, text, limit, order or identity rejects the write instead of
reinterpreting old normalized input. SQL independently checks answer coverage,
discriminants, option range and UTF-16 short-text length. Link answers carry
server-produced `raw_utf16_length` from the exact validated trimmed raw string or
`response_text`, bound to the complete expected question snapshot. SQL requires
an integer from 1 through the current question cap, while checking normalized
HTTP(S) syntax and trim separately. This preserves valid trailing-slash and
Unicode URL serialization expansion at the raw-input cap. The metadata is never
stored, returned or logged; legacy and shared canonical normalization are unchanged.
It reuses the existing private
scalar trim/UTF-16 helpers from migration 234. SQL HTTP(S) URL syntax is a
supplemental check, not a reproduction of WHATWG URL normalization. The route's
existing `normalizeSurveyUrl` remains authoritative. New service RPCs are never
browser-callable. Static duplicate responses stay 400; first response stays 201;
dynamic update stays 200 and preserves original submitted timestamps for existing
rows. The boundary rejects zero-question submission and rolls back incomplete
or changed final response vectors.

Each public RPC has empty search path, explicit PUBLIC/anon/authenticated revoke,
service_role-only execute, 1-second lock timeout and 8-second statement timeout.
PostgREST must hoist `statement_timeout` before its statement (its normal setting);
direct native SQL callers must set a timeout before SELECT. Collections are
limited to 10,000 and read JSON to 8 MiB; owner patches/questions are at most
4 MiB and response/expected snapshots at most 8 MiB, failing closed without truncation. Native
acceptance must check actual timeout cancellation and payload limits.

## Genuine type integration

All public functions return PostgreSQL `jsonb` (`Json` in genuine generated
metadata). The owning coordinator generated `src/types/database.generated.ts`
from cumulative disposable migrations 001–263 and copied the complete genuine
artifact, rather than hand-authoring function entries or using unknown-RPC casts.
The generated contract contains:

| RPC | Args |
| --- | --- |
| `get_surveys_for_owner_v1`, `get_surveys_for_member_v1` | `p_actor_id: uuid`, `p_classroom_id: uuid` |
| `get_survey_for_owner_v1`, `get_survey_for_member_v1`, `get_survey_results_for_owner_v1`, `get_survey_results_for_member_v1`, `delete_survey_for_owner_v1` | `p_actor_id: uuid`, `p_survey_id: uuid` |
| `update_survey_for_owner_v1` | actor, Survey, `p_patch: jsonb` |
| `create_survey_question_for_owner_v1` | actor, Survey, `p_question: jsonb` |
| `update_survey_question_for_owner_v1` | actor, Survey, `p_question_id: uuid`, `p_expected_question: jsonb`, `p_question: jsonb` |
| `delete_survey_question_for_owner_v1` | actor, Survey, `p_question_id: uuid` |
| `respond_to_survey_for_member_v1` | actor, Survey, `p_classroom_id: uuid`, `p_expected_questions: jsonb`, `p_responses: jsonb` |

The TS server adapter indexes each name/Args in the central `Database` contract
and independently decodes runtime output. Missing functions return 503 in the
admitted path; they never cause legacy fallback. No new composer refinement is
necessary for `Json` results unless genuine metadata requires a nullable-input
refinement. SQL internal functions also appear in private schema metadata only
if generated scope includes private; public function arguments contain no new
composite input type.

## Native component verified; full acceptance pending

The sole disposable component attempt on `pika_assignment_list_8f764d70dbd5`
closed successfully against source `d9223d7d68c7a9b5221cfa322f9c96b28dfeb36f`.
It accepted migration 263 in PostgreSQL and completed the rollback contract,
guarded real-SDK contract, terminal checks, genuine type generation and
restoration/preservation checks. The coordinator independently confirmed absence
of its containers, volumes, networks, reserved ports and work directory.

The retained component receipt SHA-256 is
`f848e3426d1b1d7874f27977146f5fef86464d998a98b75ec265a5b539e02d14`.
The 440,703-byte genuine type artifact SHA-256 is
`82324a71d207e1317cb1f3066f71d0be3cffb27fc9f0bf224e80893e1079bf48`.
Its twelve public RPC contracts were independently validated before integration.
This component is spent and cannot be retried or rebound. Its receipt retains
`nativeVerified=false`: committed race directions, backend/waiter observations,
actual timeout cancellation and payload limits, and existing-screen mixed-role
application verification remain outstanding. It does not authorize a shared
database migration, production release or cohort activation.

The concrete Survey platform adapters are frozen before private registration;
copied, replaced or getter-based adapters cannot enter the lifecycle. A single
captured budget covers twelve minutes of work and three minutes of cleanup,
including preflight, child dispatch, inventory, generation and final preservation.
The workload must match that original work deadline before consumption. Cleanup
does not renew either deadline. Work discovery admits no new readers after the
work cutoff; already-owned transports may settle within the original cleanup
reserve. Generator failure-finally explicitly uses settlement admission. Unjoined
uncertainty is sticky through secondary checks and poisons outer cleanup, rather
than permitting ordinary stop/removal while child closure remains unknown.
The pinned native Supabase executable is invoked directly rather than through
its Node wrapper. Existing predecessor profiles retain their original behavior.
These source/CPU guarantees apply independently of the bounded component receipt
above; they do not substitute for the remaining native acceptance cases.

`scripts/contextual-surveys-db-contracts.sql` is a rollback-only cumulative-schema
contract with synthetic mixed-role identities, actual catalog ACL checks,
owner precedence, foreign parents/questions, publication/time/status, complete
static/dynamic responses, UTF-16 overflow rollback, both raw-cap URL expansion
vectors and invalid/missing/over-cap link length evidence, stale authoring snapshots,
privacy, removal/archive/purge-fenced reads, cascade deletion and revision effects.
Root runs it only in the separately authorized disposable acceptance target.

`scripts/contextual-surveys-sdk-contracts.ts` is inert on import and accepts the
root's existing guarded disposable real SDK client. Its fixed active single-text
question fixture exercises all twelve new public RPC names with a 16-request,
20-second ceiling and verifies decoded owner/member payloads. Root owns target
binding, fixture capture, restoration and preservation snapshots; the companion
does not load environment credentials, create accounts or choose a target.

`scripts/contextual-surveys-concurrency-cases.ts` supplies fifteen inert SQL race
cases to the existing independent-connection driver. Capture the actual member
detail's questions and canonical answers before semantic-change cases. Each case
starts from restored synthetic source state. Run both lock directions and prove
blocking/retryable outcomes, correct subsequent read/write, complete vector or
rollback, unchanged timestamps and unrelated source preservation. The cases
cover direct legacy child writes, owner replacement/archive/removal, subject and
Classroom purge locks, question reparent/text/type/choice/limit changes, closure,
static duplicate and dynamic replacement. The root's driver must observe actual
lock states rather than rely on a sleep. The rollback contract separately checks
committed active purge fences, including unfenced member B requesting fenced
member A's responses. The cross-subject race uses a separate synthetic aggregate
Survey with one committed A response and a distinct enrolled B reader; the SDK
primary Survey retains its original empty response vector. The existing subject
case is replaced, keeping fifteen cases/thirty directions and existing bounds.

Focused source checks cover legacy Survey suites, contextual helper/route suites
and unchanged classwork creation. Remaining full native proofs,
independent cumulative review, final-SHA CI/PR Gate and reachable existing-screen
mixed-role rehearsal are outstanding. UI changes require the Pika UI skills and
visual matrix; this source group changes no UI. Root owns roadmap, continuity,
shared types, package/classifier/CI integration and publication.

## Remaining-proof transport preparation — 2026-10-17

The thirty-direction proof previously emitted at least32 complete database graphs.
It now keeps complete rows for the eight tables inspected by its seed/effects
oracle, while every other public/private/storage table carries a deterministic
full-row SHA256/count and exact id/artifact_id/generation_id projections. Complete
table-key comparison, off-table content preservation and cross-table collision
checks remain mandatory. This reuses the accepted hot-lifecycle witness approach;
At that stage it did not raise the8MiB frame or64MiB cumulative transport limit;
the later remaining-only cumulative exception is recorded under correction134.

Source/CPU preparation does not establish native byte fit or acceptance. The
closed remaining269 source integration now counts198 native actions,4008 native
controls,4366 normal-completion controls or4387 partial-teardown controls,
16 original HTTP requests and14 observer frames. Its cumulative exchange cap is
now128MiB for remaining269 only (correction134). The6000-control allowance,
two persistent sessions,8s RPC behavior and12-minute work
plus3-minute cleanup clocks remain unchanged. The isolated remaining rollback
frame now has the separately approved120s exception in correction135; all other
35s frame limits remain unchanged. The complete
source inventory is distinct from native acceptance and execution admission.

The same rollback SQL frame contains49 cases: input/detail byte and shape
boundaries, valid multi-answer vectors, list/results byte pairs, reachable
10,000/+1 count pairs and cardinality denials. Every case retains exact
measurements, byte-mask checks, original RPC calls, success/denial assertions,
real triggers and full scoped row/revision restoration equality. The member
response-count pair is joint with question count. The earlier19-case component
prerequisite passed; the first expanded49-case attempt failed its35s frame
without case telemetry and is permanently spent. At that point no49-case native
pass had been established;35-second fit remains unproved.

Correction128 separates count fixtures inside that same DO and outer rollback:
twelve question/response cases use one Survey; four list cases use10,001 Surveys
and one real answered question. The list fixture adds exactly one response
insertion and retains submitted=true/responded=1 with questioncount1. Each
family has its own complete restoration check; no fixture commits or extra
SQL frames/actions/controls/sessions are introduced. The full-state digest and
all production migrations/functions remain unchanged.

The exact Survey SQL frame emits211 closed INFO SQLSTATE progress markers for
functional/fixture stages and each case's start, RPC start/end and restored
state. The parser bounds this to224 events and128 bytes per line (28,672 bytes
maximum), charges the existing stderr exchange ledger, stores only fixed stage
identifiers and client monotonic elapsed milliseconds, and freezes on first
failure. It rejects malformed, duplicate, out-of-order and oversized markers.
It joins stdout completion and stderr progress within the bound frame timer;
telemetry is diagnostic only and never supplies native acceptance. SQL source
and marker bytes remain charged to the cumulative total (now128MiB only for
remaining269; legacy263/component269 retain64MiB). Full remaining-run
exchange fit remains unproved; partial-attempt totals do not establish completion.

## Remaining-only rollback timeout correction130

The second expanded49-case attempt also failed the35s deadline and is permanently
spent. Its last valid marker was171, count-response-questions:exact:rpc-start,
at28,081ms, after40 restored cases. The real10,000-question existing-response
upsert had started but no RPC-end marker arrived. Cleanup and preservation
checks passed; this is localization evidence, not a completed49-case proof.

The owner approved raising only this isolated full49-case remaining rollback
SQL frame to90s. The sealed remaining plan derives its SQL from the unchanged,
hash-verified shared35s source, requires exactly one source-owned timeout header,
and replaces only that header with90s. Its full manifest binds those derived
bytes, and its actual client deadline is90,000ms. The original work cutoff still
clamps that deadline. Component and legacy/native profiles, the product checkout,
setup/snapshot/single-frame35s limits, committed/probe/SDK behavior, and every
case, telemetry marker, trigger and restoration check remain unchanged.

The third remaining attempt completed the49-case rollback SQL frame in74,899ms
with all211 valid progress markers, establishing that isolated frame's90s fit.
It subsequently failed in committed direction18's terminal frame (action115),
so full remaining native acceptance is still absent. All three attempts remain
spent; source validation does not admit or replay an attempt.
Actions, controls, HTTP, sessions, exchange bytes and work/cleanup allowances
are unchanged; this exception grants no other cap increase or production action.

Correction131 fixes the committed proof's terminal responder selection, not the
product. Reverse question-edit cases8–11 had already committed member A's static
answer, so the product correctly returned duplicate-response PT400 before stale
questions PT409. Those four terminal freshness probes now use existing enrolled,
unanswered member B. Their original concurrent operations and fresh reads retain
A. Same-frame eligibility and exact fixed denial-cause checks preserve the stale
question assertion; complete graph/effect equality retains A's response and B's
absence. Forward freshness probes remain A; close/static-duplicate probes retain
their original actors and PT400 causes. CPU fixtures derive denials from actual
actor/graph preconditions rather than copying the expected status. No fixture,
frame, action, control, HTTP request, session or cap is added; no product, migration
or shared49-case SQL changes. Corrected committed native acceptance remains unproved.
The committed static SQL inventory grows864,383→874,891 bytes (+10,508): eight
freshness terminals add eligibility/cause checks and four close/duplicate terminals
add exact cause checks. Only four reverse terminals change responder identity.

Correction132 addresses the fourth remaining attempt's timing failure, not a
product change. Its49-case frame completed211 valid markers in75,231ms; direction5
then failed with contender55P03 while action35 was attempting holder release.
A valid≤750ms waiter observation preceded a full fresh release guard, which can
outlast the successful-WAIT fixture's former1s lock wait. This fourth attempt is
also permanently spent; full remaining acceptance and cumulative byte fit remain
unproved.

Only the13 successful-WAIT direct legacy contenders now use fixed8s lock_timeout,
aligned to their unchanged8s statement ceiling. This explicitly changes that
internal fixture contract; holders, NOWAIT/negative cases, retries, terminals and
product function1s settings remain unchanged. The release carrier privately binds
its original contender; ordinary release is checked before/after the full fresh
guard and immediately before dispatch against original dispatch+8s, clamped to
the global work cutoff. Its frame timer uses only that remaining time. No renewed
clock, late ordinary COMMIT, cached guard or weakened≤750ms observation is allowed.
Guard child APIs/joins and original cleanup remain unchanged. Normal198actions,
4008nativecontrols,16HTTP and874,891 static SQL bytes remain unchanged; all user
overall budgets, product RPC8s behavior and production holds remain in force.

Correction133 addresses the fifth remaining attempt's restoration failure.
Its49-case matrix completed211 valid markers in82,115ms and all30 committed
directions reached their terminal checks. The original cancellation response and
pending-backend proof passed, but restoration failed at action190. Authorized
recovery identified the missing relation as the cancellation baseline's TOAST
table: a table-sourced JSONB variable was reused after dropping its backing table.
The failed restoration transaction retained its instrumentation. Root subsequently
verified the full184-table/catalog baseline equality and settled the exact owned
runtime/resources; that recovery does not turn the spent fifth attempt into a pass.

Both cancellation restore variants and wire restore now select
`(state::text)::jsonb` into their captured baseline before DROP. Complete state
comparisons, receipt hashes, backend ownership, real triggers and revision checks
are retained. A standalone rollback-contained forced-external-TOAST regression is
prepared at `scripts/contextual-surveys-restoration-toast-regression.sql`; it is
not part of any runner and still requires separately authorized isolated execution.
CPU source checks alone do not prove PostgreSQL storage lifetime behavior.

Only the remaining profile's volume/network inspections now request compact
**full** JSON objects (`--format '{{json .}}'`), with the same complete global
lists, IDs, labels, foreign attachments, guards, joins and actual raw-byte charges.
Legacy/component array output and the container template are unchanged. No field
projection, cache, skipped inspection or control/action reduction is introduced.
Normal198actions/4008nativecontrols/16HTTP and all existing caps remain unchanged.
Measured representation savings did not establish complete64MiB budget fit.
The subsequent explicit allowance is recorded below; real TOAST and full remaining
proof are still required, not inferred from CPU checks or recovery.

## Remaining-only cumulative allowance correction134

The user explicitly approved128MiB (134,217,728bytes) cumulative verification
exchange for remaining269, review, the isolated PostgreSQL TOAST regression and
one fresh bounded full rehearsal. The closed remaining ledger, request admission,
complete plan inventory and native command/framed-session cumulative checks use
that allowance. Legacy263, component269 and the shared standalone cancellation
descriptor remain64MiB; only the remaining-specific caps override the cumulative
value. No generic caller-configurable override is introduced.

Every actual exchange channel stays charged. Ordinary work and final acceptance
reject over128MiB; existing owned cleanup may still account bytes after overflow,
but cannot turn that overflow into success. The8MiB frame/response ceiling,
200actions/6000controls/16requests/two persistent sessions,60s SDK,720000ms work
plus180000ms cleanup and8s RPC are unchanged. The then-current remaining49-case
90s SQL limit is superseded only by correction135 below.
This is an explicit cap change, not a claim that all earlier caps were unchanged.
Approval does not replay spent attempts or prove fit: root owns review, regression,
stable-source binding and the one fresh admission. No native acceptance is claimed
by this source correction; all production/shared-local/provider/account/rollout
holds remain.

## Remaining-only49-case timeout correction135

The sixth remaining attempt is permanently spent: its90s49-case frame timed out
after valid progress marker174 at89,773ms. Exact cleanup and immediate two-source/
two-dependency preservation passed; no native process remains. The standalone
TOAST regression separately passed on PostgreSQL17.6 under its prior approval;
it is not rerun by this correction.

The user explicitly approved increasing only this49-case SQL suite to120seconds,
review and one fresh bounded rehearsal. The raw shared SQL remains35s. The exact
remaining derivative substitutes only its unique timeout header with120s; the
complete manifest, inventory and rollback driver's client timeout bind120,000ms.
All49 cases and211 progress markers remain byte-identical apart from that header.

The generic native action ceiling stays90,000ms. Its sole120,000ms exception
requires the active original remaining rollback call, transitions phase, exact
contracts session with owned backend, exact sealed suite SQL, no committed-frame
carrier and no cleanup/first-fault state. The scope closes in finally. Requested
timeouts are validated before the original global-work cutoff clamps them, so
a short remaining work window cannot authorize oversized other-frame requests.
There is one original frame timer, with no renewal, suite splitting or extra
SQL/session/action/control. Component/legacy SQL35s and other frame limits stay
unchanged, as do8s RPC,60s SDK,200actions/6000controls/128MiB/16HTTP/two sessions
and720000ms work+180000ms cleanup. All production/shared-local/provider/account/
rollout holds remain. CPU checks do not establish120s native fit or full acceptance;
root owns stable-source review and the one fresh admission, never replay of v6.

The original cancellation and wire probes,30 committed directions, ordinary
14 SDK calls, genuine269 types, restoration/preservation and screen proof remain
required. No nativeVerified flag is raised, no spent attempt is replayed, and
all production/shared-local/account/activation holds remain. The canonical
roadmap still governs phase exit.

## Remaining witness diagnostics correction136

The seventh remaining attempt is permanently spent. Its49-case suite completed
all211 valid markers in106,109ms under the approved120s ceiling. It later failed
at action148/control2387, the host observation validation for direction24,
`response_after_text_limit_change:reverse`; release action149 was not counted.
Cleanup settled with no failures and immediate source/dependency preservation
passed. The old unknown/none diagnostic cannot identify the failing predicate.

The existing actual-engine CPU seam now reproduces that signature at this exact
direction. A delayed mandatory observer guard is included in the original
contender-dispatch→observation interval:750ms passes and751ms refuses release.
Receipt, prematurely settled contender, backend/blocker/waiter, holder operation,
source and timestamp defects are separate counterexamples. These reproductions
do not establish which condition caused v7.

Only remaining-profile host witness failures add one fixed diagnostic line:
direction ordinal1–30, observer/contender frame, closed predicate label and one
integer observation delta clamped to±720000ms (unknown when unavailable/nonfinite).
The first eligible failure is frozen; prior transport/guard faults retain their
original diagnostic priority. No SQL, arbitrary exception message, graph, row,
identifier or absolute timestamp is included. Classification is associated with
the original thrown object privately; caller-supplied error text is not a label.

Acceptance predicates/order and clock origins are unchanged, including the750ms
inclusive WAIT observation, every fresh guard and positive original blocking edge.
There is no additional SQL frame, action, control, HTTP request, timer or retry.
Normal198actions/4008nativecontrols/16requests and all previously approved ceilings
remain unchanged:120s only for the exact49-case suite,8s operation/RPC,60s SDK,
200actions/6000controls/128MiB/two sessions and720000ms work+180000ms cleanup.
Legacy/component behavior and all production/shared-local/provider/account/rollout
holds remain. Independent source review is required before any separate rehearsal
decision; this correction neither admits a new attempt nor claims native acceptance.
