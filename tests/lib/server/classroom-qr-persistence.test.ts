import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadTeacherClassroomQrPresentation,
  openClassroomAttendanceQrToken,
  rotateTeacherClassroomQrPresentation,
} from '@/lib/server/classroom-attendance-qr'

const teacherId = '22222222-2222-4222-8222-222222222222'
const classroomId = '11111111-1111-4111-8111-111111111111'
const handleId = '44444444-4444-4444-8444-444444444444'
const nextHandleId = '55555555-5555-4555-8555-555555555555'
const row = { classroom_id: classroomId, handle_id: handleId, generation: 1, rotated_at: '2026-09-02T12:00:00.000Z' }
type Result = { data: unknown; error: { code: string } | null }

function database(results: Result[]) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => {
      if (!results.length) throw new Error('Unexpected query')
      return results.shift()
    }),
    single: vi.fn(async () => {
      if (!results.length) throw new Error('Unexpected query')
      return results.shift()
    }),
  }
  return { from: vi.fn(() => query), query }
}

describe('classroom QR persistence and rollout restrictions', () => {
  beforeEach(() => {
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', 'classroom-qr-persistence-test-secret-1234567890')
    vi.stubEnv('PIKA_CLASSROOM_QR_MODE', 'canary')
    vi.stubEnv('PIKA_CLASSROOM_QR_CANARY_TEACHER_ID', teacherId)
    vi.stubEnv('PIKA_CLASSROOM_QR_CANARY_CLASSROOM_ID', classroomId)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('creates a first handle and returns only its signed locator', async () => {
    const supabase = database([{ data: null, error: null }, { data: row, error: null }])
    const result = await loadTeacherClassroomQrPresentation({ supabase, teacherId, classroomId, createHandleId: () => handleId })
    expect(supabase.query.insert).toHaveBeenCalledWith({ classroom_id: classroomId, handle_id: handleId })
    expect(openClassroomAttendanceQrToken(result.entryPath.split('/').pop()!)).toBe(handleId)
    expect(result.generation).toBe(1)
  })

  it('reloads the winning handle after a concurrent insert collision', async () => {
    const supabase = database([
      { data: null, error: null }, { data: null, error: { code: '23505' } }, { data: row, error: null },
    ])
    const result = await loadTeacherClassroomQrPresentation({ supabase, teacherId, classroomId, createHandleId: () => nextHandleId })
    expect(openClassroomAttendanceQrToken(result.entryPath.split('/').pop()!)).toBe(handleId)
    expect(supabase.query.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('uses a classroom-and-generation compare-and-swap for rotation', async () => {
    const supabase = database([{ data: { ...row, handle_id: nextHandleId, generation: 2 }, error: null }])
    const result = await rotateTeacherClassroomQrPresentation({
      supabase, teacherId, classroomId, expectedGeneration: 1,
      createHandleId: () => nextHandleId, now: () => row.rotated_at,
    })
    expect(supabase.query.eq.mock.calls).toEqual([['classroom_id', classroomId], ['generation', 1]])
    expect(result.generation).toBe(2)
    expect(openClassroomAttendanceQrToken(result.entryPath.split('/').pop()!)).toBe(nextHandleId)
  })

  it('does not return a poster after a stale-generation conflict', async () => {
    const supabase = database([{ data: null, error: null }])
    await expect(rotateTeacherClassroomQrPresentation({ supabase, teacherId, classroomId, expectedGeneration: 1 }))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it.each(['42P01', 'PGRST205'])('maps missing schema %s without emitting a poster', async (code) => {
    const supabase = database([{ data: null, error: { code } }])
    await expect(loadTeacherClassroomQrPresentation({ supabase, teacherId, classroomId }))
      .rejects.toMatchObject({ code: 'migration_required' })
    expect(supabase.query.insert).not.toHaveBeenCalled()
  })

  it('denies direct helper access outside the canary before any read or write', async () => {
    const supabase = database([])
    await expect(loadTeacherClassroomQrPresentation({ supabase, teacherId, classroomId: teacherId }))
      .rejects.toMatchObject({ code: 'not_open' })
    await expect(rotateTeacherClassroomQrPresentation({ supabase, teacherId, classroomId: teacherId, expectedGeneration: 1 }))
      .rejects.toMatchObject({ code: 'not_open' })
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
