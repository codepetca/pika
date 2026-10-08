# Shared class-day reads

Dormant batch-1 consolidation covers only `GET` on
`/api/classrooms/[classroomId]/class-days` and compatibility
`/api/teacher/class-days?classroom_id=…`. Both consume the existing server-owned
[complete-experience admission](classroom-experience-admission.md). There is no
new schema, subscription decision, UI, or rollout activation.

Authentication precedes strict admission parsing and shared request input. UUID
identities are normalized; the compatibility query rejects missing, duplicate
or unexpected parameters. Absent or unmatched admission retains the complete
existing GET behavior, including classroom-core exact-pair handling. Shared
errors never fall back to a less-bound legacy query.

The current owner may read archived classrooms and takes precedence over an
enrollment. A non-owner needs a current enrollment and an unarchived classroom.
Either global account role can have either relationship; outsiders and removed
members are denied. A narrow preflight distinguishes missing classrooms and
denied relationships but does not authorize the payload.

Every payload statement selects the requested classroom with its current owner
or active member relationship. Named foreign keys embed class days and member
identity. Each returned parent, day and membership is independently validated.
The terminal empty page also proves the relationship, so transfer, removal,
archive or deletion cannot turn an unauthorized remainder into a successful
partial response. These are statement-time guarantees, not a whole-list atomic
snapshot or post-statement revocation promise.

The output is unchanged: `{ class_days }`, ordered by date then ID and containing
only `id`, `classroom_id`, `date`, `is_class_day` and `prompt_text`. Composite
date/ID keysets fetch at most 1,000 children per statement without offset or
row-cap truncation. Duplicated dates/IDs, out-of-order cursors, foreign identity,
invalid dates, malformed cardinality/envelopes and SDK errors fail closed with
generic 503 responses. Owner and membership evidence is not returned to clients.

## Verification and scope boundary

TDD captured initial failures and follow-up malformed-envelope/duplicate-query
failures. 97 new tests and 218 existing class-day/core/calendar tests pass, with
TypeScript, scoped lint, architecture and diff checks. The installed-SDK fake
fetch checks actual serialized nested filters, ordering and composite cursors.
The complete focused gate passed 555 tests across 25 files plus all static/lint
checks. A five-character startup-context budget overrun after receipt updates
was corrected by shortening only continuity text, not weakening the budget test.

The separate `scripts/check-contextual-class-day-read.ts` actual local-SDK proof
is bound to the Pika Docker project and local API. Its normal run on 2026-10-03
passed both global-role owners/members, enrolled-owner precedence, 1,005 valid
days, short pages, empty/archive/removed policy, current-relationship loss before
first/later/terminal statements, and malformed actual-array wire responses.
Synthetic fixtures are invocation-specific and the harness checks exact residual
absence plus global table counts. The forced post-fixture cleanup run and final
focused/review/CI acceptance are recorded separately before merge. The forced
run exited with its expected error and exact zero-residual/global-baseline
sentinel. A controlled CLI failure also verified that captured credential-bearing
status output cannot enter the log; that failure occurs before any fixtures.

`POST`/`PATCH` on both URLs are byte-identical and retain their existing legacy
and exact-pair admission. Shared writes still need consolidation onto the
[existing migration-152 calendar boundary](contextual-calendar-writes.md).
This read slice alone does not make the entire calendar/Daily experience or
five-batch cutover ready. Shared admission remains OFF.
