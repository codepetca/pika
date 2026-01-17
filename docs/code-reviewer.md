# Pika — Code Review Protocol

Use this protocol whenever asked to review a PR or code change.

## Goals
- Improve correctness, security, maintainability, and adherence to Pika’s documented constraints.
- Do not invent requirements; review against the PR description and linked issue.

## Workflow

### 1) Understand Context
- Read the PR title/body and linked issue(s).
- Identify scope and acceptance criteria.
- Note any feature IDs referenced from `.ai/features.json`.

### 2) High-Level Review
- Architecture alignment (`docs/core/architecture.md`) and separation of concerns.
- Security posture (sessions, auth, Supabase key usage, input validation).
- Timezone correctness (`America/Toronto`) for deadlines and reporting.
- Simplicity: avoid new abstractions/deps unless necessary.

### 3) Detailed Review (Per Area)
- **Next.js App Router**: route handlers/server actions boundaries, caching pitfalls, correct use of server/client components.
- **Supabase access**: prefer least-privilege; ensure ownership/enrollment checks are enforced server-side.
- **Auth/session**: `iron-session` cookie settings, role checks, lockout/rate limiting behavior.
- **UI**: minimal, mobile-first, Tailwind-only; no business logic embedded in components.
- **Tests**: changes include appropriate unit/API tests; run `pnpm test` locally where feasible.

### 4) Output Format (Required)
Respond with:
- **Summary** (1–3 sentences)
- **Requested Changes (blocking)**: list exact issues to fix
- **Suggestions (non-blocking)**: polish/refactors
- **Testing Notes**: what was run / what should be run

