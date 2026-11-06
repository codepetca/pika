import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'

const runner = readFileSync('scripts/check-repolight-analysis-access-database.sh', 'utf8')

describe('RepoLight offline replay source boundary', () => {
  it.each([['233', false], ['234', true], ['295', true], ['296', true], ['297', true], ['298', false], ['300', false], ['x', false]])(
    'admits source version %s: %s', (version, accepted) => {
      const start = runner.indexOf('[[ "$source_version" =~')
      const end = runner.indexOf('pnpm --dir "$root"', start)
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      const result = spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${runner.slice(start, end)}`], {
        encoding: 'utf8', env: { ...process.env, BASH_ENV: '', source_version: version },
      })
      expect(result.status === 0).toBe(accepted)
    },
  )

  it('checks the exact reviewed 296/297 bytes and leaves platform schemas outside their scope', () => {
    const chain = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 297)
    expect(runner).toContain('validateLifecycleServicesReviewedMigrations(migrations.slice(0,297))')
    expect(() => validateLifecycleServicesReviewedMigrations(chain)).not.toThrow()
    for (const index of [295, 296]) {
      expect(chain[index].sql).not.toMatch(/\b(?:auth|storage)\s*\./i)
      expect(chain[index].sql).not.toMatch(/\b(?:create|alter|drop)\s+schema\s+(?:auth|storage)\b/i)
      const changed = chain.map(entry => ({ ...entry }))
      changed[index].sql += '\n'
      expect(() => validateLifecycleServicesReviewedMigrations(changed)).toThrow()
    }
  })
})
