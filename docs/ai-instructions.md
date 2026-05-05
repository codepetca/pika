# AI Instructions for Pika

This file is the AI routing layer for the repo. Use it after `.ai/START-HERE.md`.

For worktree creation, cleanup, and shared `.env.local` setup, use [`docs/dev-workflow.md`](./dev-workflow.md). Do not duplicate those setup steps elsewhere.

## Default Startup Context

Read these files at the start of every session:

1. [`.ai/START-HERE.md`](../.ai/START-HERE.md)
2. [`.ai/CURRENT.md`](../.ai/CURRENT.md)
3. [`.ai/features.json`](../.ai/features.json)
4. [`docs/ai-instructions.md`](./ai-instructions.md)

Do not tail `.ai/JOURNAL-ARCHIVE.md` by default. Use `.ai/SESSION-LOG.md` only for recent handoff context.

## Load Only The Docs You Need

After the startup set above, load task-specific docs:

| Task | Read next |
|---|---|
| Any non-trivial code change | [`docs/core/architecture.md`](./core/architecture.md) |
| UI or UX work | [`docs/core/design.md`](./core/design.md), [`docs/guidance/ui/README.md`](./guidance/ui/README.md), [`docs/guidance/ui/stable.md`](./guidance/ui/stable.md), [`docs/guides/ai-ui-testing.md`](./guides/ai-ui-testing.md) |
| Teacher assignments, quizzes, or tests work-surface shell/layout work | [`docs/guidance/ui/teacher-work-surfaces.md`](./guidance/ui/teacher-work-surfaces.md), [`docs/guidance/assignment-ux-language.md`](./guidance/assignment-ux-language.md), [`docs/guidance/ui/audit-teacher-work-surfaces.md`](./guidance/ui/audit-teacher-work-surfaces.md) |
| TDD, coverage, or test design | [`docs/core/tests.md`](./core/tests.md) |
| Setup, runtime, or deployment questions | [`docs/core/project-context.md`](./core/project-context.md) |
| Workspace state, grading runs, exam mode, or runtime platform risk | [`docs/guidance/dev-flow-risk-checklists.md`](./guidance/dev-flow-risk-checklists.md) |
| Multi-agent delegation | [`docs/core/agents.md`](./core/agents.md) |
| Product status or phase questions | [`docs/core/roadmap.md`](./core/roadmap.md) |
| GitHub issue work | [`docs/workflow/handle-issue.md`](./workflow/handle-issue.md) |
| Course blueprint package import/export | [`docs/guidance/course-blueprint-packages.md`](./guidance/course-blueprint-packages.md) |
| Feature-specific behavior | `docs/guidance/*.md` or the closest focused spec |

Inspect or modify source only after the startup set and the docs required by your task are loaded.

## Repo Invariants

- Platform: Next.js App Router, Supabase, Tailwind CSS, Vitest, Vercel
- Vercel cron guardrail: on the Hobby plan, cron schedules must run at most once per day; do not add sub-daily repo-managed Vercel cron jobs
- Timezone: all deadline and attendance logic uses `America/Toronto`
- Auth: email verification codes plus password login; no OAuth providers
- Architecture: keep business logic out of UI components; prefer `src/lib/*` and server-side modules
- API routes: use `withErrorHandler` from `@/lib/api-handler`
- Repeated client-side reads: use `fetchJSONWithCache` from `@/lib/request-cache`
- Tiptap content parsing: import `parseContentField` from `@/lib/tiptap-content`
- UI primitives: import from `@/ui`; use semantic tokens in app code instead of raw `dark:` classes
- Migrations: AI may create or edit migration files, but humans apply them manually
- Workflow: do non-trivial work in a bound worktree, plan before coding, append a concise `.ai/SESSION-LOG.md` entry, and trim it with `node scripts/trim-session-log.mjs`
- Risk profile: for non-trivial work, declare `none`, `workspace-state`, `async-grading`, `exam-mode`, or `runtime-platform` in the plan

## Prompt And Command Map

| Task | Claude Code | Codex |
|---|---|---|
| Start a session | `/session-start` | `.codex/prompts/session-start.md` |
| Work on a GitHub issue | `/work-on-issue <N>` | `.codex/prompts/work-on-issue.md` |
| TDD implementation | `/tdd <feature>` | `.codex/prompts/tdd.md` |
| Verify UI changes | `/ui-verify <page>` | `.codex/prompts/ui-verify.md` |
| Pre-commit audit | `/audit` | `.codex/prompts/audit.md` |
| Migrate error handler | `/migrate-error-handler <file>` | `.codex/prompts/migrate-error-handler.md` |
| Scaffold API route | `/add-api-route` | `.codex/prompts/add-api-route.md` |
| Merge `main` into `production` | `/merge-main-into-production` | `.codex/prompts/merge-main-into-production.md` |

UI changes must be visually verified before commit. Use [`docs/guides/ai-ui-testing.md`](./guides/ai-ui-testing.md) for the verification workflow.

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
