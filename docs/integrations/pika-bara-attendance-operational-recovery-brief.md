# Pika–Bara attendance operational recovery brief

- User goal: keep durable Pika-to-Bara delivery pending when no dependency-ready
  row is claimable and block rollout expansion unless deployed credentials work
  in both directions.
- Operator flow: run the production-targeted smoke gate against the exact
  configured teacher/classroom canary before enablement or expansion; the gate
  signs Pika-to-Bara, requires Bara to call the separately signed Pika ingress,
  and reports aggregate directional checks only.
- Architecture: normalize literal `null` and all-null PostgREST composite claim
  results before Zod parsing; defensively return SQL `null` explicitly from a new
  migration only if required by PostgreSQL/PostgREST behavior. Add a private
  operator route and a signed smoke-ingress route, backed by a bounded replay
  nonce table/RPC and existing exact-canary ownership checks.
- No-claim invariants: enqueue remains durable; no delivery occurs without a
  lease; both no-claim wire shapes become retryable `delivery_pending`; raw Zod
  diagnostics never escape; malformed non-null rows still fail closed.
- Smoke invariants: production deployment only; exact installation, tenant, teacher,
  classroom, Bara URL, and Pika callback URL come from deployment configuration;
  dedicated operator bearer pinned to configured Pika origin plus HMAC on
  service legs; separate directional secrets;
  one-use timestamped nonces; fixed paths and origins; bounded body, timeout,
  and attempts; no attendance messages/events/projections are created or changed;
  response contains only aggregate check names and pass/fail state.
- Preview rule: because no staging database exists, preview builds must record a
  production-only skip and must never contact production. A production rollout
  gate fails closed if the deployed smoke is skipped, unavailable, mis-scoped,
  replayed, or either direction rejects authentication.
- Risks: treating malformed data as no claim, leaking Zod/database diagnostics,
  SSRF, cross-tenant probes, replay, using one secret in both directions, or a
  local self-comparison that does not exercise deployed receivers.
- Simplification: no staging database, attendance-domain smoke fixture, browser
  endpoint, secret introspection, production flag mutation, or hosted requeue.
- Acceptance: focused tests cover both no-claim shapes and malformed rows;
  directional smoke success/mismatch/replay/scope/bounds; rollout docs make the
  production-only skip/fail and PR/deploy/migration order explicit.
