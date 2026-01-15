# CLAUDE.md

**Start here:** Read [`.ai/START-HERE.md`](.ai/START-HERE.md) before doing anything.

This file exists so AI tools (Claude Code, Codex, Cursor, etc.) auto-load the session protocol. All instructions live in `.ai/START-HERE.md` and `docs/ai-instructions.md`.

## E2E and AI Testing

```bash
pnpm e2e:mcp [--teacher|--student]  # Start Playwright MCP server
pnpm e2e:auth                        # Refresh auth states
pnpm e2e:verify <scenario>           # Run verification script
pnpm e2e:snapshots                   # Run visual snapshot tests
```

See: `docs/guides/ai-ui-testing.md` for detailed usage.
