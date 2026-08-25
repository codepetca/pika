import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(
  process.cwd(),
  'scripts/check-bara-attendance-pilot-readiness.ts',
), 'utf8')

describe('attendance pilot readiness operator', () => {
  it('pins production, trims the canary UUID, and binds every Supabase request', () => {
    expect(script).toContain("stage !== 'production'")
    expect(script).toContain('PIKA_ATTENDANCE_PRODUCTION_TARGET.expectedSupabaseRef')
    expect(script).toContain('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID?.trim()')
    expect(script).toContain('createTargetBoundFetch(verifiedOrigin)')
  })
})
