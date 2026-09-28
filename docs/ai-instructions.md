# AI Instructions for Pika

After `.ai/START-HERE.md`, use this router. Worktrees and env: [Workflow](./dev-workflow.md).

## Default Startup Context

1. [Start](../.ai/START-HERE.md)
2. [Current](../.ai/CURRENT.md)
3. [Features](../.ai/features.json)
4. [Routing](./ai-instructions.md)

History: `.ai/SESSION-LOG.md` for handoffs; append and trim. Archive only for investigation.

## Load Only The Docs You Need

| Task | Read next |
|---|---|
| Any non-trivial code change | [Architecture](./core/architecture.md) |
| UI/UX | Use [`.codex/skills/pika-ui-change`](../.codex/skills/pika-ui-change/SKILL.md), then `DESIGN.md`, `docs/guidance/ui/README.md`, and `docs/guidance/ui/stable.md` |
| Teacher work surfaces | [canon](./guidance/ui/teacher-work-surfaces.md), [operational tables](./guidance/ui/teacher-operational-tables.md), [assignment language](./guidance/assignment-ux-language.md), [audit](./guidance/ui/audit-teacher-work-surfaces.md) |
| Schema rollout or API validation | [`schema`](./guidance/schema-rollout-checklist.md), [`API`](./guidance/api-boundary-validation.md) |
| Classroom roles or entitlements | [Roadmap](./guidance/classroom-access-and-entitlements-roadmap.md) (phased rollout) |
| Billing, tiers, proration | [Policy](./guidance/subscription-policy.md) |
| Legacy quiz/tests contract cleanup | [Cleanup](./guidance/legacy-quiz-contract-cleanup.md), [Schema](./guidance/schema-rollout-checklist.md) |
| Large TSX/shared shell refactors | [Refactor checklist](./guidance/component-refactor-checklist.md) |
| TDD, coverage, or test design | [Tests](./core/tests.md) |
| Classroom assessment authoring | [Guide](./guidance/teacher-test-authoring.md) |
| Grading behavior, profiles, providers, provenance, or evals | [Architecture](./guidance/grading-architecture.md), [Egress](./guidance/ai-grading-egress.md), [Evals](./guidance/teacher-grading-evals.md) |
| Student Grades visibility, disclosure, or calculation | [Student Grades](./guidance/student-grades.md) |
| Setup, runtime, or deployment questions | [Project context](./core/project-context.md) |
| Workspace state, grading runs, exam mode, or runtime platform risk | [Risk checklists](./guidance/dev-flow-risk-checklists.md) |
| Multi-agent delegation | [Agents](./core/agents.md) |
| Product status or phase questions | [Roadmap](./core/roadmap.md) |
| GitHub issue work | [Issue workflow](./workflow/handle-issue.md) |
| Course blueprint package import/export | [Blueprint packages](./guidance/course-blueprint-packages.md) |
| Feature-specific behavior | `docs/guidance/*.md` or the closest focused spec |

Read startup and routed docs before edits.

## Repo Invariants

- Platform: Next.js App Router, Supabase, Tailwind CSS, Vitest, Vercel
- Vercel cron: Hobby plan schedules must run at most once per day
- Timezone: all deadline and attendance logic uses `America/Toronto`
- Auth: email verification codes plus password login; WorkOS must map to `public.users.workos_user_id` while preserving local UUIDs
- Supabase access: authorize in server routes via `requireAuth()` / `requireRole()` and service-role client; no new browser-side table/RPC access without review
- Architecture: keep business logic out of UI components; prefer `src/lib/*` and server-side modules
- API routes: use `withErrorHandler` and feature-owned Zod schemas for untrusted input
- Repeated client-side reads: use `fetchJSONWithCache` from `@/lib/request-cache`
- Tiptap content parsing: import `parseContentField` from `@/lib/tiptap-content`
- UI primitives: import from `@/ui`; use semantic tokens in app code instead of raw `dark:` classes
- Migrations: require one-time permission naming target and migration; follow the schema rollout checklist
- Workflow: use a worktree; automatic draft-first stable-SHA PRs per `docs/dev-workflow.md`; include `Model recommendation: <model> - <reason>`; append and trim the session log
- Risk profile: declare `none`, `workspace-state`, `async-grading`, `exam-mode`, or `runtime-platform`

## Prompt And Skill Map

Use `.codex/prompts/` for session start, issue work, TDD, UI verify, audit, API-route, error-handler, and production-merge flows. UI changes require Playwright final verification; see [`docs/guides/ai-ui-testing.md`](./guides/ai-ui-testing.md). When available, use specialist skills for product-design briefs, Pika UI verification, Supabase/Postgres work, and large React refactors.

## Source Of Truth Order

1. `.ai/features.json`
2. `.ai/CURRENT.md`
3. `docs/core/architecture.md`
4. `docs/core/tests.md`
5. `DESIGN.md`
6. `docs/core/project-context.md`
7. `docs/core/roadmap.md`
8. `docs/core/decision-log.md`
9. `.ai/SESSION-LOG.md` for recent handoffs
10. `.ai/JOURNAL-ARCHIVE.md` for history
