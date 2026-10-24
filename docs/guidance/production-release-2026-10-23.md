# Editor production rollout — 2026-10-23 (Toronto)

The owner authorized production migration 291 and the normal protected editor
release. The one-time migration permission is consumed by the successful apply.
Another apply attempt or another migration needs fresh exact-target permission.

## Database receipt

Reviewed merged SQL source: `61d9265b7e7adf181bea29d57bd62120f839df87`.
[Full CI 39995508676](https://github.com/codepetca/pika/actions/runs/39995508676)
passed replay, tests and PR Gate for the identical complete Supabase tree.
[Preview 40003769768](https://github.com/codepetca/pika/actions/runs/40003769768)
matched the complete pending set, only `291_teacher_authoring_images.sql`,
against production history 001–290. Its SHA-256 is
`016ae0051081bf1c16aa985c168f75db4aae273b41c870949f06255ba994bbf3`.
The approval digest is
`6dcc8006c750d3c5d7a75db5410f703e4b76d6e524c3e6ea6ae32959116be06a`.

The single [apply 40004531458](https://github.com/codepetca/pika/actions/runs/40004531458)
returned **applied-verified**, installing 291 and verifying complete ordered
001–291 history. No retry, history repair, seed, reset or production fixture
write occurred. The existing `test-documents` bucket remains private.

Read-only checks verified three installed function bodies against the reviewed
SQL, postgres ownership, exact invoker/definer and empty-search-path metadata,
and execution ACLs. The two internal trigger functions are postgres-only;
the existing invoker predicate retains its previous execution grants.

| Function | Installed body MD5 |
| --- | --- |
| `managed_storage_object_is_referenced` | `1fe0a7daed9782ac2b38f541fc6010ff` |
| `sync_teacher_authoring_image_references` | `44924f909c004d858e0ff2058334074e` |
| `queue_removed_teacher_authoring_image` | `fa9ba373a241ef8467a490dedcdda57e` |

The new ledger has RLS, service-role SELECT only, two indexes, validated owner
and identity constraints, and the deferred cleanup constraint trigger. All seven
source triggers and the deferred cleanup trigger are enabled. Existing managed
storage RLS, ACLs, six triggers and nineteen unaffected constraints match the
pre-apply snapshot. The purpose check adds only `teacher_authoring_image`; its
identity constraint requires classroom-bound private raster images of 1–2,097,152
bytes. The ledger was empty immediately after installation.

## Application release

The release includes the approved compact assignment, material, test and survey
editors, consistent Write/Markdown controls and modal close placement. Markdown
remains authoritative and inline authoring images have a 2 MB limit.

Release review found that valid uppercase UUIDs in Markdown image URLs could
be saved but denied to students. [PR #1668](https://github.com/codepetca/pika/pull/1668)
corrected UUID matching across all four surfaces while preserving literal route
and query names, identity boundaries, publication timing and membership checks.
Its reviewed `f316bf7da0d6eda88da88f3331a9c61137fa549f` source merged normally
as `b03198a9f80a74282d8027b15775f83ad58ca935` with an identical tree.
[CI 40005530698](https://github.com/codepetca/pika/actions/runs/40005530698)
passed all selected checks and PR Gate: 21,534 tests passed, with eight expected
skips; TypeScript, lint, build, both database and both SDK lanes passed.
Browser jobs were unselected for this server-only correction.

[Promotion PR #1667](https://github.com/codepetca/pika/pull/1667) has stable
reviewed head `3208858a57a941987e137b91464197300ed30504`. Application, tests,
SQL, dependency and CI configuration bytes match corrected main. Only the two
continuity journals differ, preserving entries from both parents. Both required
local focused gates pass 1,012 tests across 75 files, plus architecture,
TypeScript and lint. Four independent release review turns completed with the
single accepted blocker resolved. Attributable active time and tokens are unknown.

[Production CI 40006108276](https://github.com/codepetca/pika/actions/runs/40006108276)
passed all ten checks on that reviewed head, including PR Gate. The full suite
passed 21,534 tests with eight expected skips. Light browser contracts passed
315 cases, with four additional cases passing on retry and seven skipped;
dark contracts passed 199 cases with nine skipped. Default retries and
assertions were unchanged.

The normal protected production merge completed at 2026-10-23T19:24:39Z
(15:24 Toronto), producing `cd7179e646b1dcda8efa710ad06934c0bbbaf8d1`.
Its tree `f5e1a7c90d09d89932b6f6ed46134e3ac094d6da` exactly matches the
reviewed release candidate. No bypass or automatic merge was enabled.

Vercel deployment `dpl_8GRTVHmoMdx9mdETNWAUx2dcgsZa` is **READY** at that
exact production SHA. READY at 2026-10-23T19:31:21.772Z (15:31 Toronto).
Both deployment source metadata and the independently resolved public
`https://pika.codepet.ca` alias were verified. GitHub Production deployment
7287021075 records success.

Post-deployment public GET smoke passed: `/`200, `/login`200,
`/api/auth/me`401, `/pattern-lab`404 and an unauthenticated protected authoring
image request401. The new image route therefore remains authenticated.

No Home migration 292, admission/page/home activation, provider calls, account,
plan, billing or cleanup activation changes are part of this release. No
authenticated production mutation canary is included.
