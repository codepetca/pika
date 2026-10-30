import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AttendanceWindowDialog } from '@/app/classrooms/[classroomId]/AttendanceWindowDialog'
import { AppMessageProvider, TooltipProvider } from '@/ui'

vi.mock('@/lib/timezone', () => ({ getTodayInToronto: () => '2026-08-17' }))
const classroomId = '10000000-0000-4000-8000-000000000001'
const policy = {
  classroomId, timezone: 'America/Toronto', sessionStartsLocal: '08:45', sessionEndsLocal: '09:45',
  sessionEndDayOffset: 0, entryOpensMinutesBefore: 10, presentGraceMinutes: 5,
  entryClosesMinutesBeforeEnd: 0, absentMinutesBeforeEnd: 0, enabled: true,
  revision: 3, updatedAt: '2026-08-17T12:00:00.000Z',
}
const schedules = { schedules: [
  { id: null, name: 'Regular schedule', policy },
  { id: 'alternate', name: 'Assembly', policy: { ...policy, sessionStartsLocal: '10:00', sessionEndsLocal: '11:00' } },
], selectedId: null }
const delivery = { roster: { outcome: 'applied', revision: 4 }, schedule: { outcome: 'applied', revision: 4 } }
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function renderDialog(date = '2026-08-18') {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(<TooltipProvider><AppMessageProvider><AttendanceWindowDialog classroomId={classroomId} date={date} isOpen onSaved={onSaved} onClose={onClose} /></AppMessageProvider></TooltipProvider>)
  return { onSaved, onClose }
}

