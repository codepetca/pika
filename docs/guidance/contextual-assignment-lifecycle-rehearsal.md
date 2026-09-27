# Contextual Assignment lifecycle rehearsal

Run `bash scripts/rehearse-local-contextual-assignment-lifecycle.sh` from the
Pika worktree against the already-running local Supabase stack. This does not
apply migrations. The launcher obtains credentials from local Supabase status;
the test requires a loopback HTTP origin and the local demo service-role JWT.
Real requests are confined to that origin and reject redirects. Normal Vitest
invocations skip the suite unless the launcher acknowledgement is present.

The suite invokes actual route handlers with `NextRequest`, the real service
client and the real database. Only request-authentication plumbing is replaced
to select synthetic identities. It is not a browser, HTTP-server or session-cookie
test and does not prove the live classroom UI is ready.

## Behavior covered

- A teacher-classified account owns A and participates as a member of B.
- B's student-classified owner creates and releases an Assignment.
- B's member opens, saves and submits their own work.
- An owner with historical self-enrollment is denied the learner-open operation.
- An owner without enrollment is denied submission; an unrelated admitted actor
  is denied grading. These denials enter contextual authorization, not legacy fallback.
- The owner inspects and manually grades submitted work. The member cannot see
  saved draft grades or feedback until full return, then receives those values.

The fixture uses random identifiers, checks for collisions before setup, tracks
successful inserts and deletes only those exact synthetic records during teardown.
It verifies their absence afterward. Existing users and classrooms are not altered.
Pal delivery is disabled inside the test process, and the transport boundary also
prevents external requests. Shared environment files are unchanged.

## Current rollout finding

Against local schema through migration 213, the strengthened suite reports six
passing scenarios and one failing scenario: a self-enrolled owner receives 200
when opening learner work instead of 403. Migration 214 addresses ownership
precedence in the contextual learner transactions. Do not weaken the assertion or
remove the historical enrollment to make this case pass.

PR #1376 merged as `7758ed44` after independent review and complete CI
(`36344942279`). Its ephemeral database applied 214 and passed all seven route
scenarios plus the owner-precedence database harness. Production 214 was then
applied under exact authorization and verified through history and function
permissions. The shared local database instead has billing migrations using
214–216, so local application of this fix is blocked pending coordinated history
resolution. A local history row numbered 214 alone is not evidence this fix exists.

Inline-image database authorization and concurrency evidence remains in
`scripts/check-contextual-assignment-inline-images-database.sh`. Real image-byte
upload/finalize/delivery is not claimed by this route suite. The shared local
managed-storage cleanup worker cannot select one exact object, so an isolated
disposable rehearsal environment is needed for a byte round trip without touching
unrelated pending cleanup work. Keep that evidence separate from the full mixed-role
browser and production canaries required by the classroom-access roadmap.
