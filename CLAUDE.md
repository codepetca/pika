# CLAUDE.md

**Start here:** Read [`.ai/START-HERE.md`](.ai/START-HERE.md) before doing anything.

Full instructions: [`docs/ai-instructions.md`](docs/ai-instructions.md)

---

## Critical Rules (auto-loaded — enforced by CI/ESLint)

### Always
- **API routes**: `export const GET = withErrorHandler('Name', async (req, ctx) => { ... })` — never manual try/catch
- **Client fetches**: `fetchJSONWithCache(key, fetcher, ttlMs)` from `@/lib/request-cache` — never raw `fetch()` in components
- **Tiptap content**: `import { parseContentField } from '@/lib/tiptap-content'` — never define it locally
- **UI colors**: semantic tokens (`bg-surface`, `text-text-default`, `border-border`) — never `dark:` classes or raw colors
- **UI imports**: `import { Button, Input, ... } from '@/ui'` — never from `@/components`

### Never
- Run `supabase db push` or any migration command — human applies migrations manually
- Commit `.env.local` — it is a symlink, not a real file
- Work directly in `$HOME/Repos/pika` — always use a worktree

### Worktree
- All git commands: `git -C "$PIKA_WORKTREE"`
- All paths: absolute or `$PIKA_WORKTREE`-prefixed

---

Run `/audit` before every commit to catch violations automatically.
