import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { runDeployedBaraAttendanceSmoke } from '../../scripts/deployed-bara-attendance-smoke-runner'

const secret = 'dedicated-smoke-operator-secret-at-least-32-characters'

describe('deployed Bara attendance smoke runner', () => {
  it('never reads or transmits the operator credential to an unconfigured origin', async () => {
    const readOperatorSecret = vi.fn(() => secret)
    const fetcher = vi.fn()

    await expect(runDeployedBaraAttendanceSmoke({
      stage: 'production',
      attendanceMode: 'pre-enable',
      attendanceScopeMode: 'exact_canary',
      targetScopeMode: 'exact_canary',
      expectedPikaOrigin: 'https://attacker.example',
      configuredPikaOrigin: 'https://pika.example',
      readOperatorSecret,
      fetcher,
    })).resolves.toMatchObject({ exitCode: 2 })

    expect(readOperatorSecret).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses the dedicated credential only for the exact configured production origin', async () => {
    const readOperatorSecret = vi.fn(() => secret)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: 'passed',
      checks: {
        canaryScope: true,
        transitionQueue: true,
        pikaToBara: true,
        baraToPika: true,
      },
    })))

    await expect(runDeployedBaraAttendanceSmoke({
      stage: 'production',
      attendanceMode: 'pre-enable',
      attendanceScopeMode: 'teacher_entitlements',
      targetScopeMode: 'teacher_entitlements',
      expectedPikaOrigin: 'https://pika.example',
      configuredPikaOrigin: 'https://pika.example/',
      readOperatorSecret,
      fetcher,
    })).resolves.toEqual({
      exitCode: 0,
      output: { status: 'passed', rolloutGateSatisfied: true, checksPassed: 4, checksTotal: 4 },
    })

    expect(readOperatorSecret).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      'https://pika.example/api/cron/bara-attendance-smoke',
      expect.objectContaining({
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${secret}`,
          'X-Attendance-Rollout-Mode': 'pre-enable',
          'X-Attendance-Scope-Mode': 'teacher_entitlements',
          'X-Attendance-Target-Scope-Mode': 'teacher_entitlements',
        },
      }),
    )
  })

  it.each([401, 409, 429, 503])(
    'blocks rollout when HTTP %i carries a pass-shaped body',
    async (status) => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({
        status: 'passed',
        checks: {
          canaryScope: true,
          transitionQueue: true,
          pikaToBara: true,
          baraToPika: true,
        },
      }), { status }))

      await expect(runDeployedBaraAttendanceSmoke({
        stage: 'production',
        attendanceMode: 'enabled',
        attendanceScopeMode: 'teacher_entitlements',
        targetScopeMode: 'teacher_entitlements',
        expectedPikaOrigin: 'https://pika.example',
        configuredPikaOrigin: 'https://pika.example',
        readOperatorSecret: () => secret,
        fetcher,
      })).resolves.toEqual({
        exitCode: 1,
        output: { status: 'failed', rolloutGateSatisfied: false, checksPassed: 0, checksTotal: 4 },
      })
    },
  )

  it('skips Preview without reading a credential or contacting a service', async () => {
    const readOperatorSecret = vi.fn(() => secret)
    const fetcher = vi.fn()

    await expect(runDeployedBaraAttendanceSmoke({
      stage: 'preview',
      attendanceMode: 'pre-enable',
      attendanceScopeMode: 'exact_canary',
      targetScopeMode: 'exact_canary',
      expectedPikaOrigin: 'https://pika-preview.example',
      configuredPikaOrigin: '',
      readOperatorSecret,
      fetcher,
    })).resolves.toMatchObject({
      exitCode: 1,
      output: { status: 'skipped', rolloutGateSatisfied: false },
    })
    expect(readOperatorSecret).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('executes the actual Preview CLI through the repository tsx runtime', () => {
    const result = spawnSync(
      resolve(process.cwd(), 'node_modules/.bin/tsx'),
      [
        resolve(process.cwd(), 'scripts/run-deployed-bara-attendance-smoke.ts'),
        '--stage',
        'preview',
        '--mode',
        'pre-enable',
        '--scope-mode',
        'exact_canary',
        '--target-scope-mode',
        'exact_canary',
        '--expected-pika-origin',
        'https://pika-preview.example',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET: '',
          NEXT_PUBLIC_APP_URL: '',
        },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      status: 'skipped',
      reason: 'production_only_no_staging_database',
      rolloutGateSatisfied: false,
    })
  })

  it('fails before reading credentials when the CLI omits rollout mode', () => {
    const result = spawnSync(
      resolve(process.cwd(), 'node_modules/.bin/tsx'),
      [
        resolve(process.cwd(), 'scripts/run-deployed-bara-attendance-smoke.ts'),
        '--stage',
        'production',
        '--expected-pika-origin',
        'https://pika.example',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET: secret,
          NEXT_PUBLIC_APP_URL: 'https://pika.example',
        },
      },
    )

    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('requires rollout mode')
  })
})
