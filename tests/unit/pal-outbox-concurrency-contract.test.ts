import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('Pal outbox real-database concurrency contract', () => {
  it('runs competing and expired-lease claims in ephemeral Supabase CI', () => {
    const script = readFileSync(
      resolve(root, 'scripts/check-pal-outbox-concurrency.sh'),
      'utf8',
    )
    const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

    expect(script).toContain("name=^supabase_db_pika$")
    expect(script).toContain('claim_pal_event_outbox')
    expect(script).toContain("status = 'pending'")
    expect(script).toContain("status = 'processing'")
    expect(script).toContain('lease_expires_at')
    expect(script).toContain('attempts')
    expect(script).toContain('pg_stat_activity')
    expect(script).toContain("wait_event = 'PgSleep'")
    expect(script).not.toContain('sleep 0.2')
    expect(workflow).toContain('bash scripts/check-pal-outbox-concurrency.sh')
  })

  it('runs a real HTTP failure and queued recovery against local PostgREST', () => {
    const script = readFileSync(
      resolve(root, 'scripts/check-pal-delivery-recovery.ts'),
      'utf8',
    )
    const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

    expect(script).toContain("hostname !== '127.0.0.1'")
    expect(script).toContain("status: 503")
    expect(script).toContain('attemptImmediatePalEventDelivery')
    expect(script).toContain('deliverPalOutboxBatch')
    expect(script).toContain('record_pal_daily_log_week_configuration_atomic')
    expect(script).toContain('palTermCalendarForPeriodStart')
    expect(script).toContain("deliveredRow.status !== 'delivered'")
    expect(workflow).toContain('pnpm run smoke:pal-delivery-recovery')
  })
})
