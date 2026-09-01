import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTeacherManualAttendanceController } from '@/hooks/useTeacherManualAttendanceController'
import type { ManualAttendanceSettings, ManualAttendanceView } from '@/lib/manual-attendance'

const appMessageMock = vi.hoisted(() => ({
  showMessage: vi.fn(),
}))

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>()
  return {
    ...actual,
    useAppMessage: () => appMessageMock,
  }
})

const classroomId = '20000000-0000-4000-8000-000000000002'
const studentId = '30000000-0000-4000-8000-000000000003'

function strictModeWrapper({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children)
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function view(
  classDate: string,
  settings: ManualAttendanceSettings = {
    sourceMode: 'manual',
    sessionStartsLocal: null,
    sessionEndsLocal: null,
    revision: 1,
  },
): ManualAttendanceView {
  return {
    classroomId,
    classDate,
    settings,
    overrides: classDate === '2026-05-06'
      ? [{ studentId, status: 'late' }]
      : [],
  }
}

describe('useTeacherManualAttendanceController', () => {
  afterEach(() => {
    appMessageMock.showMessage.mockReset()
    vi.unstubAllGlobals()
  })

  it('does not apply a delayed date-A mark response to date B', async () => {
    let resolvePost!: (value: Response) => void
    const post = new Promise<Response>((resolve) => { resolvePost = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (!init?.method) {
        return Promise.resolve(response(view(url.searchParams.get('date')!)))
      }
      if (init.method === 'POST') return post
      throw new Error(`Unhandled fetch: ${url.toString()}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ selectedDate }) => useTeacherManualAttendanceController({
        classroomId,
        selectedDate,
        enabled: true,
        isActive: true,
        archived: false,
        visibleStudentIds: [studentId],
      }),
      { initialProps: { selectedDate: '2026-05-06' } },
    )

    await waitFor(() => expect(result.current.view?.classDate).toBe('2026-05-06'))
    let command!: Promise<void>
    await act(async () => {
      command = result.current.submitMarks([studentId], 'absent')
      await Promise.resolve()
    })
    rerender({ selectedDate: '2026-05-07' })
    await waitFor(() => expect(result.current.view?.classDate).toBe('2026-05-07'))

    await act(async () => {
      resolvePost(response({ ok: true }))
      await command
    })

    expect(result.current.view).toMatchObject({
      classDate: '2026-05-07',
      overrides: [],
    })
    expect(appMessageMock.showMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Attendance updated' }),
    )
  })

  it('invalidates an older GET and reloads after a settings save', async () => {
    let resolveFirstGet!: (value: Response) => void
    const firstGet = new Promise<Response>((resolve) => { resolveFirstGet = resolve })
    let getCount = 0
    let savedSettings: ManualAttendanceSettings = {
      sourceMode: 'manual',
      sessionStartsLocal: null,
      sessionEndsLocal: null,
      revision: 1,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (!init?.method) {
        getCount += 1
        return getCount === 1
          ? firstGet
          : Promise.resolve(response(view('2026-05-06', savedSettings)))
      }
      if (init.method === 'PUT') {
        savedSettings = { ...savedSettings, sourceMode: 'log', revision: 2 }
        return Promise.resolve(response({ settings: savedSettings }))
      }
      throw new Error(`Unhandled fetch: ${url.toString()}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useTeacherManualAttendanceController({
      classroomId,
      selectedDate: '2026-05-06',
      enabled: true,
      isActive: true,
      archived: false,
      visibleStudentIds: [studentId],
    }))

    await act(async () => {
      await result.current.saveSettings({ sourceMode: 'log' })
    })
    await waitFor(() => expect(result.current.settings).toMatchObject({
      sourceMode: 'log',
      revision: 2,
    }))

    await act(async () => {
      resolveFirstGet(response(view('2026-05-06')))
      await Promise.resolve()
    })
    expect(result.current.settings).toMatchObject({ sourceMode: 'log', revision: 2 })
  })

  it('loads and applies commands after React Strict Mode effect replay', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (!init?.method) return Promise.resolve(response(view('2026-05-06')))
      if (init.method === 'POST') return Promise.resolve(response({ ok: true }))
      throw new Error(`Unhandled fetch: ${url.toString()}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useTeacherManualAttendanceController({
      classroomId,
      selectedDate: '2026-05-06',
      enabled: true,
      isActive: true,
      archived: false,
      visibleStudentIds: [studentId],
    }), { wrapper: strictModeWrapper })

    await waitFor(() => expect(result.current.view?.classDate).toBe('2026-05-06'))
    await act(async () => {
      await result.current.submitMarks([studentId], 'absent')
    })
    expect(result.current.overridesByStudentId.get(studentId)).toBe('absent')
  })
})
