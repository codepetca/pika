# Inactive classroom Home foundation release — 2026-10-23–24 (Toronto)

The owner explicitly approved migration 292 in local and production, followed by
the reviewed-main release with activation off. The two one-time migration
permissions were consumed by successful applications; neither authorizes a retry,
another migration, fixture writes, resets, seeds or activation.

## Database receipt

Merged source: `3c1be2d399bcc7cd938afbccbe53c7a232baacbd`.
[CI 40046596601](https://github.com/codepetca/pika/actions/runs/40046596601)
passed all ten selected jobs, including real database/SDK/browser lanes,
Test & Build and PR Gate. The rollout verifier accepted its complete Supabase
tree and current tooling as compatible with the merged source.

[Preview 40059060682](https://github.com/codepetca/pika/actions/runs/40059060682)
matched production history 001–291 and only
`292_classroom_home_visibility.sql`. Reviewed SQL SHA-256:
`3d5d47d92c0750f2a58e71bd0390653a98bbe0d67a49a450d46c2183837f349d`.
Bound approval digest:
`84b3ab5409f3a3763495156dfe3148e25ece3cc44a42ad88de6cbd19acbf3b98`.

The single [apply 40059138246](https://github.com/codepetca/pika/actions/runs/40059138246)
returned **applied-verified** at 2026-10-24T03:39:17Z (23:39 Toronto, October 23),
verifying complete ordered 001–292 history. Local CLI 2.103.0 also previewed only
292 and applied it once with explicit `--local`; local history is contiguous
001–292. No other migration writer was observed during production preflight.

Separate read-only checks on both targets verified postgres ownership, private
table RLS and postgres-only direct ACLs, a validated enrollment primary key and
foreign key with DELETE CASCADE, and zero initial hidden preferences. Both RPCs
are postgres-owned definers with empty search path, one-second lock timeout,
eight-second statement timeout and only postgres/service-role EXECUTE; anonymous
and authenticated execution is denied. Installed function bodies match source:

| RPC | Body MD5 |
| --- | --- |
| `read_classroom_home_visibility_v1` | `7bec391c7c6d891b036cf9c090d5e728` |
| `set_classroom_home_visibility_v1` | `913113dfe13a94ed89350d6f683cdda2` |

No production fixtures, live-provider calls or data cleanup were used.

## Application release

[Promotion #1673](https://github.com/codepetca/pika/pull/1673) prepares reviewed
main `3c1be2d399bcc7cd938afbccbe53c7a232baacbd`. Frozen promotion head
`76998e0c21ce984ba0a47872ddc7b6e1cd41a138` incorporates production history;
only the two continuity journals differ from main. All application, SQL,
dependency and configuration bytes remain identical. Both parent histories and
archive markers were preserved, and the rolling journal passes 40/60.

Cumulative independent security review 464 and compatibility review 465 are
clean; targeted journal integration review 466 is clean. Requested reviewer
configuration was GPT-6.1 Sol/high; effective settings and tokens are unknown.
Full local release checks passed 4,738 tests in 151 suites plus architecture,
UI/design policy, TypeScript and lint. Final journal-only checks passed 1,022
tests in 73 suites. Previously accepted signed-in mixed-role Home and native
292 proofs apply to the unchanged source; no redundant rehearsal was run.

[Final CI 40059627420](https://github.com/codepetca/pika/actions/runs/40059627420)
passed all ten jobs on that exact reviewed head, including PR Gate. The observed
run lasted 38 minutes 22 seconds; no duplicate dispatch or gate bypass was used.
The draft-skipped run is not acceptance evidence. Fresh head/base, review-thread,
rules and production-configuration checks passed before the normal protected
merge at 2026-10-24T04:24:47Z (00:24 Toronto), producing
`4778514b0a4de839f55459d7255fa91e305bd1bb`. Its tree
`1eda2e3c521a13d716415b3d7b6c50728e2a0f7c` exactly matches the reviewed candidate.
No administrator bypass or repository auto-merge was enabled.

Vercel deployment `dpl_DHbxckpbMDrojHGw6uD5ZePPpS54` is **READY** at that exact
production SHA as of 2026-10-24T04:28:09.035Z (00:28 Toronto). The independently
resolved `https://pika.codepet.ca` alias points to the same READY production
deployment. GitHub Production deployment 7293997104 records success.

Six read-only unauthenticated public checks passed: `/` returns the source-defined
307 redirect to `/login`, `/login`200, `/api/auth/me`401, `/pattern-lab`404,
protected authoring-image GET401 and learner-notifications GET401. An initial
smoke incorrectly expected a non-followed root GET200; source inspection confirmed
the existing `/login` redirect, and the exact redirect/status checks then passed.
No application fix or assertion about authenticated production journeys is implied.
Final read-only production history/body checks still match 292 with no hidden
preferences. No fixture write, live-provider call or activation was performed.

## Holds and remaining acceptance

Read-only production configuration inspection found Home, Home cohort,
classroom page, page pairs and shared experience admission settings absent.
Existing 24 provider/control metadata records are unchanged before application,
before merge and after the live release. No environment settings were written.
Therefore this is an **inactive** foundation release, not activation: users do not
yet receive the new Teaching/Joined Home.

The compatible recovery candidate is this application payload plus schema 292.
Before a separately authorized pilot/expansion, finish the composed operational
growth-freeze/recovery check, establish canary baselines and stop thresholds,
and name an operator. Preserve admitted users and their access during recovery;
do not use an older teacher-only build after mixed-role activation. Live Bara/Pal
readiness remains separate: SQL, SDK and mocked seams do not prove live provider
compatibility. Readmission policy changes are deferred; existing final-removal
behavior remains unchanged. Account, plan, billing, provider and activation
holds remain in force. The overall cutover goal is not complete.

Recovery preparation and the unactivated pilot decision sheet are tracked in
[Home pilot readiness](classroom-home-pilot-readiness.md); its evidence labels
distinguish isolated SQL, synthetic adapter tests and actual production canaries.
