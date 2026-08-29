import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const baseMigration = readFileSync(
  resolve(root, 'supabase/migrations/140_course_guide_import_rate_limits.sql'),
  'utf8',
)
const hardeningMigration = readFileSync(
  resolve(root, 'supabase/migrations/141_harden_course_guide_import_rate_limits.sql'),
  'utf8',
)
const script = readFileSync(
  resolve(root, 'scripts/check-course-guide-import-rate-limit-database.sh'),
  'utf8',
)
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

describe('Course Guide import shared rate limit migration', () => {
  it('stores one bounded lease window per teacher', () => {
    expect(baseMigration).toContain('teacher_id uuid primary key references public.users')
    expect(baseMigration).toContain('attempt_count between 1 and 3')
    expect(baseMigration).toContain("interval '10 minutes'")
    expect(baseMigration).toContain('current_limit.attempt_count < 3')
    expect(baseMigration).toContain("interval '60 seconds'")
  })

  it('exposes both security-definer functions only to the service role', () => {
    expect(baseMigration.match(/security definer/g)).toHaveLength(2)
    expect(baseMigration.match(/set search_path = ''/g)).toHaveLength(2)
    expect(baseMigration).toContain(
      'revoke all on function public.acquire_course_guide_import_extraction_slot(uuid)',
    )
    expect(baseMigration).toContain(
      'revoke all on function public.release_course_guide_import_extraction_slot(uuid, uuid)',
    )
    expect(baseMigration.match(/grant execute on function/g)).toHaveLength(2)
    expect(baseMigration.match(/to service_role/g)).toHaveLength(2)
  })

  it('adds deadline margin and serializes a true rolling attempt window', () => {
    expect(hardeningMigration).toContain('add column attempt_timestamps timestamptz[]')
    expect(hardeningMigration).toContain('greatest(window_started_at, updated_at)')
    expect(hardeningMigration).toContain('for update')
    expect(hardeningMigration).toContain(
      "where attempted_at > v_now - interval '10 minutes'",
    )
    expect(hardeningMigration).toContain('cardinality(v_recent_attempts) >= 3')
    expect(hardeningMigration.match(/interval '90 seconds'/g)).toHaveLength(2)
    expect(hardeningMigration).toContain("set search_path = ''")
  })

  it('races independent workers and verifies the shared three-attempt window in CI', () => {
    expect(script).toContain('worker-a.json')
    expect(script).toContain('worker-b.json')
    expect(script).toContain('Expected one acquired lease and one active refusal')
    expect(script).toContain('active_lease_expires_at >= clock_timestamp()')
    expect(script).toContain("window_started_at = clock_timestamp() - interval '10 minutes 1 second'")
    expect(script).toContain('Expected the rolling fourth provider attempt to be rate limited')
    expect(script).toContain('Expected the conservative 140-to-141 backfill')
    expect(script).toContain('run_race "existing-row"')
    expect(script).toContain('Expected an expired lease token release to return false')
    expect(script).toContain('Expired lease release cleared the replacement lease')
    expect(workflow).toContain('bash scripts/check-course-guide-import-rate-limit-database.sh')
  })
})
