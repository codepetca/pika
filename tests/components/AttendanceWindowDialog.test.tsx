import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AttendanceWindowDialog } from '@/app/classrooms/[classroomId]/AttendanceWindowDialog'
import { AppMessageProvider, TooltipProvider } from '@/ui'

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-08-17',
}))

const classroomId = '10000000-0000-4000-8000-000000000001'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function savedPolicy(overrides: Record<string, unknown> = {}) {
  return {
    classroomId,
    timezone: 'America/Toronto',
    sessionStartsLocal: '08:45',
    sessionEndsLocal: '09:15',
    sessionEndDayOffset: 0,
    entryOpensMinutesBefore: 10,
    presentGraceMinutes: 5,
    entryClosesMinutesBeforeEnd: 10,
    absentMinutesBeforeEnd: 0,
    enabled: true,
    revision: 1,
    updatedAt: '2026-08-17T12:00:00.000Z',
    ...overrides,
  }
}

function renderDialog(onSaved = vi.fn(), onClose = vi.fn()) {
  const dialog = (isOpen: boolean) => (
    <TooltipProvider>
      <AppMessageProvider>
        <AttendanceWindowDialog
          classroomId={classroomId}
          isOpen={isOpen}
          onSaved={onSaved}
          onClose={onClose}
        />
      </AppMessageProvider>
    </TooltipProvider>
  )
  const view = render(dialog(true))
  return {
    onSaved,
    onClose,
    rerenderDialog: (isOpen: boolean) => view.rerender(dialog(isOpen)),
  }
}

