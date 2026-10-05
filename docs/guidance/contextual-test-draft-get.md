# Contextual owner Test draft GET

Status: source preparation on `codex/contextual-test-owner-draft-get`, based on
verified main `7570a9d60591183f0699001f47a6528045a392ee`. Migration247 is additive
source only. Shared local schema was last verified001–243 and production001–225;
neither is changed by this preparation. Initial and targeted source reviews,
normal runtime proof and after-fixture cleanup have passed. Genuine isolated
schema contracts are installed. Before-capture cleanup, final integration
review, stable-head CI and normal main merge remain pending.

## Boundary

Only GET `/api/teacher/tests/[id]/draft` enters the existing dormant shared
classroom-experience admission boundary. Absent or non-admitted configuration
retains the literal legacy GET; present malformed configuration fails503 after
authentication and before discovery. PATCH and all other authoring, participation,
grading, Storage and UI operations remain outside this slice.

An admitted current Classroom owner may use this endpoint regardless of global
account role. Membership, a teacher label or a subscription alone grants nothing.
All paths require an active Classroom, matching the legacy draft GET; the separate
detail GET remains the archived-owner inspection surface. Owner precedence holds
when the owner is also enrolled. No cohort or permission activation is included.

The endpoint can create or repair a draft despite being GET. Use two service-only
RPCs: `snapshot_test_draft_for_owner_v1`, then
`finish_test_draft_get_for_owner_v1`. The first returns strictly bounded complete
source and an opaque SQL-produced SHA-256 digest. The final transaction binds the
same actor, Test and fixed Classroom, rechecks authority and source, and performs
exactly inspect, create or repair. No direct-table fallback, raced-draft reread,
generic ensure helper or post-write policy query belongs to the admitted path.
The public DTO remains exactly `{ draft, editingPolicy }`.

## Compatibility and persistence

| Existing state | Result | Persisted effect |
| --- | --- | --- |
| Draft Test, valid stored draft | Canonical validation and portable projection | None |
| Active/closed Test, any existing draft | Rebuild from current persisted questions/title/results setting | None, even when old content is invalid |
| Missing draft | Rebuild baseline | Insert version1 with both actor stamps |
| Draft Test, invalid stored content | Rebuild baseline | Increment version once and stamp updating actor |
| Wrong-Class draft or malformed source | Fail503 | None; never move or repair the wrong row |
| Ambiguous portable identities | Fail409 | None |

Existing retired-Test inspection is allowed in an active Classroom; creating or
repairing a retired Test is denied403. Never clear retirement or revive authoring.
Reuse the canonical validators, baseline builder and portable-identity projection.
Preserve draft-only portable IDs, copied-question source identity and Markdown
content. Do not infer identity from question text or position.

The digest covers the complete ordered builder-input question projection, count,
fixed actor/Classroom/Test controls and full selected draft row, including raw
content and stamps. AI caches, automatic question timestamps, documents and
Storage references are excluded because they are not inputs to this operation;
their exclusion is not an immutability claim. A common SQL source builder prevents
snapshot/CAS drift. Final policy comes from the locked Test, not another query.

## Transaction and resource contract

Acquire the matching Test lifecycle advisory try-lock before the Classroom
operation try-fence and Class/Test/draft NOWAIT row locks. Bind the original parent,
never follow a moved Test. Before draft DML, lock the existing archive-revision row
NOWAIT: legacy draft triggers can otherwise introduce a same-Class lock inversion,
including writes to another draft. Use the genuine lifecycle guard, not a bypass.
Authored question changes are parent-fenced; cache-only changes remain compatible.
No question tuple or Storage-protocol locks are introduced.

Residual lock waits are bounded. Contention, unique races and changed source fail
409 without automatic retries. Deadline, size, malformed-result, schema and
postcondition failures fail503. Lost ownership/archive fails403; initial missing
Test fails404; final deletion/reparenting fails409. Any failed write postcondition
rolls back the entire RPC. Create/repair must verify actual stored stamps/version
and natural Class/archive revision effects; inspection must remain write-free.
Reject a future prior repair stamp before DML in the final transaction; preserve
future historical stamps for no-write inspection. Only explicit PT403 and the
two current lifecycle-fence messages mean caller denial. Raw42501 grant outages
and unrelated55000 object-state faults remain unavailable, not owner denials.

At most two lazy SDK RPCs share a20-second application deadline and cancellation
signal. Source has at most10000 complete questions,2MiB draft/candidate content,
8MiB source/success envelopes and64MiB cumulative recursive JSON budget. SQL checks
collection counts and bytes before aggregation, and checks its finite phase clock
and absolute deadline before and after DML/triggers and before return. A function
setting alone is not proof that PostgreSQL reschedules the outer PostgREST
statement timeout; actual cancellation requires separate runtime evidence.

Public entrypoints use SECURITY DEFINER, empty search_path and qualified names;
PUBLIC/anon/authenticated cannot execute them. Only service_role may invoke the
entrypoints; their private helper is not directly executable by those roles or
service_role. Actor identity is trusted server input, not auth.uid or client claims.

