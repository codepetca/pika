import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/migrations.yml', 'utf8')

describe('migration workflow authorization boundary', () => {
  it('has only a manual trigger and defaults to preview', () => {
    const triggers = workflow.split('on:\n')[1].split('\npermissions:')[0]
    expect(triggers).toContain('  workflow_dispatch:')
    expect(triggers).not.toMatch(/\n  (push|pull_request|schedule|workflow_run):/)
    expect(triggers).toMatch(/options: \[preview, apply\][\s\S]*?default: preview/)
  })
  it('isolates main tooling from exact candidate data, binds target environment, and denies apply reruns', () => {
    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toContain(".github/workflows/migrations.yml@refs/heads/main")
    expect(workflow).toContain("inputs.mode == 'preview' || github.run_attempt == 1")
    expect(workflow).toMatch(/ref: \$\{\{ github.sha \}\}\n          path: tooling/)
    expect(workflow).toMatch(/ref: \$\{\{ inputs.source_sha \}\}\n          path: candidate/)
    expect(workflow).toContain('environment: migrations-${{ inputs.target }}')
    expect(workflow).toContain('ROLLOUT_BOUND_TARGET: ${{ vars.ROLLOUT_TARGET }}')
    expect(workflow).toContain('SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF }}')
    expect(workflow.indexOf('Validate dispatch before fetching candidate data')).toBeLessThan(workflow.indexOf('Checkout exact candidate as data'))
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2)
  })
  it('keeps read-only permissions, timeout and per-target serialization, and never interpolates inputs into shell code', () => {
    expect(workflow).toMatch(/permissions:\n  contents: read\n  actions: read/)
    expect(workflow).not.toMatch(/: write\b/)
    expect(workflow).toContain('group: manual-migrations-${{ inputs.target }}')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('timeout-minutes: 10')
    expect(workflow).toContain('version: 2.103.0')
    const runBlocks = [...workflow.matchAll(/        run: ([\s\S]*?)(?=\n      -|$)/g)].map(m => m[1])
    expect(runBlocks).toHaveLength(2)
    expect(runBlocks.join('\n')).not.toMatch(/\$\{\{|pnpm|db reset|db push|--db-url/)
    expect(runBlocks.join('\n')).toContain('node tooling/scripts/migration-rollout.mjs')
    expect(workflow).not.toContain('upload-artifact')
  })
})
