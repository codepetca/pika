import { describe, expect, it } from 'vitest'
import {
  createSourceFixtureIds,
  isLoopbackUrl,
  runBestEffortRolloverCleanup,
  selectDrillOperationResults,
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

  it('preallocates every fixture identity before any local write', () => {
    const ids = Object.values(createSourceFixtureIds())
    expect(ids).toHaveLength(7)
    expect(new Set(ids).size).toBe(7)
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true)
  })

  it('ignores concurrent operation results outside the browser request IDs', () => {
    const captureId = '10000000-0000-4000-8000-000000000001'
    const instantiateId = '10000000-0000-4000-8000-000000000002'
    const blueprintId = '20000000-0000-4000-8000-000000000001'
    const classroomId = '30000000-0000-4000-8000-000000000001'
    expect(selectDrillOperationResults([captureId, instantiateId], [
      {
        id: '10000000-0000-4000-8000-000000000099',
        result_blueprint_id: '20000000-0000-4000-8000-000000000099',
        result_classroom_id: null,
      },
      { id: captureId, result_blueprint_id: blueprintId, result_classroom_id: null },
      { id: instantiateId, result_blueprint_id: null, result_classroom_id: classroomId },
    ])).toEqual({ blueprintId, classroomId })
  })
})