describe('AttendanceWindowDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('starts with durable defaults, saves the policy, and syncs the next 90 days', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: null }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({
        roster: { outcome: 'applied', revision: 1 },
        schedule: { outcome: 'applied', revision: 1 },
      }))
    const { onSaved, onClose } = renderDialog()

    expect(await screen.findByLabelText('Session starts*')).toHaveValue('09:00')
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '08:45' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '09:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('Attendance timing saved')).toBeInTheDocument()

    const policyWrite = vi.mocked(fetch).mock.calls[1]
    expect(policyWrite[0]).toBe('/api/teacher/attendance/policy')
    expect(JSON.parse(String(policyWrite[1]?.body))).toEqual({
      classroom_id: classroomId,
      session_starts_local: '08:45',
      session_ends_local: '09:15',
      session_end_day_offset: 0,
      entry_opens_minutes_before: 10,
      present_grace_minutes: 5,
      entry_closes_minutes_before_end: 10,
      absent_minutes_before_end: 0,
      enabled: true,
      expected_revision: null,
    })

    const syncWrite = vi.mocked(fetch).mock.calls[2]
    expect(syncWrite[0]).toBe('/api/teacher/attendance/sync')
    expect(JSON.parse(String(syncWrite[1]?.body))).toEqual({
      classroom_id: classroomId,
      window_start: '2026-08-17',
      window_end: '2026-11-15',
    })
  })

  it('loads an existing policy and sends its revision with an overnight update', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ revision: 4 }) }))
      .mockResolvedValueOnce(jsonResponse({
        policy: savedPolicy({
          sessionStartsLocal: '23:30',
          sessionEndsLocal: '00:30',
          sessionEndDayOffset: 1,
          revision: 5,
        }),
      }))
      .mockResolvedValueOnce(jsonResponse({
        roster: { outcome: 'applied', revision: 1 },
        schedule: { outcome: 'applied', revision: 2 },
      }))
    const { onSaved } = renderDialog()

    expect(await screen.findByLabelText('Session starts*')).toHaveValue('08:45')
    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '23:30' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '00:30' } })
    fireEvent.change(screen.getByLabelText('Session end day'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toMatchObject({
      session_starts_local: '23:30',
      session_ends_local: '00:30',
      session_end_day_offset: 1,
      expected_revision: 4,
    })
  })

  it('re-enables a disabled automatic policy with its current revision', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ enabled: false, revision: 7 }) }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ enabled: true, revision: 8 }) }))
      .mockResolvedValueOnce(jsonResponse({
        roster: { outcome: 'applied', revision: 1 },
        schedule: { outcome: 'applied', revision: 2 },
      }))
    const { onSaved } = renderDialog()

    const automaticToggle = await screen.findByRole('checkbox', {
      name: 'Open and close automatically',
    })
    expect(automaticToggle).not.toBeChecked()

    fireEvent.click(automaticToggle)
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toMatchObject({
      enabled: true,
      expected_revision: 7,
    })
  })

  it('keeps optional attendance guidance in help tooltips', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
    renderDialog()

    await screen.findByDisplayValue('08:45')

    expect(screen.queryByText('Applied automatically on scheduled class days')).not.toBeInTheDocument()
    expect(screen.queryByText('Use next day only for classes that continue past midnight.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Pika sends concrete Toronto-time windows/)).not.toBeInTheDocument()
    const closingDayHelp = screen.getByRole('button', { name: 'About closing day' })
    const automaticHelp = screen.getByRole('button', { name: 'About automatic attendance hours' })
    expect(closingDayHelp).toHaveAttribute('aria-expanded', 'false')
    expect(automaticHelp).toHaveAttribute('aria-expanded', 'false')
    expect(closingDayHelp).not.toHaveAttribute('aria-controls')
    expect(automaticHelp).not.toHaveAttribute('aria-controls')

    fireEvent.pointerMove(closingDayHelp, { pointerType: 'mouse' })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Use next day only')
    fireEvent.pointerLeave(closingDayHelp)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())

    fireEvent.focus(automaticHelp)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Pika sends concrete Toronto-time windows')
    fireEvent.blur(automaticHelp)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())

    fireEvent.click(closingDayHelp)
    expect(closingDayHelp).toHaveAttribute('aria-expanded', 'true')
    expect(closingDayHelp).toHaveAttribute('aria-controls', 'closing-day-help')
    expect(document.getElementById('closing-day-help')).toBeVisible()
    expect(screen.getByText('Use next day only for classes that continue past midnight.')).toBeVisible()

    fireEvent.click(closingDayHelp)
    expect(closingDayHelp).toHaveAttribute('aria-expanded', 'false')
    expect(closingDayHelp).not.toHaveAttribute('aria-controls')
    expect(screen.queryByText('Use next day only for classes that continue past midnight.')).not.toBeInTheDocument()

    fireEvent.click(automaticHelp)
    expect(automaticHelp).toHaveAttribute('aria-expanded', 'true')
    expect(automaticHelp).toHaveAttribute('aria-controls', 'automatic-hours-help')
    expect(document.getElementById('automatic-hours-help')).toBeVisible()
  })

  it('collapses tapped help when the dialog is reopened', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
    const { rerenderDialog } = renderDialog()

    await screen.findByDisplayValue('08:45')
    fireEvent.click(screen.getByRole('button', { name: 'About closing day' }))
    expect(screen.getByText('Use next day only for classes that continue past midnight.')).toBeVisible()

    rerenderDialog(false)
    rerenderDialog(true)

    await screen.findByDisplayValue('08:45')
    expect(screen.getByRole('button', { name: 'About closing day' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Use next day only for classes that continue past midnight.')).not.toBeInTheDocument()
  })

  it('keeps the saved policy and reports recovery when immediate sync is unavailable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ revision: 2 }) }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Attendance is temporarily unavailable' }, 503))
    const { onSaved, onClose } = renderDialog()

    await screen.findByDisplayValue('08:45')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('Hours saved; schedule delivery not confirmed')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(savedPolicy({ revision: 2 }), false)
  })

  it('blocks an invalid same-day window before any write', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ policy: null }))
    renderDialog()

    await screen.findByLabelText('Session starts*')
    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '09:00' } })

    expect(screen.getByText('Session end must be after session start.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeDisabled()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('rejects a policy response for another classroom or with extra fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      policy: savedPolicy({
        classroomId: '20000000-0000-4000-8000-000000000002',
        providerId: 'must-not-reach-the-browser-contract',
      }),
    }))
    renderDialog()

    expect(await screen.findByRole('heading', { name: 'Attendance hours unavailable' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Session starts*')).not.toBeInTheDocument()
  })

  it.each([
    {},
    { roster: { outcome: 'applied', revision: 1 }, schedule: { outcome: 'applied', revision: 0 } },
    { roster: { outcome: 'not_required', revision: 0 }, schedule: { outcome: 'not_required', revision: 0 } },
  ])('does not call an unacknowledged schedule delivery successful: %j', async (delivery) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ revision: 2 }) }))
      .mockResolvedValueOnce(jsonResponse(delivery))
    const { onSaved } = renderDialog()
    await screen.findByLabelText('Session starts*')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedPolicy({ revision: 2 }), false))
    expect(screen.getByText('Hours saved; schedule delivery not confirmed')).toBeInTheDocument()
    expect(screen.queryByText('Attendance timing saved')).not.toBeInTheDocument()
  })

  it('ignores a late save after reopening and leaves the new form usable', async () => {
    let finishSave!: (response: Response) => void
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ sessionStartsLocal: '14:00', sessionEndsLocal: '15:00', revision: 3 }) }))
      .mockResolvedValueOnce(jsonResponse({ roster: { outcome: 'duplicate', revision: 1 }, schedule: { outcome: 'duplicate', revision: 2 } }))
    const { onSaved, onClose, rerenderDialog } = renderDialog()
    await screen.findByLabelText('Session starts*')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    rerenderDialog(false)
    rerenderDialog(true)
    expect(await screen.findByDisplayValue('14:00')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeEnabled()
    await act(async () => { finishSave(jsonResponse({ policy: savedPolicy({ revision: 2 }) })) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Session starts*')).toHaveValue('14:00')
  })

  it('ignores a late load from a previous opening', async () => {
    let finishRead!: (response: Response) => void
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRead = resolve }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ sessionStartsLocal: '14:00', sessionEndsLocal: '15:00' }) }))
    const { rerenderDialog } = renderDialog()
    rerenderDialog(false)
    rerenderDialog(true)
    await screen.findByDisplayValue('14:00')
    await act(async () => { finishRead(jsonResponse({ policy: savedPolicy() })) })
    expect(screen.getByLabelText('Session starts*')).toHaveValue('14:00')
  })
})
