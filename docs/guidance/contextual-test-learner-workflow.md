# Dormant contextual Test learner workflow

This is the batch-2 learner integration, following owner workflow PR #1555.
It is source preparation, not an enabled cohort, deployment or phase exit.
The [classroom experience roadmap](classroom-access-and-entitlements-roadmap.md)
remains the execution and authority record.

## Scope and selection

The ten existing `/api/student/tests/[id]` route files retain their URLs and
response envelopes. One shared admission decision selects the contextual
handler; absent or unmatched admission retains the existing legacy branch.
No new per-route flags, pages, navigation, RLS rewrite or subscription logic.

The service-only `test_learner_workflow_v1` supports inspect, detail, start,
save, submit, recover, session, history, focus, results, document, history-plan
and history-write. Each narrow versioned result binds the authenticated actor,
Test, current Classroom, subject and operation. Application validation rejects
unexpected identity, grading and peer-resource projections.

## Authority and compatibility

- Current enrollment, not global teacher/student role or the owner's paid
  subscription, grants learner participation. A teacher owning Classroom A can
  be a learner in Classroom B.
- Current Classroom owner takes precedence over self-enrollment. Owner-history
  inspection is the existing explicit subject mode, including archived-class
  compatibility; ordinary members may inspect only their own history.
- The existing Test advisory → Classroom → Test protocol and bounded locks
  protect current identity, membership, visibility, archive and purge fences.
  Those checks precede revision-conflict responses from the existing atomic
  Start/save/submit functions. Legacy functions and their permissions remain
  unchanged.
- Own closed, unsubmitted saved-work recovery remains distinct from stricter
  detail/history/material availability. Session messaging and selected-student
  access behavior are retained; no new close/reopen product policy.
- Pre-return question/attempt projections omit grading answers, feedback and
  AI fields. Returned results require current returned disclosure authority;
  anonymous aggregates use current enrolled, returned nonowner participants,
  including teacher-role members, and exclude departed members.

## Writes, history and files

The existing revision-checked answer save/submit is authoritative. History is
separately locked and compare-and-set against the exact attempt, post-write
revision and last history entry. Existing JSON patch/snapshot, ten-second
collapse, paste/keystroke metrics and final-submit behavior are retained.
History failure must not roll back or misreport successful answers/submission.

Document delivery binds the current attached document, managed object, path,
Classroom, purpose and MIME. Existing historical URL-only/unmanaged compatibility
is retained. Private signed delivery uses the existing 60-second TTL; HTML
snapshots use the existing CSP. After Storage/MIME enrichment, the current
relationship and exact source tuple are checked again before responding. This
does not introduce revocation of an already issued short-lived signed URL.

## Bounds and acceptance

Requests carry a 30-second deadline; SQL phases carry at most eight seconds.
Bodies are at most 2 MiB, replies 8 MiB, aggregate decoded replies 64 MiB and
RPC statements 16. Collections have a 10,000-row ceiling: complete disclosure
or an explicit failure, never a silently truncated 1,000-row page.

Required acceptance includes cheap source/route/legacy checks, independent
security and compatibility review, a fresh exact-source disposable replay and
real SDK/Storage/concurrency/ACL evidence, genuine CLI-generated types, complete
canonical/global preservation and exact teardown, then final-head CI/PR Gate.
Offline fixture/transport tests and rollback SQL text are not native evidence.
The existing primary CI database lane runs the rollback contracts. Its sealed
inventory includes the added learner check; the independent lifecycle lane and
all existing checks remain intact. No new runner or weakened gate is introduced.

The fixed learner native profile reuses the existing private executor. Source
and offline checks cover history, real-SDK request plans, private material
delivery, returned current-roster aggregates, authority races, ACL restoration
and SQL cancellation. The separate execution candidate remains disabled and
unbound until final source review and fresh exact replay authorization. These
checks do not establish actual database, Storage, concurrency or type evidence.

The third isolated rehearsal on reviewed28d passed migration history, rollback/ACL
and genuine type generation, then failed the cancellation executor. Its exact
failed assertion remains unknown; teardown and complete preservation passed.
Source diagnosis proved that guard time polluted cancellation latency. The
correction measures dispatch through complete body validation separately from
guards: the wire retains its12s hard limit and7500–12000ms acceptance window;
the unchanged30s/absolute request deadline covers both full guards and SDK work.
An early cancellation cannot be padded by guard latency. Private finite stage
diagnostics retain first failure separately from restoration failure, without
underlying errors, inputs, bodies, headers or identities. Product SQL8s/30s,
one-RPC500/57014 evidence, exact restoration and all holds remain unchanged.
This proof-clock correction requires owner approval after review; no retry is
authorized by a source or synthetic check. Shared/canonical schemas stay untouched.

The fourth owner-approved isolated0cd rehearsal passed history/rollback/ACL/types,
then failed cancellation restoration; exact-owned/global/canonical/source cleanup
passed. A plain `ok` emitted by the fixed restoration guard was incorrectly
decoded as JSON. The correction accepts only that exact acknowledgement for the
fixed learner restoration SQL; missing, JSON or extra output is refused. Exact
catalog and whole-fixture equality checks still follow it. Offline child mocks
now reflect the real guard output. No product SQL, clock or rollout gate changes;
fresh exact-source native acceptance remains required before type installation.

Migration 257 is provisional until the candidate is frozen and current main is
reconciled. Predecessor proof profiles must explicitly seal its reviewed
name/digest/bytes while retaining full catalogs and future-migration refusal.
No prior migration approval carries into a new replay. Shared local/production
applications, production promotion and admission/home/page/cutover activation
remain separately held. This slice does not complete batch 2 or the overall goal.
