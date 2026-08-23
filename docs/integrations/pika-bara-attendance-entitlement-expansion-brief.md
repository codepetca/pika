# Pika attendance entitlement expansion

- User goal: make Attendance available in every active classroom owned by an
  authorized teacher, with teacher hours remaining an explicit activation.
- UX flow: an entitled teacher sees Attendance; no policy is "not configured";
  an enabled policy activates sync and automation for that classroom.
- Primary action: replace the exact runtime UUID admission fence with an
  audited Pika teacher entitlement while preserving the exact pair for the
  deployed credential smoke.
- Architecture plan: add service-role-only entitlement/audit state and
  classroom integration lifecycle; enforce one database predicate in routes,
  workers, claims, staging, reconciliation, and mapping-derived event ingress.
  Revocation denies new actions, supersedes stale pending commands, and sends a
  higher-revision empty schedule before becoming inactive.
- Risks: service-role bypass, pre-scheduled Bara sessions after revocation,
  stale outbox replay, expiry races, cross-classroom event application, and a
  rollout transition that accidentally enables every teacher.
- Simplification: Bara never receives plan, email, WorkOS, Pika user, or billing
  fields. Classroom feature visibility remains a teacher preference, not auth.
- Acceptance: default deployment remains exact-canary; entitlement mode admits
  only active entitled owners; absent policies schedule nothing; expiry omits
  later occurrences; revoke is bounded/idempotent/audited and deactivates each
  mapped classroom; existing open sessions may close and their signed cleanup
  events still project; the exact Codepet Labs scope continues to drive the
  aggregate signed smoke; migration/application/full checks pass.
