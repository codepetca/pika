import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')
const retiredUiWorkflowPath = resolve(process.cwd(), '.github/workflows/ui-policy.yml')

describe('CI workflow', () => {
  it('runs comprehensive validation for pull requests without duplicate branch pushes', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toMatch(/^  pull_request:\n    branches: \[main, production\]$/m)
    expect(workflow).toContain('  workflow_dispatch:')
    expect(workflow).not.toMatch(/^  push:/m)

    expect(workflow).toContain('group: ci-${{ github.event.pull_request.number || github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')

    expect(workflow).toContain('name: Architecture Database Contracts')
    expect(workflow).toContain('name: Test & Build')
    expect(workflow).toContain('name: Browser Experience Matrix')
  })

  it('keeps UI policies in Test & Build and uploads coverage only for failures', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(existsSync(retiredUiWorkflowPath)).toBe(false)
    expect(workflow.match(/run: pnpm run check:ui-policy/g)).toHaveLength(1)
    expect(workflow.match(/run: pnpm run check:design-policy/g)).toHaveLength(1)
    expect(workflow).toContain('name: "Check No dark: Classes in App Code"')
    expect(workflow).toMatch(
      /- name: Upload coverage reports\n\s+if: failure\(\)\n\s+uses: actions\/upload-artifact@v7/,
    )
  })
})
