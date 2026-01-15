# CLAUDE.md

**Start here:** Read [`.ai/START-HERE.md`](.ai/START-HERE.md) before doing anything.

This file exists so AI tools (Claude Code, Codex, Cursor, etc.) auto-load the session protocol. All instructions live in `.ai/START-HERE.md` and `docs/ai-instructions.md`.

## UI/UX Changes: MUST Verify Visually (MANDATORY)

**After ANY UI/UX change, you MUST:**

1. Start MCP server and visually verify the change in the browser
2. Check BOTH teacher AND student views (if applicable)
3. Iterate on aesthetics/styling until it looks good
4. Take screenshots as evidence

```bash
# 1. Ensure dev server is running
pnpm dev

# 2. Refresh auth if needed (uses teacher@example.com / student1@example.com)
pnpm e2e:auth

# 3. Start browser for teacher view
pnpm e2e:mcp --teacher

# 4. Start browser for student view (separate terminal)
pnpm e2e:mcp --student
```

**In the browser, use these MCP tools:**
- `browser_navigate` - Go to the page you changed
- `browser_snapshot` - See element structure
- `browser_screenshot` - Capture visual state for review
- `browser_click`, `browser_type` - Interact with the UI

**Iterate until satisfied:** If something looks off, fix the code and refresh the browser to verify again.

See: `docs/guides/ai-ui-testing.md` for detailed usage.

## Other E2E Commands

```bash
pnpm e2e:verify <scenario>           # Run verification script
pnpm e2e:snapshots                   # Run visual snapshot tests
```
