Scaffold a new API route at the path in `$ARGUMENTS` in the current feature worktree.

Read `docs/ai-instructions.md`, `docs/core/architecture.md` (API Route Error Handling),
and `docs/guidance/api-boundary-validation.md` for the maintained boundary example.
For a real service-role accessor, inspect `src/app/api/teacher/classrooms/route.ts`;
it imports `getServiceRoleClient` from `@/lib/supabase`. Its pilot and archive
branches are feature-specific and should not be copied into a new scaffold.

1. Resolve the git root and target `src/app/api/<path>/route.ts`; stop if it exists.
2. Infer the role from `teacher/` or `student/`; establish the intended auth policy
   for other paths. Preserve resource ownership/enrollment checks after authentication.
3. Wrap each handler with `withErrorHandler` from `@/lib/api-handler` using a
   PascalCase operation name. Use `requireRole` from `@/lib/auth` where appropriate.
4. Await dynamic `context.params`. Validate untrusted params, queries and bodies
   with named feature-owned Zod schemas before calling server/domain logic.
5. Add a minimal GET by default; add mutations only when the requested contract
   requires them. Keep business logic in `src/lib/server/` or the feature module.
6. Run `pnpm tsc --noEmit` and relevant API tests from the repo root; report the
   created path and checks. Type checking is project-wide, not a single-file check.