describe('AttendanceWindowDialog', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('loads schedules for the selected date and applies the chosen schedule only after delivery', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(schedules)).mockResolvedValueOnce(response({ id: 'alternate', revision: 4 })).mockResolvedValueOnce(response(delivery))
    const { onSaved, onClose } = renderDialog()
    fireEvent.click(await screen.findByRole('radio', { name: /Assembly/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onSaved).toHaveBeenCalledWith(policy, true)
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('date=2026-08-18')
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ classroom_id: classroomId, date: '2026-08-18', schedule_id: 'alternate', expected_revision: 3 })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toEqual({ classroom_id: classroomId, window_start: '2026-08-18', window_end: '2026-08-18' })
  })

  it('selects a schedule with the keyboard', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(schedules))
    const user = userEvent.setup()
    renderDialog()
    const regular = await screen.findByRole('radio', { name: /Regular schedule/ })
    regular.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: /Assembly/ })).toBeChecked()
  })

  it('reports unconfirmed delivery and does not claim selection was applied', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(schedules)).mockResolvedValueOnce(response({ id: 'alternate', revision: 4 })).mockRejectedValueOnce(new Error('network'))
    const { onSaved, onClose } = renderDialog()
    fireEvent.click(await screen.findByRole('radio', { name: /Assembly/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('delivery was not confirmed')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('retries delivery for an already selected schedule without writing the assignment', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...schedules, selectedId: 'alternate' })).mockResolvedValueOnce(response(delivery))
    const { onClose } = renderDialog()
    expect(await screen.findByRole('radio', { name: /Assembly/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2)
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/teacher/attendance/sync')
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ window_start: '2026-08-18', window_end: '2026-08-18' })
  })

  it('edits an alternative with the current revision and reloads the picker', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(schedules)).mockResolvedValueOnce(response({ id: 'alternate', revision: 4 })).mockResolvedValueOnce(response(delivery)).mockResolvedValueOnce(response(schedules))
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Assembly settings' }))
    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '10:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    await screen.findByRole('radio', { name: /Assembly/ })
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(body).toMatchObject({ classroom_id: classroomId, id: 'alternate', name: 'Assembly', expected_revision: 3, policy: { sessionStartsLocal: '10:15' } })
  })

  it('retries delivery after creating a schedule without creating it twice', async () => {
    const created = { id: 'short-day', name: 'Short day', policy }
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(schedules))
      .mockResolvedValueOnce(response({ id: created.id, revision: 4 }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(response(delivery))
      .mockResolvedValueOnce(response({ ...schedules, schedules: [...schedules.schedules, created] }))
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }))
    fireEvent.change(screen.getByLabelText('Schedule name*'), { target: { value: created.name } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('delivery was not confirmed')
    expect(screen.getByLabelText('Schedule name*')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery' }))
    expect(await screen.findByRole('radio', { name: /Short day/ })).toBeInTheDocument()
    const posts = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === '/api/teacher/attendance/schedules' && init?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/teacher/attendance/sync')).toHaveLength(2)
  })

  it('retains a newly created schedule in the picker after delivery fails and Back is pressed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(schedules)).mockResolvedValueOnce(response({ id: 'short-day', revision: 4 })).mockRejectedValueOnce(new Error('network'))
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }))
    fireEvent.change(screen.getByLabelText('Schedule name*'), { target: { value: 'Short day' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('radio', { name: /Short day/ })).toBeInTheDocument()
  })

  it('loads the persisted schedule after closing and reopening following a delivery failure', async () => {
    const created = { id: 'short-day', name: 'Short day', policy }
    vi.mocked(fetch).mockResolvedValueOnce(response(schedules)).mockResolvedValueOnce(response({ id: created.id, revision: 4 })).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(response({ ...schedules, schedules: [...schedules.schedules, created] }))
    const dialog = (isOpen: boolean) => <TooltipProvider><AppMessageProvider><AttendanceWindowDialog classroomId={classroomId} date="2026-08-18" isOpen={isOpen} onSaved={vi.fn()} onClose={vi.fn()} /></AppMessageProvider></TooltipProvider>
    const view = render(dialog(true))
    fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }))
    fireEvent.change(screen.getByLabelText('Schedule name*'), { target: { value: created.name } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    await screen.findByRole('alert')
    view.rerender(dialog(false))
    view.rerender(dialog(true))
    expect(await screen.findByRole('radio', { name: /Short day/ })).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === '/api/teacher/attendance/schedules' && init?.method === 'POST')).toHaveLength(1)
  })

  it('allows setting up regular timing when no policy exists', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ schedules: [], selectedId: null })).mockResolvedValueOnce(response({ policy })).mockResolvedValueOnce(response(delivery)).mockResolvedValueOnce(response(schedules))
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))
    expect(screen.getByLabelText('Session starts*')).toHaveValue('09:00')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    await screen.findByRole('radio', { name: /Regular schedule/ })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ classroom_id: classroomId, expected_revision: null })
  })

  it('prevents invalid timing and requires a name for a new schedule', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(schedules))
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }))
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Schedule name*'), { target: { value: 'Short day' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '08:00' } })
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeDisabled()
    expect(screen.getByText('Session end must be after session start.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledOnce()
  })
})

