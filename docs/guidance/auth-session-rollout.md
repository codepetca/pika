# Authentication session hardening rollout

Migration `148_auth_session_and_rate_limit_hardening.sql` is an additive
prerequisite for the compatible application release. It adds a credential
version to users, creates server-only session and authentication-throttle
records, enforces unique reset handoffs, and adds atomic session-issuance and
password-reset functions. The old application ignores these objects, so the
safe order is:

1. Merge and verify the application change without promoting it to Production.
2. With fresh one-time approval naming the Production Supabase target and exact
   migration 148, apply the migration and run database lint plus the auth
   database contract.
3. Deploy the compatible application.
4. Verify one teacher and one student can sign in, read `/api/auth/me`, open a
   protected route, log out, and cannot reuse the logged-out session.
5. With synthetic accounts only, prove a password reset revokes an older
   session while the newly issued session remains valid, and prove a sibling
   reset handoff cannot be replayed. Remove the fixture.

The session format advances from 2 to 3. Existing password-session cookies fail
closed and require one login after deployment. When the WorkOS pilot is active,
an existing verified WorkOS session can restore the new Pika mapping through
the existing exact-link path. This one-time invalidation is intentional; do not
add compatibility code that treats a version-2 seal as an independent
credential.

Expired session rows are removed during atomic session issuance, and
authentication-rate metadata is removed after one day by the limiter itself.
Every password flow charges its HMAC-protected client budget first, a
high-capacity 10,000-request one-minute overload guard second, and its
identifier budget last. A blocked source therefore cannot consume a victim's
identifier quota. The short overload window is a database safety valve, not a
normal user quota: it requires sustained aggregate traffic above roughly 166
requests per second and can deny traffic for at most the remainder of one
minute. Production client identity comes only from Vercel's overwritten
`x-vercel-forwarded-for`; a missing or malformed header maps to one shared
fail-closed client budget. Limiter tables and functions remain inaccessible to
browser roles. `/api/auth/me` responses are explicitly private and
non-cacheable.

Signup and forgot-password responses wait for the same 350 ms floor after
fixed bcrypt work. Eligible delivery uses Next.js `after()`, so Brevo latency
and provider failures cannot change the public response boundary. This adds a
small intentional latency to those two low-frequency actions while keeping
login and protected-page latency unchanged.

Rollback is application-safe because migration 148 is additive. Rolling the
application back makes version-3 cookies unreadable to the older authorization
logic, so affected users must sign in again. Leave the tables/functions in
place during rollback; removing them is unnecessary and would discard
revocation evidence.

No migration application, production deployment, password reset, or hosted
fixture creation is implicit in this runbook. Each remains separately gated.