## Acceptance still required

Source TDD and route regressions must cover both global-role owners, owner/member
precedence, member/outsider denial, unchanged legacy/PATCH dispatch, malformed
admission, retirement, lifecycle/content compatibility, strict source/response
decoding, complete collections, byte/deadline bounds and no contextual fallback.

Real disposable database contracts must verify privileges, transactional source
CAS, ownership/reparenting/archive races, no-write inspection, insert/repair stamps
and trigger revision deltas, postcondition rollback and finite mixed-writer
contention. Test contextual writers, legacy same/other-draft writers, existing
save/publish/Start and archive/purge fences. Offline mocks do not establish these.

A separately frozen fixture and transport manifest must be independently reviewed
and explicitly accepted before native execution. Reuse the sealed Assignment
lifecycle, original fixtures/revocations/restoration, fresh complete Docker closure,
control guards, exact owned teardown and unchanged canonical baseline. Normal
actual-SDK and both full-setup forced-cleanup runs are required. No shared database
reset/reseed or migration application is a shortcut to this proof. Generate RPC
contracts genuinely from the reviewed isolated schema, never hand-edit generated
types. Finish focused checks, risk-matched independent review and exact-head CI
before a normal main merge. This component does not exit the assessment phase or
authorize production promotion, account/provider/billing changes or rollout.

## Initial source checkpoint (historical)

The application assignment delivered156 passing tests across6 affected suites,
scoped lint and diff checks. Root verified literal source parity for the legacy
GET remainder, PATCH and TEST_DRAFT_CONFIG. The only reported TypeScript errors
are the two new RPC names awaiting genuinely generated schema contracts; no
typing workaround is included. Source/offline evidence is not database, actual
SDK or concurrency proof. SQL source checks11, native-adapter protocol checks11,
proof checks98, type-generation checks12 and CI workflow checks59 pass in their
separate affected runs; these overlapping suites are not a claimed aggregate.
The generation preparation first used substring config checks; an offline test
failed on comment-assisted retargeting. It now requires exact sealed config parity,
with12 checks green. No generator command or database operation has run.

## Finite source-prepared proof

The new extension union, excluding the unchanged original Assignment fixture,
has7 actors,5 Classrooms,16 Tests,1009 persisted questions,10 initial drafts,
5 enrollments/generations,15 naturally generated categories and5 archive revisions.
The app portion has15 helper/SDK cases, including complete1001-question source,
both global-role owners, three exact creates and one repair. Its2060 UUIDs and the
SQL fixture's10016 reserved UUIDs are disjoint from each other and the original
fixture. SQL's10001 bulk UUIDs are rollback-only; they are not initial setup rows.

The app extension SQL ceiling is512KiB (setup328192 bytes); at most30 RPCs, two per
case, with zero Storage calls. This finite proof expansion does not increase the
application20-second deadline or alter any sealed original SQL/transport limit.
One separate normal-only privilege-drift probe temporarily revokes only the exact
snapshot entrypoint's service-role EXECUTE grant in the synthetic project. The
real installed SDK/helper must observe raw42501 and return503 after one RPC;
there are25 RPCs total, still below the unchanged30 ceiling. Restoration in
finally must prove the full sorted ACL, owner, function identity/definition and
app/SQL whole-row equality, even on probe failure. No general SQL or grant control
is exposed, and unconfirmed restoration fails the proof and requires exact owned
project disposal. This is prepared source, not a completed live privilege test.
SQL source prepares two rollback phases and12 real two-session schedules, including
legacy insert, same/other draft tuple/revision order, save, publish, Start and
archive/ownership/reparenting/purge fences. Stale-source and UTF-8/count bounds,
suppressed/altered write rollback, and an AFTER-trigger deadline test are prepared.
A rollback-only sealed sequence increment must prove that trigger was reached;
an already-expired input is not equivalent evidence.

The native adapter's finite ceiling is two persistent owned sessions,200 actions,
4000 control calls,15 minutes,8MiB per response and64MiB cumulative output. Each
action rechecks clean reviewed source, full migration hashes, captured Unix socket,
complete fresh resource closure and original private guards. Termination is fixed
SQL bound to captured backend PID/start, reserved name, database and user; local
child exit alone is insufficient. These are source-prepared capabilities, not
proven runtime timings or cancellation. Unconfirmed termination requires exact
owned project disposal and a failed proof, not success.

Both forced modes must complete the app and SQL extension setups before the
original failure checkpoint. Normal execution requires app/helper RPC cases,
rollback contracts and all schedules, unchanged fixture and unrelated-row
fingerprints, inherited revocations/restoration, exact teardown and unchanged
canonical state. Full-schema persisted drafts retain migration134's required
identity marker; unmarked legacy-ID compatibility is offline helper coverage,
not falsely claimed native evidence. The optional normal-only `--generate-types`
step invokes the fixed local CLI generator after the matrix, writes only a private
wx0600 artifact, and requires identical fresh resource closure afterward. Root
must verify the artifact after successful lifecycle completion before installing
generated source. Default CI does not run that optional generation command.

