# Production release and post-date migrations — 2026-10-22 (Toronto)

The owner authorized one production application of migrations 289/290, then the
protected main-to-production merge after all selected checks pass. Migration
approval was consumed by the single successful apply; future applications or
retries require fresh exact-target authorization.

## Database receipt

Reviewed merged source: `48cee796944c59933361f3faa543edaea4e36140`. Full
CI 39836337744 passed all ten selected checks; its tested cba9867 tree equals the
source tree. [Preview 39862341945](https://github.com/codepetca/pika/actions/runs/39862341945)
matched the complete pending set 289, 290 against 001–288 history. Digest:
`478228949b74141683f24ccfa45c4673bb5803a7bed73cf79467c852b4adab18`.
The single [apply 39862570602](https://github.com/codepetca/pika/actions/runs/39862570602)
returned **applied-verified**, installing 289/290 and verifying ordered 001–290.
No retry, fixture write, history repair, seed or reset occurred.

| Migration | SHA-256 | Installed behavior |
| --- | --- | --- |
| 289 material post date|`15937346a18e991f01f6f2be9f4f89d0fdb43d0e12540cd4d8142f25d7f9c86e`|Extends the existing owner JSON patch to move a published material to Toronto midnight of today or an earlier day.|
| 290 announcement post date|`bea690465695fab90539731d06fd0fb47b61cb3103ac398e21495865073db643`|Extends the announcement owner patch, stores Toronto midnight and clears an explicit date edit's historical schedule.|

Read-only catalog verification passed exact installed function bodies, postgres
ownership, security-definer/empty-search-path metadata, JSONB signatures and
service-only execute ACLs. Anonymous/authenticated/PUBLIC execution remains
revoked. Table RLS/ACLs, constraint definitions/validation and enabled triggers
match the pre-apply snapshot. Exact 001–290 history and winter/summer Toronto
midnight conversion passed. Function-body MD5s: material
`182ee0d661c032f7368a620c855ca784`; announcement
`5b8fb73eb0b65d0d668a93db4552b8ef`. No production post was edited for verification.

## Application release

[PR #1664](https://github.com/codepetca/pika/pull/1664) promoted reviewed main
`48cee796944c59933361f3faa543edaea4e36140`. Includes artifact native-focus
scrolling, settings motion, roster join dates, material/announcement Post date
controls and CI registry repair. Two independent Sol/high cumulative reviews
passed; one targeted journal-resolution review passed at
`580cea5377950f2d9781bdfa839c614186d9ca29`, all with no findings. Only the two
journals differ from main, preserving all parent entries; application and
Supabase files are identical. The focused gate passed 12,583 tests across 559 files, with 8 tests and 2
files skipped as expected; all static policies, TypeScript and lint passed.
Attributable active time/tokens are unknown.

All ten exact-head checks passed in [CI 39864745315](https://github.com/codepetca/pika/actions/runs/39864745315),
attempt 3. Failed-job retries resolved only ECR image-download limits and preserved
prior green results. The normal protected merge completed at 2026-10-22T23:31:01Z
(October 22, 19:31 Toronto), producing production
`a1b7c2a77a00bc7ce82e3e811ec90fef524fcbdb` with the exact reviewed tree
`96537b39e4a1fc46409b223e0f090f9fb74492ef`.

Post-migration public GET smoke passed: `/`200, `/login`200, `/api/auth/me`401,
`/pattern-lab`404. Vercel deployment
`dpl_A895Cc9p4Af36TatCkh37tz3EaxP` is **READY** at the exact production SHA;
`https://pika.codepet.ca` resolves to this deployment. Alias assignment and the
deployment's Git source SHA were verified independently. GitHub Production
deployment 7266322407 records success. READY at 2026-10-22T23:36:03.954Z
(October 22, 19:36 Toronto). Postdeployment public GETs passed the same four checks.
No authenticated mutation canary was run.

No admission, provider, quota, account, billing or cleanup activation settings
were changed by this release. No schedule was added.
