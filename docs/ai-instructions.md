# AI Instructions for Pika

Routing layer for repo agents. Use it after `.ai/START-HERE.md`.
Worktree creation, cleanup, and shared `.env.local` setup live in [`docs/dev-workflow.md`](./dev-workflow.md).

## Default Startup Context

1. [`.ai/START-HERE.md`](../.ai/START-HERE.md)
2. [`.ai/CURRENT.md`](../.ai/CURRENT.md)
3. [`.ai/features.json`](../.ai/features.json)
4. [`docs/ai-instructions.md`](./ai-instructions.md)

Do not tail `.ai/JOURNAL-ARCHIVE.md` by default. Use `.ai/SESSION-LOG.md` only for recent handoff; after each append, run `node scripts/trim-session-log.mjs`.

## Load Only The Docs You Need

After startup, load only task-specific docs:

| Task | Read next |
|---|---|
| Any non-trivial code change | [`docs/core/architecture.md`](./core/architecture.md) |
| UI/UX | [`docs/core/design.md`](./core/design.md), [`docs/guidance/ui/README.md`](./guidance/ui/README.md), [`docs/guidance/ui/stable.md`](./guidance/ui/stable.md), [`docs/guidance/ui/change-brief.md`](./guidance/ui/change-brief.md), [`docs/guides/ai-ui-testing.md`](./guides/ai-ui-testing.md) |
| Teacher assignments/tests shell/layout | [`docs/guidance/ui/teacher-work-surfaces.md`](./guidance/ui/teacher-work-surfaces.md), [`docs/guidance/assignment-ux-language.md`](./guidance/assignment-ux-language.md), [`docs/guidance/ui/audit-teacher-work-surfaces.md`](./guidance/ui/audit-teacher-work-surfaces.md) |
| Migrations, Supabase query-shape, rollout compatibility | [`docs/guidance/schema-rollout-checklist.md`](./guidance/schema-rollout-checklist.md) |
| Large TSX/shared shell refactors | [`docs/guidance/component-refactor-checklist.md`](./guidance/component-refactor-checklist.md) |
| TDD, coverage, or test design | [`docs/core/tests.md`](./core/tests.md) |
| Setup, runtime, or deployment questions | [`docs/core/project-context.md`](./core/project-context.md) |
| Workspace state, grading runs, exam mode, or runtime platform risk | [`docs/guidance/dev-flow-risk-checklists.md`](./guidance/dev-flow-risk-checklists.md) |
| Multi-agent delegation | [`docs/core/agents.md`](./core/agents.md) |
| Product status or phase questions | [`docs/core/roadmap.md`](./core/roadmap.md) |
| GitHub issue work | [`docs/workflow/handle-issue.md`](./workflow/handle-issue.md) |
| Course blueprint package import/export | [`docs/guidance/course-blueprint-packages.md`](./guidance/course-blueprint-packages.md) |
| Feature-specific behavior | `docs/guidance/*.md` or the closest focused spec |

Inspect or edit source only after startup and routed docs.

## Repo Invariants

- Platform: Next.js App Router, Supabase, Tailwind CSS, Vitest, Vercel
- Vercel cron: Hobby plan schedules must run at most once per day
- Timezone: all deadline and attendance logic uses `America/Toronto`
- Auth: email verification codes plus password login; WorkOS must map to `public.users.workos_user_id` while preserving local UUIDs
- Supabase access: authorize in server routes via `requireAuth()` / `requireRole()` and service-role client; no new browser-side table/RPC access without review
- Architecture: keep business logic out of UI components; prefer `src/lib/*` and server-side modules
- API routes: use `withErrorHandler` from `@/lib/api-handler`
- Repeated client-side reads: use `fetchJSONWithCache` from `@/lib/request-cache`
- Tiptap content parsing: import `parseContentField` from `@/lib/tiptap-content`
- UI primitives: import from `@/ui`; use semantic tokens in app code instead of raw `dark:` classes
- Migrations: AI may create or edit migration files, but humans apply them manually
- Workflow: use a worktree; include `Model recommendation: <model> - <reason>`; append `.ai/SESSION-LOG.md`; run `node scripts/trim-session-log.mjs`
- Risk profile: declare `none`, `workspace-state`, `async-grading`, `exam-mode`, or `runtime-platform`

## Prompt And Skill Map

Use `.codex/prompts/` for session start, issue work, TDD, UI verify, audit, API-route, error-handler, and production-merge flows. UI changes require Playwright final verification; see [`docs/guides/ai-ui-testing.md`](./guides/ai-ui-testing.md). When available, use specialist skills for product-design briefs, Pika UI verification, Supabase/Postgres work, and large React refactors.

## Source Of Truth Order

1. `.ai/features.json`
2. `.ai/CURRENT.md`
3. `docs/core/architecture.md`
4. `docs/core/tests.md`
5. `docs/core/design.md`
6. `docs/core/project-context.md`
7. `docs/core/roadmap.md`
8. `docs/core/decision-log.md`
9. `.ai/SESSION-LOG.md` on demand for recent handoff context
10. `.ai/JOURNAL-ARCHIVE.md` only for historical investigation
