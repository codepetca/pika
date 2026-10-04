# Contextual Assignment list reads

Status: source and offline verification only; actual isolated runtime proof,
independent reviews, reviewed-main merge and production rollout remain gates.
Risk: runtime-platform (authorization, privacy, query compatibility).

This batch-2 slice extends the existing teacher/student GET adapters through the
single complete-experience admission contract. Present configuration authenticates
before decoding configuration or inspecting request parameters. Unadmitted actors
retain the old exact-pair/legacy decision. Legacy list bodies and POST writes are
unchanged. No admission, page, home, provider, billing or AI activation is included.

## Statement-bound reads

Every payload statement is rooted in the requested classroom and proves its
current owner, or current active nonowner membership with an unarchived classroom
and unchanged Classwork visibility. The final empty control read also proves that
relationship. Global account-role labels do not grant classroom authority.
Preflight selects only classroom control fields, never assignment/document data.

Explicit columns and strict response schemas reject uncertain responses, duplicate
identities, incomplete parents, stalled cursors and overflow. Assignments and
enrollments use1000-row keyset pages; child collections use50-parent batches and
100-row child pages with the smallest nonempty child tail as their common cursor.
No partial/truncated result is returned. Bounds:10000 rows per collection,
1024 statements,20 seconds and8MiB response/statement DTO size; overflow returns503.

Owner statistics join each document's current nonowner enrollment inside the
payload statement. Members receive only their own documents. Base member fields
exclude grades, feedback, authenticity and private AI metadata. Separate grade
and feedback projections require current return/release markers and match the
base document's exact identity and release timestamps; withdrawals invalidate the
whole response. Draft/future assignments are excluded using one captured clock.
Existing instruction, status, statistics and learner-sanitization helpers remain.

This is statement-current authorization, not one atomic whole-response snapshot.
Assignment detail/open supplements, Tests, Surveys, Gradebook and grading-entrypoint
integration remain separate batch-2 work. This slice alone does not permit cutover.

## Proof safety

Offline tests exercise nested authority predicates, pagination, malformed responses,
privacy and admission order. Real fixture execution requires a clean exact reviewed
head. The disposable project is `pika_assignment_list_<12hex>`, API54331/DB54332,
with a matching private temporary workdir; normal Pika54321/54322 is read-only.
Replay only the reviewed immutable001–239 source, without seed, shared env files,
history repair or canonical reset. This requires the239 consumer slice to merge
before final main integration/runtime acceptance.

The fixture creates1004 assignments,1001 current nonowner classroom members,
1001 requirements and1002 documents, including returned zero grades. Nine SDK
cases cover both account-role labels, one actor teaching A/joining B, owner
precedence, outsiders, archive and hidden Classwork. Fourteen committed transitions
revoke owner/membership/archive/visibility authority at first/later/terminal pages,
or withdraw returned grades/released feedback. No auth-cookie/browser, provider
HTTP or Storage-byte claim is made by these SDK tests.

Immutable168 guards stay enabled. Membership restoration allocates a fresh
preallocated generation; removed generations are never deleted or reactivated.
Only enumerated fixture bookkeeping and exact generation transitions may differ
after semantic restoration; all nontarget rows must match. Pal/provider/automatic
cleanup gates remain OFF. The two installed cron watchdogs are allowed only with
their exact known commands, no grading work and no Vault secrets, so no network
callback is possible. Unknown active jobs fail closed; no scheduler is changed.

Normal and forced-after-fixture/before-capture modes must capture exact fresh
containers/network/volumes even after ambiguous startup. Cleanup refuses preexisting
IDs, either wrong project label, foreign attachments or unknown resources. Only
the complete closed eight-resource footprint permits exact-project CLI stop;
partial startup uses exact captured IDs. No broad prune or existing-project stop.
All ephemeral resources and the generated workdir must be absent afterward, and
canonical public/private/storage row digests,168 metadata, settings, cron and
resource identities must match byte-for-byte. Failure/cleanup uncertainty is not
reported as success. Runtime execution is still pending.