The initial independent fixed-source review of draft PR1473 at `c90d3981`
completed with three accepted blockers: future-stamped repair could commit before
the helper rejected its result; raw privilege failures and unrelated object-state
errors could be mislabeled as caller denial; and Test-move fixtures violated the
existing gradebook-category parent constraint. These are a single remediation
batch, followed by targeted independent review. Root's finite runtime acceptance
remains pending.
None of these prepared counts, templates or mocked protocol tests establish actual
database/SDK/concurrency/cleanup/cancellation evidence or authorize a main merge.

Initial full-classified focused run:373 tests/17 files, architecture, UI and design
policies PASS; TypeScript then failed solely on the two pending new RPC names.
The focused command is not green and did not reach its lint step. Separate scoped
lint receipts and the15-file Pika audit pass. A draft source checkpoint remains
incomplete; no ready event, heavy CI, main merge or database execution is implied.

Batch1 focused verification:398 tests/17 files plus architecture/UI/design PASS.
TypeScript still fails solely on the two ungenerated RPC names; the focused
command remains EXIT1 and did not reach lint. The SQL source regressions are14
PASS and native-adapter protocol regressions20 PASS, without runtime claims.

Targeted review1 accepted the initial transaction/error/category fixes but blocked
native acceptance on application-row verification after a failed SDK probe. The
SQL adapter's restoration remains separate; an outer application finally now
compares its full preimage after every probe outcome. Offline failure/drift
regressions cover this boundary; live proof and re-review remain pending.
Batch2 focused verification:400 tests/17 files and architecture/UI/design PASS;
EXIT1 still solely the two pending generated RPC types. Scoped lint/audit PASS.

First normal live attempt at reviewed `d6dfb537` failed before any SDK request.
No type artifact was accepted. No synthetic project containers remained and the
same saved canonical public/private/Storage/metadata/settings/cron/resource
baseline matched afterward; it was not recaptured. Source diagnosis identified
an incorrect fixture-only revision expectation: migration112 does not blueprint
touch a questions_locked_at-only Test update, while the archive trigger adds one.
Class A must expect archive2058/blueprint1026, not2059/1027. The correction changes
only expected counters, never persisted counters or trigger/guard behavior.
Closed setup stage/kind diagnostics now separate app write/snapshot/verification
and SQL preparation/setup without printing errors, SQL, identities or credentials.
Live acceptance remains failed/pending until the corrected source is reviewed
and a new bounded proof actually passes. Offline regression proof is not a retry.
Root also found the restoration SQL snapshot used the fixture session name,
which its unchanged contract guard rejects. Only that fixed snapshot control now
uses the already-approved draft-contracts name; catalog/grant controls retain the
fixture name. A failing command-binding regression verifies the correction;
the guard and native capability ceilings are not widened.
Batch3 affected checks:124 PASS/2 files. A full focused run hit the unchanged
five-second offline protocol timeout while lint ran concurrently; the failure
was retained. The unoverlapped retry passed403 tests/17 files plus architecture,
UI and design. TypeScript still fails only on the two ungenerated RPC names;
the overall focused gate remains EXIT1. No timeout/cap increase was used.

## Docker recovery and runtime checkpoint

The corrected80aa source passed its targeted source review. Its first live run
reached guarded SDK calls but failed while Docker container/volume inventory
stalled. Cleanup and baseline verification could not then be claimed. After the
owner authorized Docker Desktop restart, root verified the SAME saved canonical
baseline, validated the eight exact abandoned proof resources against their
known identities, labels, creation window, attachments, ports and copied247
schema/config, and removed only those synthetic resources. Unknown volumes and
other projects were preserved; copied-source evidence directories were retained.

Normal80aa proof after recovery exited0 with exactly two PASS lines and empty
stderr:15 actual installed-SDK cases including complete1001-source, exact restored
42501 privilege probe, rollback SQL contracts,12 two-session schedules, inherited
Assignment cases/restoration, exact teardown and unchanged canonical baseline.
After-fixture mode exited1 with only its intentional failure and cleanup PASS;
the same baseline matched afterward. These successes do not erase earlier failures.

Genuine isolated CLI generation from that normal run produced only the two new
RPC contracts. Artifact SHA-256:
`82a6c12f2964ed93998047175698a792722e19cf911b1feb1173ba37e95f94ca`.
The exact generated output is installed without manual typing edits. Public
schema generation did not alter either shared-local or production schema.

Before-capture mode remains unaccepted. A platform-command failure before setup
left an owned stack; an instrumented bounded retry proved its54332 binding then
blocked a fresh launch. Exact resource recovery and SAMEbaseline checks passed,
but the next clean retry again failed before setup. There are no synthetic
containers remaining after that attempt. Do not retry blindly or claim forced
cleanup from canonical equality alone. Closed diagnostics now retain the inherited
lifecycle-stage enum and cleanup-present/none/unknown state without raw errors,
SQL, credentials or row/resource identities. This is diagnostic-only preparation;
the genuine final before-capture cleanup, final review and CI gates still apply.
