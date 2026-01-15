# AI-Driven UI Testing Guide

This guide explains how to use the Playwright MCP integration for AI-assisted UI verification in Pika.

## MANDATORY: Visual Verification for UI Changes

**After ANY UI/UX change, AI agents MUST:**

1. Start the MCP browser and visually verify the change
2. Check **BOTH** teacher (`teacher@example.com`) AND student (`student1@example.com`) views
3. Iterate on aesthetics/styling until it looks good
4. Take screenshots as evidence before committing

This ensures UI changes are properly reviewed before being committed.

## Overview

The Playwright MCP server allows AI agents (Claude Code, Codex) to:
- Navigate and interact with the running application
- Verify UI behavior after implementing changes
- **Iterate on aesthetics** - fix styling issues and refresh to verify
- Run predefined verification scenarios
- Capture screenshots as evidence

## Prerequisites

1. **Dev server running**: `pnpm dev`
2. **Auth states generated**: `pnpm e2e:auth`
3. **Test accounts exist**: Ensure test users exist in the database (run `pnpm seed` if needed)
4. **Test accounts**:
   - Teacher: `teacher@example.com` / `test1234`
   - Student: `student1@example.com` / `test1234`

## Starting the MCP Server

### Basic Usage

```bash
# As teacher (most common for dashboard testing)
pnpm e2e:mcp --teacher

# As student (for student experience testing)
pnpm e2e:mcp --student

# Unauthenticated (for login/signup testing)
pnpm e2e:mcp
```

### MCP Server Options

The script passes through additional Playwright MCP options:

```bash
# Headless mode (no visible browser)
pnpm e2e:mcp --teacher --headless

# Save trace for debugging
pnpm e2e:mcp --teacher --save-trace

# Custom output directory
pnpm e2e:mcp --teacher --output-dir ./my-screenshots
```

## MCP Tools Reference

Once the MCP server is running, Claude Code can use these tools:

### Navigation

| Tool | Description |
|------|-------------|
| `browser_navigate` | Go to URL |
| `browser_go_back` | Go back in history |
| `browser_go_forward` | Go forward in history |

### Inspection

| Tool | Description |
|------|-------------|
| `browser_snapshot` | Get accessibility tree (find elements, verify structure) |
| `browser_screenshot` | Capture visual screenshot |
| `browser_network_requests` | View network activity |

### Interaction

| Tool | Description |
|------|-------------|
| `browser_click` | Click an element |
| `browser_type` | Type text into an input |
| `browser_select_option` | Select from dropdown |
| `browser_press_key` | Press a keyboard key |

## Verification Scripts

### Running Verification Scripts

```bash
# List available scenarios
pnpm e2e:verify --help

# Run specific scenario
pnpm e2e:verify add-students-modal
pnpm e2e:verify create-classroom-wizard
```

### Output Format

Scripts output JSON to stdout:

```json
{
  "scenario": "add-students-modal",
  "passed": true,
  "checks": [
    { "name": "Navigate to roster tab", "passed": true },
    { "name": "Add button visible", "passed": true },
    { "name": "Modal opens on click", "passed": true }
  ]
}
```

Exit code is 0 for pass, 1 for fail.

### Available Scenarios

| Scenario | Description |
|----------|-------------|
| `add-students-modal` | Verify Add Students modal opens from roster tab |
| `create-classroom-wizard` | Verify Create Classroom wizard opens with name input |

## Manual Verification Flow

For ad-hoc testing during development:

```
1. browser_navigate url="http://localhost:3000/classrooms"
2. browser_snapshot  (inspect the page structure)
3. browser_click element="Create Classroom button"
4. browser_snapshot  (verify modal opened)
5. browser_type element="Classroom name" text="Test Class"
6. browser_click element="Create"
7. browser_snapshot  (verify success)
```

## Aesthetics Iteration Workflow

When implementing UI changes, use this workflow to iterate on styling:

### Step 1: Make the UI change
Edit the component/page code (e.g., `src/app/classrooms/page.tsx`)

### Step 2: View in browser
```
browser_navigate url="http://localhost:3000/classrooms"
browser_screenshot  (capture current state)
```

### Step 3: Assess and iterate
- Look at the screenshot for visual issues
- Check spacing, alignment, colors, typography
- If something looks off, edit the code and refresh:
  ```
  browser_navigate url="http://localhost:3000/classrooms"  (refresh)
  browser_screenshot  (capture updated state)
  ```

### Step 4: Check both roles
```bash
# Terminal 1: Teacher view
pnpm e2e:mcp --teacher
# Navigate and screenshot

# Terminal 2: Student view
pnpm e2e:mcp --student
# Navigate and screenshot
```

### Step 5: Verify interactions
```
browser_click element="Button you added"
browser_snapshot  (verify expected behavior)
```

### Step 6: Commit with evidence
Only commit once the UI looks correct in both teacher and student views.

## Best Practices

### ALWAYS Use AI UI Verification For

- **Any UI component changes** - MANDATORY visual check
- **Any styling/CSS changes** - MANDATORY check both roles
- **New UI features** - Iterate until it looks right
- **Debugging visual issues** - Screenshot before/after
- **Layout changes** - Check at viewport 1440x900

### When NOT to Use

- For unit tests (use Vitest)
- For visual regression (use `pnpm e2e:snapshots`)
- In CI/CD (MCP is for interactive development)
- For non-UI code changes (backend, utilities, etc.)

### Tips

- Start with `browser_snapshot` to understand page structure
- Use descriptive element references (button text, labels, roles)
- Capture screenshots at key verification points
- Check network requests if data isn't loading

## Troubleshooting

### "Auth state not found"

```bash
pnpm e2e:auth
```

### "Could not connect to browser"

```bash
pkill -f chromium
pnpm e2e:mcp --teacher
```

### "Element not found"

1. Use `browser_snapshot` to see available elements
2. Check if element has a unique identifier
3. Try using role-based selectors

### "Page not loading"

1. Verify dev server is running: `pnpm dev`
2. Check `E2E_BASE_URL` (defaults to `http://localhost:3000`)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_BASE_URL` | `http://localhost:3000` | Base URL for navigation |
| `E2E_TEACHER_EMAIL` | `teacher@example.com` | Teacher test account |
| `E2E_STUDENT_EMAIL` | `student1@example.com` | Student test account |
| `E2E_PASSWORD` | `test1234` | Password for test accounts |

### Auth State Files

- `.auth/teacher.json` - Teacher session state
- `.auth/student.json` - Student session state

These are gitignored and generated locally via `pnpm e2e:auth`.

## Adding New Verification Scripts

Create a new file in `e2e/verify/`:

```typescript
// e2e/verify/my-feature.ts
import type { VerificationScript, VerificationResult } from './types'

export const myFeature: VerificationScript = {
  name: 'my-feature',
  description: 'Verify my feature works',
  role: 'teacher', // or 'student' or 'unauthenticated'

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks = []

    // Navigate and verify
    await page.goto(`${baseUrl}/my-page`)
    // ... add checks

    return {
      scenario: 'my-feature',
      passed: checks.every(c => c.passed),
      checks,
    }
  },
}
```

Then register it in `e2e/verify/run.ts`:

```typescript
import { myFeature } from './my-feature'

const scenarios = {
  // ... existing
  'my-feature': myFeature,
}
```
