import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(process.cwd(), 'scripts/run-focused-checks.mjs'), 'utf8')

describe('focused local checks', () => {
  it('uses the same classifier as CI and never shells interpolated paths', () => {
    expect(script).toContain("from './classify-ci-changes.mjs'")
    expect(script).toContain("execFileSync(command, args, { stdio: 'inherit' })")
    expect(script).toContain("['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']")
    expect(script).toContain("['ls-files', '--others', '--exclude-standard']")
    expect(script).not.toContain('execSync(')
  })

  it('runs policy checks and affected Vitest suites before final CI', () => {
    expect(script).toContain("['run', 'check:workflow']")
    expect(script).toContain("['run', 'check:architecture']")
    expect(script).toContain("['run', 'check:ui-policy']")
    expect(script).toContain("['run', 'check:design-policy']")
    expect(script).toContain("['exec', 'vitest', 'related', '--run', ...relatedSources]")
    expect(script).toContain("['exec', 'tsc', '--noEmit']")
    expect(script).toContain("['run', 'lint']")
  })
})
