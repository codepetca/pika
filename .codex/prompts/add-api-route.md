Scaffold a new API route at the path in `$ARGUMENTS`.

Use `docs/ai-instructions.md` and `docs/core/architecture.md` for the canonical route rules. The critical route-specific requirements are:

- Use `withErrorHandler` from `@/lib/api-handler`
- Use `requireRole` for access control
- Use Zod for request validation
- Keep the happy path only inside the handler

Steps:
1. Resolve the target path to `$PIKA_WORKTREE/src/app/api/<path>/route.ts`.
2. Stop if the file already exists.
3. Infer role requirements and whether `context.params` is needed from the path.
4. Generate a minimal route with a `GET` handler by default.
5. Use a PascalCase route name for `withErrorHandler`.
6. Create parent directories if needed, then verify with `pnpm -C "$PIKA_WORKTREE" tsc --noEmit`.
