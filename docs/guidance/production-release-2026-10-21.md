# Production release and migrations — 2026-10-21 (Toronto)

The owner approved deployment of PR1654 and one exact production application of
migrations285–288, explicitly acknowledging permanent Pal queue stopping and
expanded cleanup eligibility, including possible provider erasure and academic/file
deletion for eligible removed teacher-labelled learners. That one-time approval is
consumed. Future applications and all activation/provider canaries retain their
separate authority gates.

## Database receipt

Target: production. Reviewed merged SQL source:
`86633c561e705cadbff60e30731b5d857961f001`.
[Preview39699999718](https://github.com/codepetca/pika/actions/runs/39699999718)
verified the exact pending set against successful full CI39668023820 and the
complete Supabase tree. Digest:
`d3d96ac8495afe027f78d44af16c55a4260745b7bf8f6e69fe1980bcf0fd4523`.
The single [apply39705435520](https://github.com/codepetca/pika/actions/runs/39705435520)
returned **applied-verified**, installing285,286,287,288 and verifying the complete
ordered001–288 history. No retry, history repair or fixture write occurred.

| Migration | Installed behavior |
| --- | --- |
|285 attendance membership adoption|Locked current-generation participant allocation and private transaction capabilities; no installation pointer rotation.|
|286 attendance learner membership|Current-membership reads and owner overrides with immutable generation provenance; no historical attribution backfill.|
|287 Pal owner queue stop|Durable owner-transition marker and immediate pending-owner queue disposition; known acknowledged processing deliveries can settle.|
|288 contextual removed-membership cleanup|Relationship-based LIVE cleanup reservation and roster fence for either account label; current owners remain excluded.|

All18 read-only query groups passed:39 exact function bodies, owner/security/config
metadata and effective API ACLs; private capability RLS, no direct application grants,
validated keys and zero committed capabilities; the new nullable timestamp, valid
index and enabled owner-transition trigger; unchanged six public-table ACL/RLS
records; exact history, controls/cutoff and queue guards. Delivered Pal history
remained equal. No current-owner queue, nonterminal cleanup job or eligible
teacher-labelled removed candidate existed at verification. This is database
contract evidence, not a live provider-erasure or positive concurrency canary.

Pal membership/signals, quotas and billing remain OFF; shared admission remains
absent from the production environment. Existing provider/live/automatic/academic
cleanup controls remain ON. Migration288 therefore immediately broadens the
existing automatic pipeline's eligibility; shared admission does not gate it.
Existing cutoff, retained generation/binding/receipt/rejoin guards and current-owner
exclusion remain. Grouped-removal restrictions164/236 remain installed; strict171
reservation and its student-role prerequisite remain unchanged.
No feature flag, cohort, account, environment or billing setting was changed.

## Application release

[PR1658](https://github.com/codepetca/pika/pull/1658) promotes reviewed main86633c561.
Two independent GPT-6.1 Sol/high security/SQL and compatibility reviews completed
with no actionable findings or coverage gaps at candidate
`79eca9c181af619b427ca2a1ae11b011d946e608`. Only the two journals differ from main;
both parents' entries remain preserved. Focused892 tests across70 files passed.
All10 exact-head CI/PR Gate jobs passed in
[39700764872](https://github.com/codepetca/pika/actions/runs/39700764872), with2207s
run time and0s observed queue time. Per-review tokens and active time are unknown.

Normal protected merge completed2026-10-22T01:25:46Z (Oct21 21:25Toronto), producing
production `81a675a41938e26f492e857c2048f88759fee981` with the reviewed tree.
Vercel deployment `dpl_3hFiCNCQrX2KGrGCSwSWZNM8LhUu` is READY at the exact
production SHA, with `https://pika.codepet.ca` assigned to it. GitHub production
deployment7241400829 records success at2026-10-22T01:28:53Z (Oct21 21:28Toronto).
Postdeployment public GETs passed: `/`200, `/login`200, `/api/auth/me`401,
`/pattern-lab`404. No authenticated user or provider canary is claimed.
