# Browser Security Headers

## Purpose

Pika sends an enforced browser policy on rendered application responses so a
browser that is displaying student information cannot freely execute injected
code, disclose full internal URLs to another site, or expose unused device
capabilities.

## Policy ownership

- `src/middleware.ts` creates a new unpredictable CSP nonce for every rendered page request,
  forwards the trusted nonce to Next.js rendering, and applies the matching
  `Content-Security-Policy` response header after optional AuthKit headers.
- `src/app/layout.tsx` applies that nonce to Pika's explicit theme bootstrap
  script. Next.js applies it to framework and hydration scripts.
- `src/lib/browser-security.ts` is the single CSP source builder. Optional
  browser integrations contribute only validated HTTPS origins (or loopback
  HTTP origins during local development).
- `next.config.js` disables `X-Powered-By` and applies the route-wide baseline:
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and
  `Permissions-Policy`.
- The global referrer policy is `no-referrer`, so private Storage URLs,
  test-document links, and token-bearing attendance/login paths cannot enter
  same-origin or cross-origin request logs. Logout CSRF validation accepts an
  exact Origin normally. When this privacy policy produces `Origin: null`, it
  additionally requires browser-controlled `Sec-Fetch-Site: same-origin`;
  missing, same-site, and cross-site signals still fail closed.
- API responses receive the nonce policy so Next.js HTML fallbacks under `/api`
  remain protected. The student and teacher test-document snapshot routes retain
  ownership of their stricter script-free CSP; spoofed policy/nonce request
  headers are still removed before those handlers run.
- Vercel owns production HSTS. Verify it remains present after deployment.

## Deliberate compatibility allowances

- Rendered-page scripts require the per-request nonce. Production does not allow
  `unsafe-inline` or `unsafe-eval` scripts.
- Inline styles remain allowed because Pika and the Pal widget use React style
  attributes. Google Fonts styles and font files are allowed by exact origin.
- Images and media may load over HTTPS. Pika renders teacher-authored rich
  content and optional Pal artwork, so these sources cannot be same-origin only.
- Frames may load over HTTPS because teacher-provided test documents are viewed
  in a sandboxed iframe. Other sites may frame Pika only from Pika's own origin,
  preserving same-origin document previews while preventing external
  clickjacking.
- Browser connections default to Pika itself. Direct Storage uploads and the
  enabled optional Pal widget add only the origins parsed from
  `NEXT_PUBLIC_SUPABASE_URL` and `PAL_API_URL`; a configured but disabled Pal
  integration grants no browser connection access.
- Form submissions stay on Pika, except for the exact WorkOS API origin when
  the WorkOS browser-session logout flow is enabled.
- Fullscreen remains available to Pika for student test-taking. Camera,
  microphone, location, payment, USB, and other unused capabilities are denied.

## Operational impact

Nonce delivery makes App Router pages dynamically rendered. Pika's principal
authenticated routes were already request-rendered; public auth pages now use
the same path. This trades static/CDN HTML caching for a materially stronger
script policy. Static assets remain cacheable and are excluded from middleware.
Only actual `/_next/static/*` assets and the `/_next/image` optimizer endpoint
are excluded; reserved-prefix requests that render an HTML fallback still
receive the nonce policy. No database, Storage, teacher, or student workflow
changes are introduced.

Adding a new browser-side service, external frame protocol, font host, or script
requires an explicit policy update and regression coverage. Server-only
integrations do not belong in the browser allowlist.

## Release verification

Before merge:

1. Run the browser-security, middleware, and deployment-config unit tests.
2. Run the focused repository checks and a production build.
3. Start the production build locally and verify `/login`, an authenticated
   redirect route, an API route, and a passive static asset.
4. In a real browser, load `/login`, navigate client-side to `/signup`, and
   confirm there are no CSP errors.
5. Confirm every rendered script nonce matches the response policy nonce.

After deployment:

1. Verify the global baseline on `/login`, `/classrooms`, and `/api/auth/me`,
   and the rendered-page CSP on the first two; confirm `X-Powered-By` is absent
   and HSTS remains present.
2. Smoke teacher and student sign-in/navigation.
3. As a teacher, directly upload a test document and preview an HTTPS link.
4. As a student, open an assigned uploaded document and HTTPS link; when Pal is
   enabled, confirm the companion loads without CSP violations.
