import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('classroom Pal installation boundaries', () => {
  it('installs disabled signal capture without academic or legacy reward backfill', () => {
    const sql = readFileSync('supabase/migrations/169_pal_classroom_signals.sql', 'utf8')
    expect(sql).toContain('enabled boolean not null default false')
    expect(sql).toContain('activated_at timestamptz')
    expect(sql).toContain('America/Toronto')
    expect(sql).toContain('private.pal_membership_outbox')
    expect(sql).toContain('private.pal_membership_week_configurations')
    expect(sql.trimEnd()).toMatch(/commit;$/)
    for (const family of ['platform.session.started', 'classroom.joined', 'daily_log.completed',
      'learning_item.viewed', 'learning_item.completed', 'daily_log_week.configured']) {
      expect(sql).toContain(family)
    }
  })
})
