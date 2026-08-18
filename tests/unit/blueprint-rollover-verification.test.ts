import { describe, expect, it } from 'vitest'
import {
  isLoopbackUrl,
  runBestEffortRolloverCleanup,
} from '../../e2e/verify/blueprint-rollover'

describe('Blueprint rollover verification safety', () => {
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:54321',
    'postgresql://postgres:postgres@[::1]:54322/postgres',
  ])('allows loopback targets: %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true)
  })

  it.each([
    'https://pika.example.com',
    'https://project.supabase.co',
    'postgresql://postgres:secret@db.example.com/postgres',
    'not-a-url',
  ])('rejects non-local targets: %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(false)
  })

  it('restores known records and verifies the baseline when fallback discovery fails', async () => {
    const calls: string[] = []
    const checks = await runBestEffortRolloverCleanup({
      discoveries: [
        async () => {
          calls.push('failed discovery')
          throw new Error('forced discovery failure after capture')
        },
        async () => {
          calls.push('remaining discovery')
        },
      ],
      cleanup: () => {
        calls.push('cleanup known records')
      },
      verify: async () => {
        calls.push('verify baseline')
        return [{ name: 'baseline restored', passed: true }]
      },
    })

    expect(calls).toEqual([
      'failed discovery',
      'remaining discovery',
      'cleanup known records',
      'verify baseline',
    ])
    expect(checks).toEqual([{ name: 'baseline restored', passed: true }])
  })
})
