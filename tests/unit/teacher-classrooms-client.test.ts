import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchTeacherArchivedClassroomState,
  fetchTeacherClassrooms,
  invalidateTeacherClassrooms,
} from '@/lib/teacher-classrooms-client'

const coldArchive = {
  classroom_id: '00000000-0000-4000-8000-000000000001',
  archive_id: '00000000-0000-4000-8000-000000000002',
  title: 'Stored history classroom',
  archived_at: '2026-07-01T12:00:00.000Z',
  compacted_at: '2026-07-10T12:00:00.000Z',
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('teacher classrooms client', () => {
  afterEach(() => {
    invalidateTeacherClassrooms()
    vi.unstubAllGlobals()
  })

  it('caches active and archived classroom lists separately for the verified teacher', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'teacher-1' } }))
      .mockResolvedValueOnce(jsonResponse({ classrooms: [{ id: 'active-class' }] }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'teacher-1' } }))
      .mockResolvedValueOnce(jsonResponse({ classrooms: [{ id: 'archived-class' }] }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'teacher-1' } }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'teacher-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTeacherClassrooms()).resolves.toEqual([{ id: 'active-class' }])
    await expect(fetchTeacherClassrooms({ archived: true })).resolves.toEqual([{ id: 'archived-class' }])
    await expect(fetchTeacherClassrooms()).resolves.toEqual([{ id: 'active-class' }])
    await expect(fetchTeacherClassrooms({ archived: true })).resolves.toEqual([{ id: 'archived-class' }])

    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/teacher/classrooms')
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/teacher/classrooms?archived=true')
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/auth/me', { cache: 'no-store' })
  })

  it('bypasses shared caching when the current user id cannot be verified', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Temporary auth failure' }, false))
      .mockResolvedValueOnce(jsonResponse({ classrooms: [{ id: 'teacher-a-class' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Temporary auth failure' }, false))
      .mockResolvedValueOnce(jsonResponse({ classrooms: [{ id: 'teacher-b-class' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTeacherClassrooms()).resolves.toEqual([{ id: 'teacher-a-class' }])
    await expect(fetchTeacherClassrooms()).resolves.toEqual([{ id: 'teacher-b-class' }])

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/teacher/classrooms')
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/teacher/classrooms')
  })

  it('validates and maps the archived classroom recovery response', async () => {
    const archivedClassroom = { id: 'archived-class' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'teacher-1' } }))
      .mockResolvedValueOnce(jsonResponse({
        classrooms: [archivedClassroom],
        cold_archives: [coldArchive],
        cold_archive_restore_enabled: true,
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTeacherArchivedClassroomState()).resolves.toEqual({
      classrooms: [archivedClassroom],
      coldArchives: [coldArchive],
      coldArchiveRestoreEnabled: true,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/teacher/classrooms?archived=true')
  })

  it('rejects an invalid cold archive response at the client boundary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'teacher-1' } }))
      .mockResolvedValueOnce(jsonResponse({
        classrooms: [],
        cold_archives: [{ ...coldArchive, archive_id: 'not-a-uuid' }],
        cold_archive_restore_enabled: true,
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTeacherArchivedClassroomState()).rejects.toThrow()
  })
})
