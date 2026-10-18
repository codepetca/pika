# Contextual Survey workflow — dormant source preparation

Prepared from completion-plan source `466c16abcb313e20defea1502162dd2108641de9`
on main `f88b06a5e52da64f182fa31ec1e7ba2258438c02`, including reviewed hot
Classroom archive/restore migration268. The additive Survey migration is now
`269_contextual_surveys_workflow.sql`; its SQL bytes match the earlier reviewed
Survey263 source. This is product preparation, not an accepted PR,
native verification result, batch2 exit or activation receipt.

The existing teacher/student Survey URLs and legacy branches remain. The shared
experience admission contract is the sole cohort selector. Admitted users use
current Classroom ownership or current nonowner membership, independent of
their global role. Owners take precedence over historical self-enrollment.
Current `surveys.created_by` is immutable author provenance, not permission.
Existing Survey creation still uses migration193's mixed-classwork allocator.
Missing contextual functions fail closed; they never cause a legacy retry.

## Authority and transactions

Migration269 adds twelve explicit service-role-only read/write RPCs. Their private
context helper acquires the existing Classroom operation and subject/pair fences,
denies existing purge fences and archive maintenance, locks Classroom → archive
revision → Survey with NOWAIT row locks, and rereads the fixed parent before
acting. Existing legacy BEFORE `car_*` triggers update the same archive revision
row before Survey/question/response changes, so snapshots and aggregates fence
direct legacy writers too. The revision is locked, never manually bumped.
Existing archive and Blueprint revision triggers remain authoritative. Row-lock
inversions fail retryably; current-base native race proof remains required.

Owner reads retain archived Classroom inspection. Owner mutations and all member
operations deny archived Classrooms. Member detail denies drafts and retains
answered history and closed results access. Member results can be visible before
responding when configured and open; they strip classmate IDs, names and emails
while retaining response IDs, text and timestamps.
Every disclosed member aggregate response subject acquires the existing
subject/pair fences in UUID order and is checked for a persisted purge fence in
the same locked Classroom/revision transaction. A purge-fenced classmate causes
retryable denial before aggregate disclosure, even when the requester is unfenced.
Contextual current-roster statistics exclude the owner and include nonowner
members of either global role. Member lists exclude drafts even if an
inconsistent historical response exists. Legacy statistics and list behavior
retain their existing contracts.

## Publication and response semantics

Publication keeps draft → active, active → closed/draft and closed → active,
the first-question requirement, and the prohibition on returning an opened
Survey to draft. Same-status PATCH remains invalid. Opening/reopening uses the
supplied date or now; explicit null during opening means now; draft clears
`opens_at`. Owner question editing after opening remains allowed.

Canonical JavaScript question/answer validators remain the normalization
authority. Partial question PATCH and response submission capture the complete
atomic question snapshot and pass it to the write transaction. Changed question
type, choices, text, limit, order or identity rejects the write instead of
reinterpreting normalized input. SQL independently checks answer coverage,
discriminants, option range and UTF16 short-text length. Link answers carry
server-produced `raw_utf16_length` from the exact validated trimmed raw string or
`response_text`, bound to the complete expected question snapshot. SQL checks
its integer value against the current cap and separately checks normalized
HTTP(S) syntax and trimming. This preserves valid trailing-slash and Unicode URL
serialization expansion at the raw-input cap. That metadata is never stored,
returned or logged. Existing private trim/UTF16 helpers from migration234 are
reused; SQL URL syntax supplements the canonical WHATWG URL normalization.

Static duplicate responses stay 400; first responses stay 201. Dynamic updates
stay 200 and preserve original submitted timestamps for existing rows. The
boundary rejects zero-question submission and rolls back incomplete or changed
final response vectors. Question and Survey deletion verify cascade effects.

Each public RPC has an empty search path, explicit PUBLIC/anon/authenticated
revocation, service-role-only execution, a 1-second lock timeout and an 8-second
statement timeout. PostgREST must hoist `statement_timeout` before its statement;
direct native SQL callers must set their timeout before SELECT. Collections are
limited to 10,000 and read JSON to 8 MiB; owner patches/questions are at most 4 MiB
and response/expected snapshots at most 8 MiB, failing closed without truncation.
Native acceptance must check actual cancellation and payload limits.

## Type integration

All public functions return PostgreSQL JSONB (`Json` in genuine generated
metadata). The server adapter indexes each name/Args through the central
`Database` contract and independently decodes runtime output. The required RPCs
are:

| RPC family | Arguments |
|---|---|
| `get_surveys_for_owner_v1`, `get_surveys_for_member_v1` | actor, Classroom |
| `get_survey_for_owner_v1`, `get_survey_for_member_v1`, `get_survey_results_for_owner_v1`, `get_survey_results_for_member_v1`, `delete_survey_for_owner_v1` | actor, Survey |
| `update_survey_for_owner_v1` | actor, Survey, patch |
| `create_survey_question_for_owner_v1` | actor, Survey, question |
| `update_survey_question_for_owner_v1` | actor, Survey, question ID, expected question, question |
| `delete_survey_question_for_owner_v1` | actor, Survey, question ID |
| `respond_to_survey_for_member_v1` | actor, Survey, Classroom, expected questions, responses |

The current-main generated artifact is retained during source preparation.
Genuine full001–269 generation is held pending separately authorized disposable
schema verification. The donor's old001–263 generated artifact must not replace
it: that would remove newer Test date, saved-work and hot-lifecycle metadata.
No manual generated entries, unknown-RPC casts or temporary stubs substitute for
that generation. TypeScript completion remains blocked until the genuine new
RPC metadata is available. No composed JSONB result refinement is planned.

## Historical evidence and remaining acceptance

An earlier disposable001–263 component accepted the same Survey SQL bytes and
completed rollback/guarded real-SDK contracts and genuine type generation against
source `d9223d7d68c7a9b5221cfa322f9c96b28dfeb36f`. Retained component receipt
SHA256: `f848e3426d1b1d7874f27977146f5fef86464d998a98b75ec265a5b539e02d14`.
Its genuine old-schema artifact SHA256 was
`82324a71d207e1317cb1f3066f71d0be3cffb27fc9f0bf224e80893e1079bf48`.
That spent component retained `nativeVerified=false` and cannot certify the
current001–269 base or be retried/rebound as a new acceptance attempt.

The extracted inert rollback SQL, installed-SDK companion and fifteen SQL race
definitions remain available to the coordinator's guarded verification workflow.
The rollback SQL prepares nineteen exact/one-byte-over/input-shape payload cases;
CPU/source checks do not establish native execution, actual 35-second fit or wire
bytes. Valid 8 MiB response vectors, list/results byte limits and 10,000-row guards
remain uncovered. Old runner seals tied to001–263 are excluded from this product
extraction. The separate cancellation-proof worker owns its module and test.

Remaining gates are current-base cumulative replay, genuine generated types,
actual committed races in both directions with observed lock state, timeout and
cancellation/finally restoration, size/count/wire boundaries, real SDK checks,
existing-screen mixed-role Survey rehearsal, independent cumulative review and
stable reviewed-SHA CI/PR Gate. No new UI is included. No production/shared-local
migration, provider/account/billing action, admission/home/page/cohort/cutover
activation or phase exit is authorized by this preparation.
