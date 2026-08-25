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
const currentContext = readFileSync(resolve(process.cwd(), '.ai/CURRENT.md'), 'utf8')
const operationalRecovery = readFileSync(
  resolve(process.cwd(), 'docs/integrations/pika-bara-attendance-operational-recovery.md'),
  'utf8',
)

function hasStaleProductionPreflight(markdown: string): boolean {
  const bashBlocks = Array.from(markdown.matchAll(/```bash\s*\n([\s\S]*?)\n```/g), ([, block]) => block)

  return bashBlocks.some(
    (block) =>
      block.includes('pnpm attendance:rollout:preflight --') &&
      block.includes('--stage production') &&
      block.includes('--mode pre-enable') &&
      block.includes('--scope-mode exact_canary'),
  )
}

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
    expect(completionAudit).toContain('Production migrations through 132 are\nrecorded as applied')
    expect(roadmap).toContain('production migrations through 132 are\nrecorded as applied')
    expect(completionAudit).toContain('enabled `teacher_entitlements` gate passed 4/4 in production')
    expect(roadmap).toContain('deployed bidirectional smoke passed 4/4 in that mode')
    expect(scanRunbook).toContain('full Pika migration history through migration\n   132')
    expect(scanRunbook).not.toContain('Supabase migration 127 is applied only')
    expect(v1Guide).toContain(
      'Migration 127 provides the base schema; the completed\nproduction canary proof additionally used migrations 129 and 130',
    )
    expect(v1Guide).toContain('The production recovery and entitlement\ngates have completed through migration 132')
    expect(v1Guide).toContain('attendance is enabled in\n`teacher_entitlements` mode')
    expect(v1Guide).not.toContain('The next gate is an explicitly\nauthorized production application of Pika migration 130')
    expect(v1Guide).toContain('Production migrations through 132 are recorded\nas applied to the named Pika project')
    expect(v1Guide).not.toContain('It has not been applied to a\nhosted environment')
    expect(v1Guide).not.toContain('hosted configured reads remain gated on applying migration 127')
    expect(v1Guide).toContain(
      'Current production operator shape:\n\n```bash\n' +
        'pnpm attendance:rollout:preflight -- \\\n' +
        '  --mode enabled \\\n' +
        '  --scope-mode teacher_entitlements \\\n' +
        '  --stage production \\\n' +
        '  --expected-supabase-ref "$PIKA_PRODUCTION_SUPABASE_REF" \\\n' +
        '  --production-supabase-ref "$PIKA_PRODUCTION_SUPABASE_REF" \\\n' +
        '  --expected-pika-origin "https://pika.codepet.ca" \\\n' +
        '  --expected-bara-api-origin "$BARA_PRODUCTION_CONVEX_SITE_ORIGIN"\n```',
    )
    expect(hasStaleProductionPreflight(v1Guide)).toBe(false)
    expect(canaryRunbook).toContain('Production migrations through 132 are recorded as\napplied')
    expect(canaryRunbook).toContain('signed smoke passed 4/4 on 2026-08-24')
    expect(canaryRunbook).not.toContain('until migration 129 and the exact pair are installed')
    expect(currentContext).toContain('Prod 001-132 applied')
    expect(currentContext).toContain('Attendance enabled in teacher_entitlements')
    expect(currentContext).toContain('signed smoke 4/4 passed 2026-08-24')
    expect(operationalRecovery).toContain('records Pika migrations through 132')
    expect(operationalRecovery).toContain(
      'enabled `teacher_entitlements` 4/4 deployed smoke on 2026-08-24',
    )
    expect(operationalRecovery).toContain(
      'pnpm attendance:smoke:deployed -- \\\n' +
        '     --mode enabled \\\n' +
        '     --scope-mode teacher_entitlements \\\n' +
        '     --target-scope-mode teacher_entitlements \\\n' +
        '     --stage production \\\n' +
        '     --expected-pika-origin "https://pika.codepet.ca"',
    )
    expect(operationalRecovery).not.toContain('With both attendance flags still false')
    expect(operationalRecovery).not.toContain(
      'Keep every non-canary teacher/classroom disabled',
    )
    expect(operationalRecovery).not.toContain(
      '--mode pre-enable \\\n     --scope-mode exact_canary',
    )
  })

  it('rejects stale production preflight blocks regardless of option order', () => {
    expect(
      hasStaleProductionPreflight(
        '```bash\npnpm attendance:rollout:preflight -- \\\n' +
          '  --mode pre-enable \\\n' +
          '  --scope-mode exact_canary \\\n' +
          '  --stage production\n```',
      ),
    ).toBe(true)
    expect(
      hasStaleProductionPreflight(
        '```bash\npnpm attendance:rollout:preflight -- \\\n' +
          '  --stage production \\\n' +
          '  --scope-mode exact_canary \\\n' +
          '  --mode pre-enable\n```',
      ),
    ).toBe(true)
    expect(
      hasStaleProductionPreflight(
        'Historical pre-enable exact_canary production sequence.\n\n' +
          '```bash\npnpm attendance:rollout:preflight -- \\\n' +
          '  --mode pre-enable \\\n' +
          '  --scope-mode exact_canary \\\n' +
          '  --stage preview\n```',
      ),
    ).toBe(false)
  })
})
