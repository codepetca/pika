import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TeacherLiveAttendanceTab } from '@/app/classrooms/[classroomId]/TeacherLiveAttendanceTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import type { TeacherAttendanceView } from '@/lib/teacher-attendance'
import type { Classroom } from '@/types'

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-08-17',
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
    <TooltipProvider>
      <AppMessageProvider>
        <TeacherLiveAttendanceTab classroom={classroomOverride} isActive />
      </AppMessageProvider>
    </TooltipProvider>,
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
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
  })

  it('renders the projected roster and enables accessible bulk corrections while open', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(attendanceView()))
      .mockResolvedValueOnce(jsonResponse({
        policy: {
          classroomId: classroom.id,
          timezone: 'America/Toronto',
          opensLocal: '08:45',
          closesLocal: '15:15',
          closeDayOffset: 0,
          enabled: true,
          revision: 1,
          updatedAt: '2026-08-17T12:00:00.000Z',
        },
      }))

    renderTab()

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.getByText('Hopper')).toBeInTheDocument()
    expect(screen.getByText('QR check-in')).toBeInTheDocument()
    const contextBar = screen.getByTestId('attendance-context-bar')
    const primaryControl = screen.getByTestId('attendance-primary-control')
    const showQr = within(contextBar).getByRole('button', { name: 'Show QR' })
    const closeAttendance = within(contextBar).getByRole('button', { name: 'Stop QR check-in' })
    expect(showQr).toBeEnabled()
    expect(closeAttendance).toBeEnabled()
    expect(within(primaryControl).getByRole('button', { name: 'Show QR' })).toBe(showQr)
    expect(within(primaryControl).getByRole('button', { name: 'Stop QR check-in' })).toBe(closeAttendance)
    const trailingActions = screen.getByTestId('attendance-trailing-actions')
    expect(trailingActions).toHaveClass('flex')
    expect(trailingActions).not.toHaveClass('hidden')
    const attendanceMenu = within(trailingActions).getByRole('button', { name: 'Attendance actions' })
    expect(attendanceMenu).toBeEnabled()
    fireEvent.click(attendanceMenu)
    const attendanceHours = screen.getByRole('menuitem', { name: 'Attendance hours' })
    expect(attendanceHours).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Refresh attendance' })).toBeEnabled()

    fireEvent.click(attendanceHours)
    expect(await screen.findByRole('dialog', { name: 'Attendance timing' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.focus(closeAttendance)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Stop QR check-in')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))

    const bulkActions = screen.getByRole('toolbar', { name: 'Bulk attendance actions' })
    expect(bulkActions).toBeInTheDocument()
    expect(within(bulkActions).getByRole('button', { name: /Present/ })).toBeEnabled()
    expect(within(bulkActions).getByRole('button', { name: /Absent/ })).toBeEnabled()
  })

  it('uses Daily-style status dots and sortable count chips without adding context-bar counts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView({
      students: [
        ...attendanceView().students,
        {
          studentId: '20000000-0000-4000-8000-000000000003',
          firstName: 'Katherine',
          lastName: 'Johnson',
          status: 'late',
          source: 'staff',
          revision: 1,
          pendingCommand: false,
          commandFailed: false,
        },
        {
          studentId: '20000000-0000-4000-8000-000000000004',
          firstName: 'Dorothy',
          lastName: 'Vaughan',
          status: 'absent',
          source: 'staff',
          revision: 1,
          pendingCommand: false,
          commandFailed: false,
        },
      ],
    })))

    renderTab()
    await screen.findByText('Ada')

    for (const status of ['Present', 'Late', 'Absent', 'Unmarked']) {
      expect(screen.getByRole('img', { name: status })).toHaveClass(
        'h-3',
        'w-3',
        'rounded-full',
        'ring-1',
        'ring-attendance-dot-halo',
      )
    }
    expect(screen.getByRole('img', { name: 'Present' })).toHaveClass('bg-attendance-present')
    expect(screen.getByRole('img', { name: 'Late' })).toHaveClass('bg-attendance-late')
    expect(screen.getByRole('img', { name: 'Absent' })).toHaveClass('bg-attendance-absent')
    expect(screen.getByRole('img', { name: 'Unmarked' })).toHaveClass('bg-attendance-unmarked')

    expect(screen.queryByText('Present')).not.toBeInTheDocument()
    expect(screen.queryByText('Late')).not.toBeInTheDocument()
    expect(screen.queryByText('Absent')).not.toBeInTheDocument()
    expect(screen.queryByText('Unmarked')).not.toBeInTheDocument()
    expect(screen.getByTestId('attendance-context-bar')).not.toHaveTextContent(/\d+ present/i)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))
    const selectedRow = screen.getByText('Grace').closest('tr')
    expect(selectedRow).toHaveClass('bg-info-bg')
    expect(within(selectedRow!).getByRole('img', { name: 'Present' })).toHaveClass(
      'ring-attendance-dot-halo',
    )

    const statusGroup = screen.getByRole('group', { name: 'Sort attendance by status' })
    const statusHeader = statusGroup.closest('th')
    const presentSort = within(statusGroup).getByRole('button', {
      name: 'Sort Present first, 1 student',
    })
    const lateSort = within(statusGroup).getByRole('button', {
      name: 'Sort Late first, 1 student',
    })
    const absentSort = within(statusGroup).getByRole('button', {
      name: 'Sort Absent first, 1 student',
    })

    expect(statusHeader).toHaveAttribute('aria-sort', 'none')
    expect(presentSort.firstElementChild).toHaveClass(
      'bg-attendance-present',
      'text-attendance-present-text',
    )
    expect(lateSort.firstElementChild).toHaveClass(
      'bg-attendance-late',
      'text-attendance-late-text',
    )
    expect(absentSort.firstElementChild).toHaveClass(
      'bg-attendance-absent',
      'text-attendance-absent-text',
    )

    fireEvent.click(lateSort)
    expect(lateSort).toHaveAttribute('aria-pressed', 'true')
    expect(statusHeader).toHaveAttribute('aria-sort', 'other')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('KatherineJohnson')

    fireEvent.click(absentSort)
    expect(absentSort).toHaveAttribute('aria-pressed', 'true')
    expect(lateSort).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('DorothyVaughan')

    fireEvent.click(presentSort)
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('GraceHopper')
  })

  it('matches Daily sortable identity columns, source sorting, and resize semantics', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView({
      students: [
        ...attendanceView().students,
        {
          studentId: '20000000-0000-4000-8000-000000000003',
          firstName: 'Katherine',
          lastName: 'Johnson',
          status: 'late',
          source: 'staff',
          revision: 1,
          pendingCommand: false,
          commandFailed: false,
        },
      ],
    })))

    renderTab()
    await screen.findByText('Ada')

    const firstHeader = screen.getByRole('columnheader', { name: 'First' })
    const lastHeader = screen.getByRole('columnheader', { name: 'Last' })
    const sourceHeader = screen.getByRole('columnheader', { name: 'Source' })
    expect(lastHeader).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(within(firstHeader).getByRole('button', { name: 'First' }))
    expect(firstHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(lastHeader).toHaveAttribute('aria-sort', 'none')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('AdaLovelace')

    fireEvent.click(within(firstHeader).getByRole('button', { name: 'First' }))
    expect(firstHeader).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('KatherineJohnson')

    fireEvent.click(within(sourceHeader).getByRole('button', { name: 'Source' }))
    expect(sourceHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('GraceHopper')

    expect(screen.getByRole('separator', { name: 'Resize First column' })).toHaveAttribute(
      'aria-valuenow',
      '72',
    )
    expect(screen.getByRole('separator', { name: 'Resize Last column' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize Source column' })).toBeInTheDocument()
  })

  it('groups the date and immediate session command in the center action cluster', async () => {
    const scheduledView = attendanceView({
      session: {
        state: 'scheduled',
        opensAt: '2026-08-17T12:45:00.000Z',
        closesAt: '2026-08-17T13:15:00.000Z',
        revision: 1,
        commandFailed: false,
      },
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(scheduledView))
      .mockResolvedValueOnce(jsonResponse({ outcome: 'applied' }))
      .mockResolvedValueOnce(jsonResponse(attendanceView({
        session: {
          ...scheduledView.session,
          state: 'open',
          revision: 2,
        },
      })))

    renderTab()
    await screen.findByText('Ada')

    const contextBar = screen.getByTestId('attendance-context-bar')
    const primaryControl = screen.getByTestId('attendance-primary-control')
    expect(within(primaryControl).getByRole('button', { name: 'Previous day' })).toBeEnabled()
    expect(within(primaryControl).getByRole('button', { name: 'Go to today' })).toHaveTextContent('Aug 17')
    expect(within(primaryControl).getByRole('button', { name: 'Next day' })).toBeEnabled()

    const openAttendance = within(contextBar).getByRole('button', { name: 'Open QR check-in' })
    expect(openAttendance).toBeEnabled()
    expect(openAttendance).toHaveTextContent('')
    expect(within(primaryControl).getByRole('button', { name: 'Open QR check-in' })).toBe(openAttendance)
    expect(screen.queryByText('Open QR check-in')).not.toBeInTheDocument()

    fireEvent.focus(openAttendance)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open QR check-in')
    fireEvent.click(openAttendance)

    await waitFor(() => expect(screen.getByText('Attendance opened')).toBeInTheDocument())
    const commandWrite = vi.mocked(fetch).mock.calls[1]
    expect(commandWrite[0]).toBe('/api/teacher/attendance/session')
    expect(JSON.parse(String(commandWrite[1]?.body))).toMatchObject({
      classroom_id: classroom.id,
      date: '2026-08-17',
      command: 'open',
    })
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
    await screen.findByText('Ada')
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
    expect(screen.getByText('Ada')).toBeInTheDocument()
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
    await screen.findByText('Ada')
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
    await screen.findByText('Ada')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    fireEvent.click(within(
      screen.getByRole('toolbar', { name: 'Bulk attendance actions' }),
    ).getByRole('button', { name: /Present/ }))

    await waitFor(() => {
      const adaRow = screen.getByText('Ada').closest('tr')
      expect(within(adaRow!).getByLabelText('Present')).toHaveClass('bg-attendance-present')
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
    await screen.findByText('Ada')

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
    await screen.findByText('Ada')

    expect(screen.getAllByText(/previous session update failed/i)).toHaveLength(1)
    expect(screen.getByText('Previous update failed')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).toBeEnabled()
  })

  it('keeps an unconfirmed projection warning visible in the quiet context slot', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(attendanceView({
      sync: { state: 'stale', confirmedAt: '2026-08-17T12:45:00.000Z' },
    })))

    renderTab()
    await screen.findByText('Ada')

    const contextBar = screen.getByTestId('attendance-context-bar')
    expect(within(contextBar).getByText('Last confirmed')).toBeInTheDocument()
    expect(within(contextBar).getByText(/Open/)).toHaveClass('hidden')
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
    await screen.findByText('Ada')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    fireEvent.click(within(
      screen.getByRole('toolbar', { name: 'Bulk attendance actions' }),
    ).getByRole('button', { name: /Present/ }))
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
    await screen.findByText('Ada')

    expect(screen.queryByRole('button', { name: 'Stop QR check-in' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).toBeDisabled()
  })
})
