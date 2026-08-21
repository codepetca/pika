import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AttendanceWindowDialog } from '@/app/classrooms/[classroomId]/AttendanceWindowDialog'
import { AppMessageProvider } from '@/ui'

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
    opensLocal: '08:45',
    closesLocal: '09:15',
    closeDayOffset: 0,
    enabled: true,
    revision: 1,
    updatedAt: '2026-08-17T12:00:00.000Z',
    ...overrides,
  }
}

function renderDialog(onSaved = vi.fn(), onClose = vi.fn()) {
  render(
    <AppMessageProvider>
      <AttendanceWindowDialog
        classroomId={classroomId}
        isOpen
        onSaved={onSaved}
        onClose={onClose}
      />
    </AppMessageProvider>,
  )
  return { onSaved, onClose }
}

describe('AttendanceWindowDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('requires explicit times, saves the policy, and syncs the next 90 days', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: null }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({
        roster: { outcome: 'applied', revision: 1 },
        schedule: { outcome: 'applied', revision: 1 },
      }))
    const { onSaved, onClose } = renderDialog()

    expect(await screen.findByLabelText('Opens*')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Opens*'), { target: { value: '08:45' } })
    fireEvent.change(screen.getByLabelText('Closes*'), { target: { value: '09:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('Attendance hours saved')).toBeInTheDocument()

    const policyWrite = vi.mocked(fetch).mock.calls[1]
    expect(policyWrite[0]).toBe('/api/teacher/attendance/policy')
    expect(JSON.parse(String(policyWrite[1]?.body))).toEqual({
      classroom_id: classroomId,
      opens_local: '08:45',
      closes_local: '09:15',
      close_day_offset: 0,
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
          opensLocal: '23:30',
          closesLocal: '00:30',
          closeDayOffset: 1,
          revision: 5,
        }),
      }))
      .mockResolvedValueOnce(jsonResponse({
        roster: { outcome: 'applied', revision: 1 },
        schedule: { outcome: 'applied', revision: 2 },
      }))
    const { onSaved } = renderDialog()

    expect(await screen.findByLabelText('Opens*')).toHaveValue('08:45')
    fireEvent.change(screen.getByLabelText('Opens*'), { target: { value: '23:30' } })
    fireEvent.change(screen.getByLabelText('Closes*'), { target: { value: '00:30' } })
    fireEvent.change(screen.getByLabelText('Closing day'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toMatchObject({
      opens_local: '23:30',
      closes_local: '00:30',
      close_day_offset: 1,
      expected_revision: 4,
    })
  })

  it('keeps the saved policy and reports recovery when immediate sync is unavailable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy() }))
      .mockResolvedValueOnce(jsonResponse({ policy: savedPolicy({ revision: 2 }) }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Attendance is temporarily unavailable' }, 503))
    const { onSaved, onClose } = renderDialog()

    await screen.findByDisplayValue('08:45')
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('Hours saved; automatic schedule sync will retry')).toBeInTheDocument()
  })

  it('blocks an invalid same-day window before any write', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ policy: null }))
    renderDialog()

    await screen.findByLabelText('Opens*')
    fireEvent.change(screen.getByLabelText('Opens*'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('Closes*'), { target: { value: '09:00' } })

    expect(screen.getByText('Closing time must be after opening time.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeDisabled()
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
    expect(screen.queryByLabelText('Opens*')).not.toBeInTheDocument()
  })
})
