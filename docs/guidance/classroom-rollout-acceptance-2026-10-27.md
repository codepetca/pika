# Classroom rollout acceptance for the 70-account cohort

The authorized 70-account Classroom Home and complete-experience cohort is
accepted as of the October 27 readbacks below. The current release preserves
classroom relationships, plans and checked student work. This closes the bounded
cohort rollout and its PPZ observation requirement; broader admission, additional
provider activation and the overall classroom-access epic remain separate.

This receipt consolidates the [dedicated-account pilot](classroom-home-pilot-receipt-2026-10-24.md)
and the subsequent owner and learner expansions. The
[roadmap](classroom-access-and-entitlements-roadmap.md#owner-approved-completion-strategy--2026-10-09)
continues to govern wider rollout. No deployment or configuration change is
authorized by this documentation update.

## Accepted scope and release

| Account group | Added | Running total |
| --- | ---: | ---: |
| Dedicated reciprocal A/B accounts and unrelated Control | 3 | 3 |
| Existing classroom owner | 1 | 4 |
| Representative learner with memberships in all three selected classes | 1 | 5 |
| Remaining exact P3 ICS3C roster | 7 | 12 |
| Remaining exact P5 ICS3U roster | 27 | 39 |
| Remaining exact PPZ3C Online roster | 31 | 70 |

The private sealed rosters define the exact user and enrollment sets. Admission
is account-wide, not restricted to one classroom: the representative learner
retains three active and one archived membership. The expansion checks included
all bound active and archived memberships. They do not admit later joiners,
other accounts or Jason automatically. Ownership and current membership still
authorize each classroom/resource operation; admission does not grant ownership.

As observed on October 27:

- Runtime source: `405ef92cc1dead539e21d77a4193208b9166994d`.
- Canonical READY deployment: `dpl_66TQvffYKkF1AKDyqMuTQC1GyfU3`.
- Recorded production schema history: 001–293. No schema change accompanied these
  cohort expansions or the fresh observation.
- The existing complete-experience admission and Home user-list settings contain
  the same exact 70 accounts; Home remains enabled and independent page flags
  remain absent. Only the two approved account-list settings changed for each
  learner batch, followed by one compatible rebuild of the frozen release.
- Plans, global role labels, ownership, enrollments and classroom work were not
  rewritten by the expansion. The admitted roster additions were verified,
  WorkOS-linked Free accounts without owned classrooms, with creation disabled
  and quota zero at their qualification checkpoints.

The final exact 70-account value-map SHA256 is
`4f732e0f0c92be0c90a12e8e86b5b032d13ee60ea1d86c46abad730b1bfd9d79`.
Names, emails, account/enrollment IDs, invitation codes, authentication material
and classroom content remain outside this public receipt.

## Workflow and preservation acceptance

| Area | Accepted evidence and qualification |
| --- | --- |
| Mixed-role Home and entry | Dedicated-account production create, reciprocal code join, simultaneous Teaching/Joined, persisted hide/unhide, member/owner control separation and outsider denial passed. Direct API checks proved Free creation rejection, one creation with exact idempotent replay, and representative relationship/student-target denials. The original receipt retains the actual runtime revisions. |
| Manual Assignment grading | Dedicated-account save/submit, manual grading, Return, comment and learner feedback persistence passed after the separately approved compatible fixes. The seamless result is distinct from the earlier reload-dependent attempt. No AI grading was exercised. |
| Existing owner | Normal signed-in Home showed five active Teaching and five Archived classrooms, with existing Classwork readable. Pro-derived Create opened without submission or quota change. The owner also confirmed successful normal iPhone sign-in. |
| Existing learner in P3 and P5 | Normal isolated sign-in, Joined three/Teaching zero, Free creation-control absence, archived-member privacy, Classwork summaries and own Grades passed. Existing closed submitted Test detail remained read-only with results withheld; no attempt was started, recovered or submitted. |
| PPZ learner | The same normal learner session passed Home, archived-member privacy, the five-row Classwork summary and own Grades. Tests navigation was absent as configured. No Assignment document/editor, feedback link, Today/Daily or native-attendance surface was opened. |
| Full roster qualification | Exact P3, P5 and PPZ sets and their complete membership bindings were checked before expansion and at their final readbacks. Distinct archived memberships were covered by the unchanged source-qualified Home filter and archived-member denial contracts; this is not a new UI test by every affected learner. |
| Checked academic records | The representative learner's ten entries, nine Assignment documents, five Test responses, zero Survey responses and four enrollments retained identical whole-row hashes before/after canaries and across the fresh PPZ observation. These are selected-actor fingerprints, not a whole-database assertion. |
| Lifecycle, disclosure and compatible recovery | Reuse the accepted isolated Assignment/Test/Survey/Gradebook, resource-binding, lifecycle and schema-compatible recovery proofs referenced by the dedicated-account receipt, with the recorded later-source applicability reviews. No new production Survey mutation or deliberate production outage/rollback drill is claimed. |

The source-qualified review sequence for the expansions is retained privately:
Stewart 507/508, representative learner 511/512, P3 513/514, P5 515–517 and PPZ
518/519. Later source changes require a proportional interaction assessment;
these receipts do not attest an arbitrary future `main` revision. No personal
login or complete UI journey was performed for every one of the 70 accounts.

## Attendance and provider boundary

The separately authorized attendance recovery committed revision 3, superseded
four obsolete messages and created eight replacements. One normal delivery run
delivered all eight once. The later, separately authorized owner-membership run
delivered four rosters once. The final PPZ readback still showed revision 3,
the original eight replacements delivered, and no unresolved owner queue.
Earlier failed recovery/rotation attempts remain failed or spent; none was
replayed to obtain these results.

PPZ deliberately retains this different configuration:

| Setting | Accepted PPZ state |
| --- | --- |
| Tests | Off |
| Native attendance feature | Off |
| Native attendance policy and roster mapping | Neither exists |
| Native membership pointers | Absent, expected for this unconfigured domain |
| Existing manual attendance source mode | `log`, unchanged |

The frozen worker's policy/mapping target selection excludes PPZ. Its absent
native pointers are not a repair request or enabled-native acceptance. Existing
log-based attendance and separately authorized teaching automations remain in
place. No PPZ worker, provider probe, QR/check-in or attendance repair was run.

The 24 provider/control metadata rows use the accepted post-rotation baseline,
not the older pre-rotation hash. That baseline, the separately approved three
RepoLight metadata rows and all other production metadata were preserved across
the cohort checks. This does not establish general live-provider readiness.
Pal membership/signals and all other existing provider holds remain unchanged.
Billing, plan/account changes and further provider configuration/calls are not
authorized by this receipt.

## Observation and final readbacks

Each expansion had its own fixed window. The initial PPZ window on October 27,
06:47:16–07:17:16 America/Toronto, ended with passing initial and late final
checks but missing intermediate observations. Its receipt remains qualified;
it was not rewritten as an uninterrupted observation pass.

The owner then authorized a fresh read-only window, October 27,
**08:03:59.958–08:33:59.958 America/Toronto**
(`12:03:59.958–12:33:59.958Z`). One local timed observer recorded seven checks at
0, 5, 10, 15, 20, 25 and 30 minutes. Every check confirmed the same canonical
READY source/deployment and exact 57-row production metadata snapshot. Maximum
lateness was 9.787 seconds and maximum interval between completed checks was
307.594 seconds, within the declared 60-second lateness/360-second gap limits.
The final scheduled check completed at 08:34:09.745. This closes the fresh
periodic-coverage requirement; it is periodic sampling, not continuous telemetry.

Final scoped database reads at 08:35:41–08:35:42 and exact cohort-value readback
at 08:36:24 confirmed the same 70 accounts, PPZ roster/bindings and native-off
profile, unchanged checked academic fingerprints, revision 3, queue zero and
closed owner sessions with no active configured owner window at that readback.

| Final configuration evidence | SHA256 |
| --- | --- |
| All 57 normalized production metadata rows | `5b6348d1f67040505c33cad2d1956facfd0113a5c46e3b115684f776e818ca2c` |
| 24 provider/control metadata rows | `00e8ea1e8cffa75b99b9924850db5d96e04b17eb12f434c8ad6dc69b6c4c80ae` |
| Three separately approved RepoLight metadata rows | `9ff8ca8a4abf94fe18f2f3b758fcba9f82daffdf7a422b047993b68c37f7386c` |
| Three Home metadata rows | `2744c45967cca07243aca8a911c6ed104a5e140a2309d3a1db279734e7a0fee8` |

The timed process exited successfully, its watcher was deleted, and the final
receipt plus explicit coordination release was relayed through Audit to
RepoLight. The unrelated PPZ teaching automation was not changed. The exact 70
accounts and compatible routing remain admitted; there is no automatic removal,
rollback, observer renewal or additional expansion.

## Evidence references and remaining decisions

The private classroom-access coordinator record retains these packet families:

- `stewart-cohort-execution-20261026` and
  `s-chan-cohort-execution-20261026`: actual signed-in canaries, preservation and
  fixed-window final receipts. The original Stewart executor's stopped result
  remains stopped; later scoped read-only reconciliation verified its one READY
  deployment without retrying it.
- `p3-ics3c-cohort-execution-20261026` and
  `p5-ics3u-cohort-execution-20261026`: exact roster bindings, reviewed execution,
  representative canaries, final configuration and preservation receipts.
- `ppz3c-cohort-execution-20261026`: exact 31 additions, native-off applicability,
  signed-in canaries and the original qualified observation-gap receipt.
- `ppz3c-readonly-observation-20261027`: `OBSERVATION-0.json` through
  `OBSERVATION-6.json`, `PERIODIC-COVERAGE-VALIDATION.json`, final scoped data and
  configuration checks, and `REOBSERVATION-FINAL-RECEIPT.json`.

The bounded 70-account rollout has no remaining observation blocker. Wider
admission or a new-joiner policy needs a separate exact-scope decision, current
source/schema/provider applicability assessment, coordination and suitable
canaries. Any additional provider operation needs its own authority/readiness;
the existing holds are not released by cohort acceptance. Retain the compatible
release floor and stop new growth on an authorization/privacy failure or lost
work; do not strand current owners/members with an old teacher-only build or
destructive schema/role rollback.

Billing/subscriptions, broad global-role cleanup and retention remain separate
work. The classroom-access epic remains incomplete; its status and the paused
tool-backed goal are unchanged by this bounded acceptance.
