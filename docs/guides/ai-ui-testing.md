# AI-Driven UI Testing Guide

This guide explains how to use Playwright for AI-assisted UI verification in Pika.

## MANDATORY: Visual Verification for UI Changes

**After ANY UI/UX change, AI agents MUST:**

1. Take screenshots of the changed pages
2. Check **BOTH** teacher and student views (if applicable)
3. Iterate on aesthetics/styling until it looks good

## Prerequisites

1. **Dev server running**: `pnpm dev`
2. **Auth states generated**: `pnpm e2e:auth`
3. **Test accounts**:
   - Teacher: `teacher@example.com` / `test1234`
   - Student: `student1@example.com` / `test1234`

## Taking Screenshots

### Basic Usage

```bash
# Screenshot as teacher
npx playwright screenshot http://localhost:3000/classrooms /tmp/teacher.png \
  --load-storage .auth/teacher.json --viewport-size 1440,900

# Screenshot as student
npx playwright screenshot http://localhost:3000/classrooms /tmp/student.png \
  --load-storage .auth/student.json --viewport-size 1440,900

# Unauthenticated (login page, etc.)
npx playwright screenshot http://localhost:3000/login /tmp/login.png \
  --viewport-size 1440,900
```

### Useful Options

```bash
# Full page screenshot (scrollable content)
npx playwright screenshot <url> /tmp/full.png --full-page \
  --load-storage .auth/teacher.json --viewport-size 1440,900

# Wait for element before screenshot
npx playwright screenshot <url> /tmp/loaded.png \
  --wait-for-selector ".classroom-card" \
  --load-storage .auth/teacher.json --viewport-size 1440,900

# Wait for timeout (ms) before screenshot
npx playwright screenshot <url> /tmp/delayed.png \
  --wait-for-timeout 2000 \
  --load-storage .auth/teacher.json --viewport-size 1440,900
```

### Viewing Screenshots

After taking a screenshot, use the Read tool to view it:
```
Read /tmp/teacher.png
```

## Interactive Browser (Debugging)

For manual debugging, open an interactive browser:

```bash
# As teacher
npx playwright open http://localhost:3000/classrooms \
  --load-storage .auth/teacher.json --viewport-size 1440,900

# As student
npx playwright open http://localhost:3000/classrooms \
  --load-storage .auth/student.json --viewport-size 1440,900
```

## Verification Scripts

For automated checks, use the verification scripts:

```bash
# List available scenarios
pnpm e2e:verify --help

# Run specific scenario
pnpm e2e:verify create-classroom-wizard
pnpm e2e:verify add-students-modal
```

### Output Format

Scripts output JSON to stdout:

```json
{
  "scenario": "create-classroom-wizard",
  "passed": true,
  "checks": [
    { "name": "Navigate to classrooms page", "passed": true },
    { "name": "Create Classroom button visible", "passed": true },
    { "name": "Wizard opens on click", "passed": true },
    { "name": "Name input present in wizard", "passed": true }
  ]
}
```

Exit code is 0 for pass, 1 for fail.

## Iteration Workflow

When implementing UI changes:

### Step 1: Make the change
Edit the component/page code.

### Step 2: Take screenshot
```bash
npx playwright screenshot http://localhost:3000/<page> /tmp/check.png \
  --load-storage .auth/teacher.json --viewport-size 1440,900
```

### Step 3: View and assess
Use Read tool to view `/tmp/check.png`. Check:
- Spacing and alignment
- Colors and typography
- Overall aesthetics

### Step 4: Iterate
If something looks off:
1. Edit the code
2. Take another screenshot
3. Repeat until satisfied

### Step 5: Check both roles
Verify both teacher and student views look correct.

### Step 6: Commit
Only commit once the UI looks correct in both views.

## Best Practices

### ALWAYS verify visually for:
- Any UI component changes
- Any styling/CSS changes
- New UI features
- Layout changes

### Tips
- Use `--full-page` for long scrollable content
- Use `--wait-for-selector` if content loads dynamically
- Check both light and dark mode if applicable
- Standard viewport is 1440x900

## Troubleshooting

### "Auth state not found"
```bash
pnpm e2e:auth
```

### "Page not loading"
1. Verify dev server is running: `pnpm dev`
2. Check the URL is correct

### "Content not visible"
Use `--wait-for-selector` or `--wait-for-timeout` to wait for dynamic content.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_BASE_URL` | `http://localhost:3000` | Base URL for tests |
| `E2E_TEACHER_EMAIL` | `teacher@example.com` | Teacher test account |
| `E2E_STUDENT_EMAIL` | `student1@example.com` | Student test account |
| `E2E_PASSWORD` | `test1234` | Password for test accounts |

### Auth State Files

- `.auth/teacher.json` - Teacher session state
- `.auth/student.json` - Student session state

Generated via `pnpm e2e:auth`, gitignored.

## Adding Verification Scripts

Create a new file in `e2e/verify/`:

```typescript
// e2e/verify/my-feature.ts
import type { VerificationScript, VerificationResult } from './types'

export const myFeature: VerificationScript = {
  name: 'my-feature',
  description: 'Verify my feature works',
  role: 'teacher',

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks = []

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

Register in `e2e/verify/run.ts`:

```typescript
import { myFeature } from './my-feature'

const scenarios = {
  // ...existing
  'my-feature': myFeature,
}
```
