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
