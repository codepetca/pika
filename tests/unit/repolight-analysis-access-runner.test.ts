import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'

const runner = readFileSync('scripts/check-repolight-analysis-access-database.sh', 'utf8')

describe('RepoLight offline replay source boundary', () => {
  it.each([['233', false], ['234', true], ['295', true], ['296', true], ['297', true], ['298', true], ['299', true], ['300', true], ['301', true], ['302', true], ['303', true], ['304', true], ['305', true], ['306', true], ['307', true], ['308', true], ['309', true], ['310', true], ['311', true], ['312', true], ['313', true], ['314', false], ['x', false]])(
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

  it('runs the actual preflight on the current inventory and gates billing proofs at their migrations', () => {
    const command = runner.match(/^pnpm --dir "\$root" exec tsx -e "([^"\n]+)"$/m)?.[1]
    expect(command).toBeDefined()
    const result = spawnSync(join(process.cwd(), 'node_modules/.bin/tsx'), ['-e', command!], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(runner).toMatch(/if \(\(10#\$replay_version >= 303\)\); then\n  if ! sql < "\$root\/scripts\/check-billing-renewal-pending-database.sql"/)
    expect(runner).toMatch(/if \(\(10#\$replay_version >= 304\)\); then\n  if ! sql < "\$root\/scripts\/check-billing-expiry-conflicts-database.sql"/)
    expect(runner).toMatch(/if \(\(10#\$replay_version >= 307\)\); then\n  if ! sql < "\$root\/scripts\/check-billing-scheduled-plan-change-admission-database.sql"/)
    expect(runner).toContain('if ((10#$replay_version >= 310)); then')
    expect(runner).toContain('node "$root/scripts/check-billing-classroom-cutoff-contention.mjs" "$clone_id" "$$:$token"')
    expect(runner).toContain('check-billing-live-target.sql')
    expect(runner).toContain('check-billing-assignment-release-intents.sql')
    expect(runner.indexOf('check-billing-live-trial-lifecycle.sql')).toBeLessThan(runner.indexOf('node "$root/scripts/check-billing-classroom-cutoff-contention.mjs"'))
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const billingStep = workflow.split('- name: Verify account plans and isolated Stripe billing contracts')[1]?.split('- name:')[0]
    expect(billingStep).toContain('docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < scripts/check-billing-expiry-conflicts-database.sql')
    expect(billingStep).toContain('docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < scripts/check-billing-scheduled-plan-change-admission-database.sql')
    for (const proof of ['check-billing-live-trial-lifecycle.sql', 'check-billing-live-target.sql', 'check-billing-assignment-release-intents.sql', 'check-billing-classroom-test-start-cutoff.sql', 'check-billing-classroom-capacity-restrictions.sql', 'check-billing-assignment-publication-cutoff.sql']) {
      expect(runner).toContain(proof)
      expect(billingStep).toContain(`docker exec -i supabase_db_pika psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < scripts/${proof}`)
    }
  }, 60_000)

  it('checks the exact reviewed 296/297 bytes and leaves platform schemas outside their scope', () => {
    const chain = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 297)
    expect(runner).toContain('validateDisposableBillingReplayMigrations(migrations)')
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
