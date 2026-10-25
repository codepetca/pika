# Three-account Classroom Home pilot — 2026-10-24

Core Home signed-in canaries passed for the three dedicated accounts. This is
not overall cutover completion, provider readiness, or permission to expand.
The [readiness packet](classroom-home-pilot-readiness.md) retains the acceptance
and recovery requirements; the [bounded roadmap](classroom-access-and-entitlements-roadmap.md#owner-approved-completion-strategy--2026-10-09)
retains the goal and remaining integration gates.

## Exact release and retained configuration

The owner authorized only the dedicated reciprocal accounts A/B and unrelated
Control, including the compatible deployment. Production promotion #1679 merged
to `1da699fdccd5f4a78b5a0eba9dc326eb74a70a35`; its reviewed ready-head CI
`40128782362` passed. The public domain was verified READY at deployment
`dpl_6Yq3pHkcFZ6stHtGFj2Zuprq2BqS` with that exact source. Schema history is
001–292. No additional migration was applied for the pilot.

The fixed observation window was October24, 17:37:17–18:07:17 America/Toronto
(21:37:17–22:07:17Z). It established stable deployment/configuration and expected
unauthenticated responses. It did not establish signed-in workflow acceptance.
The owner-assisted signed-in checks below occurred afterward and are recorded
separately. No replacement observation window or expansion was silently started.

Final scoped read-only configuration check at October24 21:09:44 Toronto
(2026-10-25T01:09:44.566Z) confirmed the same exact deployment/source, all three
production admission/Home configuration records unchanged, independent page flags
absent, and the original 24 provider/control metadata records unchanged.

Retain the existing exact three-account admission and compatible Home routing.
Stop adding IDs; do not disable existing admission, delete pilot data, or revert
to a teacher-only build. No further deployment/configuration, plan change,
provider activation or cohort expansion is authorized by this receipt.

## Actual signed-in results

The owner completed normal sign-in for each account; the agent then drove the
existing UI. No authentication seed, cookie extraction or database fixture was
used to manufacture an authenticated browser session.

| Account / scenario | Observed production result |
| --- | --- |
| A creates | One synthetic classroom created through the ordinary wizard; its owner Daily view opened; fresh Home showed it under Teaching. |
| B joins A | Normal code join and synthetic identity form completed; learner Today opened; Home showed the classroom under Joined. |
| B hides / unhides A | Top-right menu > Edit exposed Hide. Hide survived reload; Hidden appeared below Archived with retained-membership text. Unhide restored Joined visibility after another reload. |
| B creates | One synthetic classroom created through the same wizard; fresh Home simultaneously showed Teaching B and Joined A. |
| A joins B | Reciprocal normal code join succeeded; learner Today opened; reload showed Teaching A and Joined B. |
| Mixed-role edit controls | B received Archive for its owned classroom and Hide for its joined classroom. No archive was submitted. |
| Member opens owner Settings URL | B was redirected to A's learner Today view; owner settings did not render. This is UI routing evidence, not a direct owner-API denial probe. |
| Free Control | Identity confirmed; Home and top-right menu offered Join but no Create/New Classroom option. No creation API request was attempted. |
| Control opens either classroom | Both an owner Daily URL and the other classroom's learner Today URL showed Classroom unavailable without rendering classroom content. |

Both synthetic terms are October26–30. For code-join verification, each owner
disabled roster-only joining only for their own otherwise-empty synthetic
classroom; allowing new joins remained on. Joining used synthetic names and no
student number. Control never joined either classroom and was not upgraded.
Screenshots of the resulting Home and denial states were captured and visually
inspected; these production captures do not replace the accepted isolated
desktop/mobile and theme matrix.

Final scoped read-only SQL confirmed A/B each owned one active classroom and had
exactly one reciprocal membership, no hidden rows remained, and Control owned
zero and joined zero. Plans remained Basic revision2 for A/B and Free revision1
for Control. All original global-role labels remained Student. None of the three
had attendance entitlements; both Pal membership/signal database switches were
false. The operator invoked no held provider action; these excluded service paths
do not establish provider readiness or observation of unrelated real teaching traffic.

## Reuse accepted evidence; close concrete gaps

| Area | Evidence retained | Remaining boundary |
| --- | --- | --- |
| Core Home | Actual production results above plus the accepted isolated real-cookie Home rehearsal | No new Home implementation/rehearsal needed solely for a newer timestamp. |
| Creation replay / managed disable / source recovery | Accepted isolated same-operation replay and layered SQL/application recovery in the readiness packet | Actual production replay and direct Free create-API rejection remain unverified. No deliberate production grant/ACL outage is authorized. |
| Assignment / Test / Survey / Gradebook | Accepted isolated [Assignment lifecycle](contextual-assignment-lifecycle-rehearsal.md), [Test](contextual-test-screen-adoption.md), [Survey](contextual-surveys.md) and [Gradebook](contextual-gradebook.md) evidence | One deployed synthetic submission → inspection → manual grade → Return → learner disclosure journey remains unverified. Home screenshots do not establish it. |
| Relationship and resource denials | Accepted isolated owner-as-learner, member-as-owner, nonmember and substituted-resource checks | Production direct API/resource-substitution negatives remain unverified. UI redirects alone do not prove those API contracts. |
| Removal / rejoin | Accepted isolated retained-removal, absent-membership, hidden-preference cleanup and blocked-rejoin evidence | Immediate readmission remains a deferred policy change, not a required successful-rejoin canary. |
| Lifecycle / compatible recovery | Accepted paired owner-label archive/purge HTTP proofs and committed-unarchive/export-postflight503 preservation, plus schema292-compatible recovery evidence | Do not reopen superseded lifecycle gaps. Layered SQL/application proofs are not a deployed browser/PostgREST outage drill. |
| Attached services | Existing relationship/generation/queue tests and exclusion controls | Bara/Pal/AI transport mocks and disabled pilot paths do not establish live-provider readiness. Live calls/configuration remain held. |

The operator retains detailed private evidence under the existing classroom-access
coordinator record: actual-start, observation-end, signed-in-canary and final
configuration receipts. Account IDs, emails, invitation codes, authentication
material and classroom content are intentionally absent from this public record.
Reuse isolated evidence only at its accepted runtime revision and after qualifying
later source interactions; a later docs commit or privacy-only release is not a
claim that its exact runtime was executed by an earlier rehearsal.

Next, close or explicitly resolve the concrete deployed acceptance gaps using
the existing three accounts, preserved evidence and established test clients.
Any applicable provider canary requires its separate readiness/authority. Expand
only after applicable canaries pass and a separate cohort decision is recorded.
Billing, broad global-role cleanup and long-term retention are separate work.
