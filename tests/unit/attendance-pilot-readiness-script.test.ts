import { spawnSync } from 'node:child_process'
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
    expect(script).toContain('createAttendancePilotReadOnlyFetch({')
  })

  it('emits only a stable error code when environment values contain sentinels', () => {
    const sentinelTeacher = 'sentinel-teacher-value'
    const sentinelSecret = 'sentinel-production-service-secret'
    const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm attendance:pilot:readiness -- --stage production']
      : ['attendance:pilot:readiness', '--', '--stage', 'production']
    const result = spawnSync(command, args, {
      cwd: resolve(process.cwd()),
      encoding: 'utf8',
      env: {
        NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca',
        PIKA_BARA_ATTENDANCE_ENABLED: 'true',
        PIKA_BARA_ATTENDANCE_SCOPE_MODE: 'teacher_entitlements',
        PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID: sentinelTeacher,
        NEXT_PUBLIC_SUPABASE_URL: 'https://zhioqbapgfcrronyuidm.supabase.co',
        SUPABASE_SECRET_KEY: sentinelSecret,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
      },
      timeout: 15_000,
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(output).toContain('attendance_pilot_read_failed')
    expect(output).not.toContain(sentinelTeacher)
    expect(output).not.toContain(sentinelSecret)
  })
})
