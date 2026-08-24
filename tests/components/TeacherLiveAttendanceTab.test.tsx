import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TeacherLiveAttendanceTab } from '@/app/classrooms/[classroomId]/TeacherLiveAttendanceTab'
import { AppMessageProvider } from '@/ui'
import type { TeacherAttendanceView } from '@/lib/teacher-attendance'
import type { Classroom } from '@/types'

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-08-17',
}))

vi.mock('@/ui/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const classroom: Classroom = {
  id: '10000000-0000-4000-8000-000000000001',
  teacher_id: '10000000-0000-4000-8000-000000000002',
  title: 'Physics',
  class_code: 'PHYS01',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const opaqueEntryToken = 'A'.repeat(100)
const opaqueEntryPath = `/attendance/check-in/${opaqueEntryToken}`

function attendanceView(overrides: Partial<TeacherAttendanceView> = {}): TeacherAttendanceView {
  return {
    classroomId: classroom.id,
    classDate: '2026-08-17',
    integration: 'ready',
    session: {
      state: 'open',
      opensAt: '2026-08-17T12:45:00.000Z',
      closesAt: '2026-08-17T13:15:00.000Z',
      revision: 1,
      commandFailed: false,
    },
    sync: { state: 'current', confirmedAt: '2026-08-17T12:45:00.000Z' },
    students: [
      {
        studentId: '20000000-0000-4000-8000-000000000001',
        firstName: 'Ada',
        lastName: 'Lovelace',
        status: 'unmarked',
        source: null,
        revision: null,
        pendingCommand: false,
        commandFailed: false,
      },
      {
        studentId: '20000000-0000-4000-8000-000000000002',
        firstName: 'Grace',
        lastName: 'Hopper',
        status: 'present',
        source: 'student_qr',
        revision: 1,
        pendingCommand: false,
        commandFailed: false,
      },
    ],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderTab(classroomOverride: Classroom = classroom) {
  return render(
    <AppMessageProvider>
      <TeacherLiveAttendanceTab classroom={classroomOverride} isActive />
    </AppMessageProvider>,
  )
}

describe('TeacherLiveAttendanceTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the native Pika surface safe while the integration is disabled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView({ integration: 'disabled' })))

    renderTab()

    expect(await screen.findByRole('heading', { name: 'Attendance is not enabled' })).toBeInTheDocument()
    expect(screen.getByText(/still using Daily/i)).toBeInTheDocument()
    expect(screen.queryByText('Lovelace, Ada')).not.toBeInTheDocument()
  })

  it('renders the projected roster and enables accessible bulk corrections while open', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView()))

    renderTab()

    expect(await screen.findByText('Lovelace, Ada')).toBeInTheDocument()
    expect(screen.getByText('Hopper, Grace')).toBeInTheDocument()
    expect(screen.getByText('QR check-in')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show QR' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close attendance' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Attendance hours' })).toBeEnabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))

    expect(screen.getByRole('toolbar', { name: 'Bulk attendance actions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Present/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Absent/ })).toBeEnabled()
  })

  it('groups the date selector and icon-only open action in the center FAB', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView({
      session: {
        state: 'scheduled',
        opensAt: '2026-08-17T12:45:00.000Z',
        closesAt: '2026-08-17T13:15:00.000Z',
        revision: 1,
        commandFailed: false,
      },
    })))

    renderTab()
    await screen.findByText('Lovelace, Ada')

    const centerFab = screen.getByTestId('attendance-center-fab')
    expect(within(centerFab).getByRole('button', { name: 'Previous day' })).toBeEnabled()
    expect(within(centerFab).getByRole('button', { name: 'Go to today' })).toHaveTextContent('Aug 17')
    expect(within(centerFab).getByRole('button', { name: 'Next day' })).toBeEnabled()

    const openAttendance = within(centerFab).getByRole('button', { name: 'Open attendance' })
    expect(openAttendance).toBeEnabled()
    expect(openAttendance).toHaveTextContent('')
    expect(screen.queryByText('Open attendance')).not.toBeInTheDocument()
  })

  it('loads a Pika-owned QR presentation only when requested and copies its exact entry URL', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(attendanceView()))
      .mockResolvedValueOnce(jsonResponse({
        entryPath: opaqueEntryPath,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        revision: 1,
      }))

    renderTab()
    await screen.findByText('Lovelace, Ada')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))
    expect(await screen.findByRole('img', {
      name: 'Student attendance check-in QR code',
    })).toBeInTheDocument()
    expect(screen.getByText('Scan to check in through Pika')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `http://localhost:3000${opaqueEntryPath}`,
      )
    })
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      `/api/teacher/attendance/qr?classroom_id=${classroom.id}&date=2026-08-17`,
    )
  })

  it('removes an expired QR while the teacher leaves the dialog open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T13:14:00.000Z'))
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(attendanceView()))
      .mockResolvedValueOnce(jsonResponse({
        entryPath: opaqueEntryPath,
        expiresAt: '2026-08-17T13:15:00.000Z',
        revision: 1,
      }))

    renderTab()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Lovelace, Ada')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('img', {
      name: 'Student attendance check-in QR code',
    })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText('This QR code has expired')).toBeInTheDocument()
    expect(screen.queryByRole('img', {
      name: 'Student attendance check-in QR code',
    })).not.toBeInTheDocument()
  })

  it('does not render a presentation that is already expired', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(attendanceView()))
      .mockResolvedValueOnce(jsonResponse({
        entryPath: opaqueEntryPath,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        revision: 1,
      }))

    renderTab()
    await screen.findByText('Lovelace, Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))

    expect(await screen.findByText('This QR code has expired')).toBeInTheDocument()
    expect(screen.queryByRole('img', {
      name: 'Student attendance check-in QR code',
    })).not.toBeInTheDocument()
  })

  it('does not present a submitted mark as confirmed until the projected revision arrives', async () => {
    const initial = attendanceView()
    const confirmed = attendanceView({
      students: initial.students.map((student) => student.firstName === 'Ada'
        ? { ...student, status: 'present', source: 'staff', revision: 1 }
        : student),
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse({ outcome: 'applied', appliedCount: 1 }))
      .mockResolvedValueOnce(jsonResponse(confirmed))

    renderTab()
    await screen.findByText('Lovelace, Ada')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    fireEvent.click(screen.getByRole('button', { name: /Present/ }))

    await waitFor(() => {
      const adaRow = screen.getByText('Lovelace, Ada').closest('tr')
      expect(adaRow).toHaveTextContent('Present')
      expect(adaRow).toHaveTextContent('Teacher')
    })
    expect(screen.queryByRole('toolbar', { name: 'Bulk attendance actions' })).not.toBeInTheDocument()

    const post = vi.mocked(fetch).mock.calls[1]
    expect(post[0]).toBe('/api/teacher/attendance/marks')
    expect(post[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({
      classroom_id: classroom.id,
      date: '2026-08-17',
      marks: [{
        student_id: '20000000-0000-4000-8000-000000000001',
        status: 'present',
        reason_code: 'staff_correction',
      }],
    })
  })

  it('allows audited corrections after close without offering an unsupported reopen command', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView({
      session: {
        state: 'closed',
        opensAt: '2026-08-17T12:45:00.000Z',
        closesAt: '2026-08-17T13:15:00.000Z',
        revision: 2,
        commandFailed: false,
      },
    })))

    renderTab()
    await screen.findByText('Lovelace, Ada')

    expect(screen.queryByRole('button', { name: /reopen attendance/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    expect(screen.getByRole('toolbar', { name: 'Bulk attendance actions' })).toBeInTheDocument()
  })

  it('shows permanent command failures while allowing a fresh correction', async () => {
    const base = attendanceView()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView({
      session: { ...base.session, commandFailed: true },
      students: base.students.map((student) => student.firstName === 'Ada'
        ? { ...student, commandFailed: true }
        : student),
    })))

    renderTab()
    await screen.findByText('Lovelace, Ada')

    expect(screen.getAllByText(/previous session update failed/i)).toHaveLength(2)
    expect(screen.getByText('Previous update failed')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).toBeEnabled()
  })

  it('does not let a command response for one date replace the newly selected date', async () => {
    let resolvePost!: (response: Response) => void
    const postResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve
    })
    const nextDay = attendanceView({
      classDate: '2026-08-18',
      session: {
        state: 'not_scheduled',
        opensAt: null,
        closesAt: null,
        revision: null,
        commandFailed: false,
      },
    })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') return await postResponse
      if (url.includes('date=2026-08-18')) return jsonResponse(nextDay)
      if (url.includes('date=2026-08-17')) return jsonResponse(attendanceView())
      throw new Error(`Unexpected request: ${url}`)
    })

    renderTab()
    await screen.findByText('Lovelace, Ada')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    fireEvent.click(screen.getByRole('button', { name: /Present/ }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(await screen.findByText('Student attendance for Tuesday, August 18')).toBeInTheDocument()

    await act(async () => {
      resolvePost(jsonResponse({ outcome: 'applied', appliedCount: 1 }))
      await Promise.resolve()
    })

    expect(screen.getByText('Student attendance for Tuesday, August 18')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('date=2026-08-17'))).toHaveLength(1)
  })

  it('disables all mutations for an archived classroom', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView()))

    renderTab({ ...classroom, archived_at: '2026-08-18T00:00:00Z' })
    await screen.findByText('Lovelace, Ada')

    expect(screen.queryByRole('button', { name: 'Close attendance' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).toBeDisabled()
  })
})
