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
      checks: { canaryScope: true, pikaToBara: true, baraToPika: true },
    })))

    await expect(runDeployedBaraAttendanceSmoke({
      stage: 'production',
      expectedPikaOrigin: 'https://pika.example',
      configuredPikaOrigin: 'https://pika.example/',
      readOperatorSecret,
      fetcher,
    })).resolves.toEqual({
      exitCode: 0,
      output: { status: 'passed', rolloutGateSatisfied: true, checksPassed: 3, checksTotal: 3 },
    })

    expect(readOperatorSecret).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      'https://pika.example/api/cron/bara-attendance-smoke',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${secret}` },
      }),
    )
  })

  it('skips Preview without reading a credential or contacting a service', async () => {
    const readOperatorSecret = vi.fn(() => secret)
    const fetcher = vi.fn()

    await expect(runDeployedBaraAttendanceSmoke({
      stage: 'preview',
      expectedPikaOrigin: 'https://pika-preview.example',
      configuredPikaOrigin: '',
      readOperatorSecret,
      fetcher,
    })).resolves.toMatchObject({
      exitCode: 0,
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

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      status: 'skipped',
      reason: 'production_only_no_staging_database',
      rolloutGateSatisfied: false,
    })
  })
})