import { act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'








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

function scheduleResponse(value: { policy: ReturnType<typeof savedPolicy> | null }) {
  return jsonResponse({ schedules: value.policy ? [{ id: null, name: 'Regular schedule', policy: value.policy }] : [], selectedId: null })
}

function renderTimingDialog(onSaved = vi.fn(), onClose = vi.fn()) {
  const dialog = (isOpen: boolean) => (
    <TooltipProvider>
      <AppMessageProvider>
        <AttendanceWindowDialog
          classroomId={classroomId}
          date="2026-08-17"
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

describe('AttendanceWindowDialog timing regressions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('starts with durable defaults, saves the policy, and syncs the next 90 days', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(scheduleResponse({ policy: null }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({
        roster: { outcome: 'applied', revision: 1 },
        schedule: { outcome: 'applied', revision: 1 },
      }))
    const { onSaved, onClose } = renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    expect(await screen.findByLabelText('Session starts*')).toHaveValue('09:00')
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '08:45' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '09:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).not.toHaveBeenCalled()

    const policyWrite = vi.mocked(fetch).mock.calls[1]
    expect(policyWrite[0]).toBe('/api/teacher/attendance/policy')
    expect(JSON.parse(String(policyWrite[1]?.body))).toEqual({
      classroom_id: classroomId,
      session_starts_local: '08:45',
      session_ends_local: '09:15',
      session_end_day_offset: 0,
      entry_opens_minutes_before: 10,
      present_grace_minutes: 5,
      entry_closes_minutes_before_end: 0,
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
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy({ revision: 4 }) }))
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
    const { onSaved } = renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    expect(await screen.findByLabelText('Session starts*')).toHaveValue('08:45')
    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '23:30' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '00:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
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
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy({ enabled: false, revision: 7 }) }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ enabled: true, revision: 8 }) }))
      .mockResolvedValueOnce(jsonResponse({
        roster: { outcome: 'applied', revision: 1 },
        schedule: { outcome: 'applied', revision: 2 },
      }))
    const { onSaved } = renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    const automaticToggle = await screen.findByRole('checkbox', {
      name: 'Open and close QR attendance automatically',
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

  it('uses concise timing guidance and option-specific end-day tooltips', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy() }))
    renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    await screen.findByDisplayValue('08:45')

    expect(screen.getByLabelText('Grace period before late (min)')).toBeInTheDocument()
    expect(screen.queryByText(/A scan at the Present cutoff/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Open and close QR attendance automatically' })).toBeInTheDocument()

    const sameDay = screen.getByRole('button', { name: 'Same class day' })
    fireEvent.pointerMove(sameDay, { pointerType: 'mouse' })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Class end on the same day')
    fireEvent.pointerLeave(sameDay)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())

    const nextDay = screen.getByRole('button', { name: 'Next day' })
    fireEvent.focus(nextDay)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Class ends the next day after midnight')
    fireEvent.blur(nextDay)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('hard-clamps timing rules to the approved bounds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy() }))
    renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    const opens = await screen.findByLabelText('QR opens before start (min)')
    const grace = screen.getByLabelText('Grace period before late (min)')
    const closes = screen.getByLabelText('QR closes before end (min)')
    const absent = screen.getByLabelText('Absent before end (min)')

    expect(opens).toHaveAttribute('max', '120')
    expect(grace).toHaveAttribute('max', '30')
    expect(closes).toHaveAttribute('max', '30')
    expect(absent).toHaveAttribute('max', '30')

    fireEvent.change(opens, { target: { value: '999' } })
    fireEvent.change(grace, { target: { value: '999' } })
    fireEvent.change(closes, { target: { value: '999' } })
    fireEvent.change(absent, { target: { value: '-5' } })

    expect(opens).toHaveValue(120)
    expect(grace).toHaveValue(30)
    expect(closes).toHaveValue(30)
    expect(absent).toHaveValue(0)
  })

  it('replaces the selected zero value and hides native number steppers', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy() }))
    const user = userEvent.setup()
    renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    const numericInputs = [
      await screen.findByLabelText('QR opens before start (min)'),
      screen.getByLabelText('Grace period before late (min)'),
      screen.getByLabelText('QR closes before end (min)'),
      screen.getByLabelText('Absent before end (min)'),
    ]

    for (const input of numericInputs) {
      expect(input).toHaveClass(
        '[appearance:textfield]',
        '[&::-webkit-inner-spin-button]:appearance-none',
        '[&::-webkit-outer-spin-button]:appearance-none',
      )
    }

    const absent = numericInputs[3]
    await user.tab()
    while (document.activeElement !== absent) await user.tab()
    await user.keyboard('5')

    expect(absent).toHaveValue(5)
    expect(absent).not.toHaveDisplayValue('05')

    fireEvent.change(absent, { target: { value: '05' } })
    expect(absent).toHaveValue(5)
    expect(absent).not.toHaveDisplayValue('05')
  })

  it('keeps the saved policy and reports recovery when immediate sync is unavailable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ revision: 2 }) }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Attendance is temporarily unavailable' }, 503))
    const { onSaved, onClose } = renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    await screen.findByDisplayValue('08:45')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Timing saved, but schedule delivery was not confirmed.')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(savedPolicy({ revision: 2 }), false)
  })

  it('blocks an invalid same-day window before any write', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(scheduleResponse({ policy: null }))
    renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    await screen.findByLabelText('Session starts*')
    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '09:00' } })

    expect(screen.getByText('Session end must be after session start.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeDisabled()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('blocks sessions over 12 hours and allows the exact boundary', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(scheduleResponse({ policy: null }))
    renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))

    await screen.findByLabelText('Session starts*')
    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '19:59' } })
    fireEvent.change(screen.getByLabelText('Session ends*'), { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))

    expect(screen.getByText('Maximum is 12 hours.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Session starts*'), { target: { value: '20:00' } })
    expect(screen.queryByText('Maximum is 12 hours.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeEnabled()
    expect(screen.getByLabelText('Grace period before late (min)')).toHaveAttribute('max', '720')
  })

  it('rejects a policy response for another classroom or with extra fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(scheduleResponse({
      policy: savedPolicy({
        classroomId: '20000000-0000-4000-8000-000000000002',
        providerId: 'must-not-reach-the-browser-contract',
      }),
    }))
    renderTimingDialog()

    expect(await screen.findByRole('heading', { name: 'Attendance hours unavailable' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Session starts*')).not.toBeInTheDocument()
  })

  it.each([
    {},
    { roster: { outcome: 'applied', revision: 1 }, schedule: { outcome: 'applied', revision: 0 } },
    { roster: { outcome: 'not_required', revision: 0 }, schedule: { outcome: 'not_required', revision: 0 } },
  ])('does not call an unacknowledged schedule delivery successful: %j', async (delivery) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ revision: 2 }) }))
      .mockResolvedValueOnce(jsonResponse(delivery))
    const { onSaved } = renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))
    await screen.findByLabelText('Session starts*')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedPolicy({ revision: 2 }), false))
    expect(screen.getByText('Timing saved, but schedule delivery was not confirmed.')).toBeInTheDocument()
    expect(screen.queryByText('Attendance timing saved')).not.toBeInTheDocument()
  })

  it('ignores a late save after reopening and leaves the new form usable', async () => {
    let finishSave!: (response: Response) => void
    vi.mocked(fetch)
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy() }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve }))
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy({ sessionStartsLocal: '14:00', sessionEndsLocal: '15:00', revision: 3 }) }))
      .mockResolvedValueOnce(jsonResponse({ roster: { outcome: 'duplicate', revision: 1 }, schedule: { outcome: 'duplicate', revision: 2 } }))
    const { onSaved, onClose, rerenderDialog } = renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))
    await screen.findByLabelText('Session starts*')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    rerenderDialog(false)
    rerenderDialog(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))
    expect(await screen.findByDisplayValue('14:00')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save timing' })).toBeEnabled()
    await act(async () => { finishSave(jsonResponse({ policy: savedPolicy({ revision: 2 }) })) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Session starts*')).toHaveValue('14:00')
  })

  it('blocks Escape and backdrop dismissal until persistence and delivery finish', async () => {
    let finishSave!: (response: Response) => void
    let finishSync!: (response: Response) => void
    vi.mocked(fetch)
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy() }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSync = resolve }))
    const { onSaved, onClose } = renderTimingDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))
    await screen.findByLabelText('Session starts*')
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    await act(async () => { finishSave(jsonResponse({ policy: savedPolicy({ revision: 2 }) })) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { finishSync(jsonResponse({ error: 'Unavailable' }, 503)) })
    expect(onSaved).toHaveBeenCalledWith(savedPolicy({ revision: 2 }), false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a late load from a previous opening', async () => {
    let finishRead!: (response: Response) => void
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRead = resolve }))
      .mockResolvedValueOnce(scheduleResponse({ policy: savedPolicy({ sessionStartsLocal: '14:00', sessionEndsLocal: '15:00' }) }))
    const { rerenderDialog } = renderTimingDialog()
    rerenderDialog(false)
    rerenderDialog(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Regular schedule settings' }))
    await screen.findByDisplayValue('14:00')
    await act(async () => { finishRead(scheduleResponse({ policy: savedPolicy() })) })
    expect(screen.getByLabelText('Session starts*')).toHaveValue('14:00')
  })
})
