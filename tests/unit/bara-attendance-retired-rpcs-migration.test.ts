import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/130_retire_unscoped_attendance_rpcs.sql'),
  'utf8',
)
const completionAudit = readFileSync(
  resolve(process.cwd(), 'docs/integrations/pika-bara-attendance-completion-audit.md'),
  'utf8',
)
const roadmap = readFileSync(
  resolve(process.cwd(), 'docs/integrations/pika-bara-native-attendance-roadmap.md'),
  'utf8',
)
const scanRunbook = readFileSync(
  resolve(process.cwd(), 'docs/integrations/bara-attendance-scan-load.md'),
  'utf8',
)
const v1Guide = readFileSync(
  resolve(process.cwd(), 'docs/integrations/bara-attendance-v1.md'),
  'utf8',
)
const canaryRunbook = readFileSync(
  resolve(process.cwd(), 'docs/integrations/pika-bara-attendance-canary.md'),
  'utf8',
)

describe('retired unscoped Bara attendance RPC migration', () => {
  it('removes every superseded worker and event capability from service role', () => {
    for (const signature of [
      'list_attendance_sync_targets_v1(integer)',
      'claim_attendance_outbox_batch_v1(integer, integer)',
      'attendance_outbox_health_v1()',
      'apply_attendance_event_v1(jsonb, text)',
    ]) {
      expect(migration).toContain(`function public.${signature}`)
    }
    expect(migration).toContain(
      'function public.list_attendance_reconciliation_targets_v1(\n  timestamptz, integer, integer\n)',
    )
    expect(migration.match(/from public, anon, authenticated, service_role;/g)?.length).toBe(5)
  })

  it('retains the functions for scoped security-definer wrappers', () => {
    expect(migration.toLowerCase()).not.toContain('drop function')
  })

  it('keeps active rollout guidance aligned with the production migration state', () => {
    expect(completionAudit).toContain('production migrations through 131 were recorded as applied')
    expect(roadmap).toContain('production migrations through 131 are recorded\nas applied')
    expect(completionAudit).toContain('do not dry-run or reapply it')
    expect(roadmap).toContain('do not edit, dry-run, or reapply migrations 129-131')
    expect(scanRunbook).toContain('full Pika migration history through migration\n   131')
    expect(scanRunbook).not.toContain('Supabase migration 127 is applied only')
    expect(v1Guide).toContain(
      'Migration 127 provides the base schema; the completed\nproduction canary proof additionally used migrations 129 and 130',
    )
    expect(v1Guide).toContain('The current recovery gate verifies the\nprior authorized production application')
    expect(v1Guide).toContain('of Pika migration 131 while attendance\nis disabled and never reapplies it')
    expect(v1Guide).not.toContain('The next gate is an explicitly\nauthorized production application of Pika migration 130')
    expect(v1Guide).toContain('Production migrations through 131 are now\nrecorded as applied to the named Pika project')
    expect(v1Guide).not.toContain('It has not been applied to a\nhosted environment')
    expect(v1Guide).not.toContain('hosted configured reads remain gated on applying migration 127')
    expect(canaryRunbook).toContain('production migrations through 131 are recorded as applied')
    expect(canaryRunbook).toContain('do not reapply it')
    expect(canaryRunbook).not.toContain('until migration 129 and the exact pair are installed')
  })
})
