import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeacherRosterTab } from '@/app/classrooms/[classroomId]/TeacherRosterTab'
import type { Classroom } from '@/types'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

vi.mock('@/components/AddStudentsModal', () => ({
  AddStudentsModal: () => null,
}))

vi.mock('@/components/UploadRosterModal', () => ({
  UploadRosterModal: () => null,
}))

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Roster Classroom',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const rosterRow = {
  id: 'roster-1',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  student_number: '1001',
  counselor_email: 'counselor@example.com',
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  joined: true,
  student_id: 'student-1',
  joined_at: '2026-01-03T00:00:00.000Z',
}

const secondRosterRow = {
  id: 'roster-2',
  email: 'grace@example.com',
  first_name: 'Grace',
  last_name: 'Hopper',
  student_number: '1002',
  counselor_email: null,
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  joined: true,
  student_id: 'student-2',
  joined_at: '2026-01-03T00:00:00.000Z',
}

function mockJson(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
  }) as any
}

function mockRosterFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
      return mockJson({ roster: [rosterRow, secondRosterRow] })
    }

    if (url === `/api/teacher/classrooms/${classroom.id}/roster/bulk-delete` && method === 'POST') {
      return mockJson({ success: true })
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderRoster(targetClassroom = classroom) {
  return render(
    <TooltipProvider>
      <AppMessageProvider>
        <TeacherRosterTab classroom={targetClassroom} />
      </AppMessageProvider>
    </TooltipProvider>,
  )
}

function renderRosterElement(targetClassroom = classroom) {
  return (
    <TooltipProvider>
      <AppMessageProvider>
        <TeacherRosterTab classroom={targetClassroom} />
      </AppMessageProvider>
    </TooltipProvider>
  )
}

function renderRosterWithFetch(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<any>,
) {
  vi.stubGlobal('fetch', vi.fn(implementation))
  return renderRoster()
}

function getIndividualDeleteCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    return (
      String(input).startsWith(`/api/teacher/classrooms/${classroom.id}/roster/`) &&
      (init as RequestInit | undefined)?.method === 'DELETE'
    )
  })
}

function getBulkDeleteCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    return (
      String(input) === `/api/teacher/classrooms/${classroom.id}/roster/bulk-delete` &&
      (init as RequestInit | undefined)?.method === 'POST'
    )
  })
}

function getRequestBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body))
}

describe('TeacherRosterTab', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    invalidateCachedJSONMatching('teacher-roster:')
    invalidateCachedJSONMatching('auth-me:')
    vi.unstubAllGlobals()
  })

  it('ignores stale roster loads after switching classrooms', async () => {
    const secondClassroom = { ...classroom, id: 'classroom-2', title: 'Second Roster' }
    let resolveFirstRoster: (() => void) | null = null

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        return new Promise((resolve) => {
          resolveFirstRoster = () => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ roster: [rosterRow] }),
          })
        })
      }

      if (url === `/api/teacher/classrooms/${secondClassroom.id}/roster` && method === 'GET') {
        return mockJson({ roster: [secondRosterRow] })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = renderRoster()

    await waitFor(() => {
      expect(resolveFirstRoster).toEqual(expect.any(Function))
    })

    view.rerender(renderRosterElement(secondClassroom))

    expect(await screen.findByText('Grace')).toBeInTheDocument()

    await act(async () => {
      resolveFirstRoster?.()
    })

    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
  })

  it('hides the current roster while the next classroom roster loads', async () => {
    const secondClassroom = { ...classroom, id: 'classroom-2', title: 'Second Roster' }
    let resolveSecondRoster: (() => void) | null = null

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        return mockJson({ roster: [rosterRow] })
      }

      if (url === `/api/teacher/classrooms/${secondClassroom.id}/roster` && method === 'GET') {
        return new Promise((resolve) => {
          resolveSecondRoster = () => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ roster: [secondRosterRow] }),
          })
        })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = renderRoster()

    expect(await screen.findByText('Ada')).toBeInTheDocument()

    view.rerender(renderRosterElement(secondClassroom))

    expect(screen.queryByText('Ada')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(resolveSecondRoster).toEqual(expect.any(Function))
    })
    await act(async () => {
      resolveSecondRoster?.()
    })

    expect(await screen.findByText('Grace')).toBeInTheDocument()
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
  })

  it('distinguishes a failed roster read from an empty roster and retries in place', async () => {
    const user = userEvent.setup()
    let resolveRetry: (() => void) | null = null
    let rosterAttempts = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        rosterAttempts += 1
        if (rosterAttempts === 1) {
          return mockJson({ error: 'Roster service unavailable' }, false)
        }
        return new Promise((resolve) => {
          resolveRetry = () => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ roster: [rosterRow, secondRosterRow] }),
          })
        })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))

    renderRoster()

    expect(await screen.findByRole('alert')).toHaveTextContent('Roster unavailable')
    expect(screen.queryByText('No students on the roster')).not.toBeInTheDocument()

    const retry = screen.getByRole('button', { name: 'Retry loading roster' })
    retry.focus()
    await user.click(retry)

    expect(screen.getByRole('button', { name: 'Retrying roster' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Retrying roster' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await act(async () => {
      resolveRetry?.()
    })

    expect(await screen.findByText('Ada')).toBeInTheDocument()
  })

  it('renders the roster without a summary inspector pane', async () => {
    mockRosterFetch()

    renderRoster()

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Classroom roster' })).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowUp ArrowDown Home End Escape',
    )
    fireEvent.click(screen.getByText('Ada'))
    const selectedRow = screen.getByRole('row', { name: /Ada Lovelace/ })
    expect(selectedRow).toHaveAttribute('id', 'roster-student-row-roster-1')
    expect(selectedRow).toHaveAttribute('aria-selected', 'true')
    expect(selectedRow).toHaveAttribute('tabindex', '-1')
    expect(screen.queryByText('Roster Summary')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize Roster panes' })).not.toBeInTheDocument()
  })

  it('uses shared sorting, selection, and resizable column behavior', async () => {
    const user = userEvent.setup()
    mockRosterFetch()

    renderRoster()

    await screen.findByText('Ada')

    expect(screen.getByRole('separator', { name: 'Resize First column' })).toHaveAttribute(
      'aria-valuenow',
      '96',
    )
    expect(screen.getByRole('separator', { name: 'Resize Email column' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize Counselor column' })).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize First column' }), { key: 'Home' })
    expect(screen.getByRole('separator', { name: 'Resize First column' })).toHaveAttribute(
      'aria-valuenow',
      '64',
    )

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    expect(screen.getByRole('checkbox', { name: 'Select all students' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )

    await user.click(screen.getByRole('button', { name: 'Email' }))
    expect(screen.getByRole('columnheader', { name: 'Email' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await user.click(screen.getByRole('button', { name: 'Email' }))
    expect(screen.getByRole('columnheader', { name: 'Email' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('supports direct roster row navigation and Escape focus recovery', async () => {
    mockRosterFetch()
    renderRoster()

    await screen.findByText('Ada')
    const rosterRegion = screen.getByRole('region', { name: 'Classroom roster' })
    rosterRegion.focus()

    fireEvent.keyDown(rosterRegion, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getByRole('row', { name: /Grace Hopper/ })).toHaveFocus()
    })
    expect(screen.getByRole('row', { name: /Grace Hopper/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.keyDown(screen.getByRole('row', { name: /Grace Hopper/ }), { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getByRole('row', { name: /Ada Lovelace/ })).toHaveFocus()
    })

    fireEvent.keyDown(screen.getByRole('row', { name: /Ada Lovelace/ }), { key: 'Escape' })
    expect(rosterRegion).toHaveFocus()
    expect(screen.getByRole('row', { name: /Ada Lovelace/ })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('keeps a failed counselor save scoped to its editor and restores focus after retry', async () => {
    const user = userEvent.setup()
    let counselorAttempts = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        return mockJson({ roster: [rosterRow, secondRosterRow] })
      }
      if (url === `/api/teacher/classrooms/${classroom.id}/roster/${rosterRow.id}` && method === 'PATCH') {
        counselorAttempts += 1
        return counselorAttempts === 1
          ? mockJson({ error: 'Counselor save failed' }, false)
          : mockJson({ id: rosterRow.id, counselor_email: 'new-counselor@example.com' })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))

    renderRoster()
    await user.click(await screen.findByRole('button', {
      name: 'Edit counselor email for Ada Lovelace',
    }))

    const input = screen.getByRole('textbox', { name: 'Counselor email for Ada Lovelace' })
    await user.clear(input)
    await user.type(input, 'new-counselor@example.com')
    await user.click(screen.getByRole('button', { name: 'Save counselor email for Ada Lovelace' }))

    const editorAlert = await screen.findByRole('alert')
    expect(editorAlert).toHaveTextContent('Counselor save failed')
    expect(screen.getByRole('textbox', { name: 'Counselor email for Ada Lovelace' })).toHaveValue(
      'new-counselor@example.com',
    )

    await user.click(screen.getByRole('button', { name: 'Save counselor email for Ada Lovelace' }))

    const editTrigger = await screen.findByRole('button', {
      name: 'Edit counselor email for Ada Lovelace',
    })
    await waitFor(() => expect(editTrigger).toHaveFocus())
    expect(editTrigger).toHaveTextContent('new-counselor@example.com')
  })

  it('does not let an older counselor save close a newer row editor', async () => {
    const user = userEvent.setup()
    let resolveAdaSave: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        return mockJson({ roster: [rosterRow, secondRosterRow] })
      }
      if (url === `/api/teacher/classrooms/${classroom.id}/roster/${rosterRow.id}` && method === 'PATCH') {
        return new Promise((resolve) => {
          resolveAdaSave = () => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ id: rosterRow.id, counselor_email: 'ada-new@example.com' }),
          })
        })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))

    renderRoster()
    await user.click(await screen.findByRole('button', {
      name: 'Edit counselor email for Ada Lovelace',
    }))
    const adaInput = screen.getByRole('textbox', { name: 'Counselor email for Ada Lovelace' })
    await user.clear(adaInput)
    await user.type(adaInput, 'ada-new@example.com')
    await user.click(screen.getByRole('button', { name: 'Save counselor email for Ada Lovelace' }))

    await user.click(screen.getByRole('button', {
      name: 'Edit counselor email for Grace Hopper',
    }))
    expect(screen.getByRole('textbox', { name: 'Counselor email for Grace Hopper' })).toBeInTheDocument()

    await act(async () => {
      resolveAdaSave?.()
    })

    expect(screen.getByRole('textbox', { name: 'Counselor email for Grace Hopper' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit counselor email for Ada Lovelace' }))
      .toHaveTextContent('ada-new@example.com')
  })

  it('rejects a counselor save from an earlier visit to the same classroom', async () => {
    const user = userEvent.setup()
    const secondClassroom = { ...classroom, id: 'classroom-2', title: 'Second Roster' }
    let resolveOldSave: (() => void) | null = null
    let firstClassroomLoads = 0
    const view = renderRosterWithFetch((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        firstClassroomLoads += 1
        return mockJson({
          roster: [{
            ...rosterRow,
            counselor_email: firstClassroomLoads === 1
              ? 'counselor@example.com'
              : 'current@example.com',
          }],
        })
      }
      if (url === `/api/teacher/classrooms/${secondClassroom.id}/roster` && method === 'GET') {
        return mockJson({ roster: [secondRosterRow] })
      }
      if (url === `/api/teacher/classrooms/${classroom.id}/roster/${rosterRow.id}` && method === 'PATCH') {
        return new Promise((resolve) => {
          resolveOldSave = () => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ id: rosterRow.id, counselor_email: 'stale@example.com' }),
          })
        })
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`)
    })

    await user.click(await screen.findByRole('button', {
      name: 'Edit counselor email for Ada Lovelace',
    }))
    const input = screen.getByRole('textbox', { name: 'Counselor email for Ada Lovelace' })
    await user.clear(input)
    await user.type(input, 'stale@example.com')
    await user.click(screen.getByRole('button', { name: 'Save counselor email for Ada Lovelace' }))

    view.rerender(renderRosterElement(secondClassroom))
    expect(await screen.findByText('Grace')).toBeInTheDocument()
    invalidateCachedJSONMatching(`teacher-roster:${classroom.id}`)
    view.rerender(renderRosterElement(classroom))
    expect(await screen.findByText('current@example.com')).toBeInTheDocument()

    await act(async () => {
      resolveOldSave?.()
    })

    expect(screen.getByText('current@example.com')).toBeInTheDocument()
    expect(screen.queryByText('stale@example.com')).not.toBeInTheDocument()
  })

  it('opens single-student removal from the roster actions menu with confirmation', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRosterFetch()

    renderRoster()

    await screen.findByText('Ada')

    await user.click(screen.getByText('Ada'))

    expect(screen.queryByRole('button', { name: /^Remove$/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove student' }))

    expect(getBulkDeleteCalls(fetchMock)).toHaveLength(0)

    const dialog = screen.getByRole('dialog', { name: 'Remove student?' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/ada@example\.com/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(getBulkDeleteCalls(fetchMock)).toHaveLength(1)
    })
    expect(getRequestBody(getBulkDeleteCalls(fetchMock)[0]).roster_ids).toEqual([rosterRow.id])
    expect(getIndividualDeleteCalls(fetchMock)).toHaveLength(0)
  })

  it('shows comprehensive purge only for one rollout-enabled joined student', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        return mockJson({
          roster: [rosterRow, secondRosterRow],
          student_purge_enabled_ids: [rosterRow.student_id],
        })
      }
      if (url === `/api/teacher/classrooms/${classroom.id}/students/${rosterRow.student_id}/purge`) {
        return mockJson({
          impact: {
            classroom_id: '10000000-0000-4000-8000-000000000001',
            classroom_title: classroom.title,
            student_id: '20000000-0000-4000-8000-000000000001',
            student_email: rosterRow.email,
            source_revision: 1,
            storage_inventory_sha256: 'a'.repeat(64),
            relational_inventory_sha256: 'b'.repeat(64),
            relational_row_count: 2,
            managed_file_count: 0,
            managed_file_bytes: 0,
            archive_count: 0,
            gradex_extract_count: 0,
            resource_counts: {}, storage_counts: {}, conflicting_operation: null,
            deletion_available: true, unavailable_reason: null,
          },
          operation: null,
        })
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))
    renderRoster()
    await user.click(await screen.findByText('Ada'))
    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Purge classroom data' }))
    expect(await screen.findByRole('dialog', { name: 'Purge this student’s classroom data?' }))
      .toHaveTextContent(/data in other classrooms are kept/i)
  })

  it('keeps purge available for a hot-archived Classroom while ordinary roster edits stay disabled', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/api/teacher/classrooms/${classroom.id}/roster`) {
        return mockJson({ roster: [rosterRow], student_purge_enabled_ids: [rosterRow.student_id] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
    renderRoster({ ...classroom, archived_at: '2026-08-01T00:00:00.000Z' })
    await user.click(await screen.findByText('Ada'))
    expect(screen.getByRole('button', { name: 'Add students' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    expect(screen.getByRole('menuitem', { name: 'Remove student' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Purge classroom data' })).toBeEnabled()
  })

  it('shows and confirms removal for multiple checked students from the roster actions menu', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRosterFetch()

    renderRoster()

    await screen.findByText('Ada')

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))
    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove students' }))

    expect(getBulkDeleteCalls(fetchMock)).toHaveLength(0)

    const dialog = screen.getByRole('dialog', { name: 'Remove students?' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/ada@example\.com/)).toBeInTheDocument()
    expect(within(dialog).getByText(/grace@example\.com/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(getBulkDeleteCalls(fetchMock)).toHaveLength(1)
    })
    expect(getRequestBody(getBulkDeleteCalls(fetchMock)[0]).roster_ids).toEqual(
      expect.arrayContaining([rosterRow.id, secondRosterRow.id])
    )
    expect(getIndividualDeleteCalls(fetchMock)).toHaveLength(0)
  })

  it('keeps roster management separate from selected-student email actions', async () => {
    const user = userEvent.setup()
    mockRosterFetch()

    renderRoster()

    await screen.findByText('Ada')

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))

    expect(screen.getByRole('button', { name: 'Add students' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Email \(2\)/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    expect(screen.getByRole('menuitem', { name: '+ CSV' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove students' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy emails (2)' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Gmail' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Outlook' })).toBeInTheDocument()
  })

  it('keeps the full selected set pending when bulk removal fails', async () => {
    const user = userEvent.setup()
    let failBulkOnce = true
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        return mockJson({ roster: [rosterRow, secondRosterRow] })
      }

      if (url === `/api/teacher/classrooms/${classroom.id}/roster/bulk-delete` && method === 'POST') {
        if (failBulkOnce) {
          failBulkOnce = false
          return mockJson({ error: 'Failed to remove students' }, false)
        }
        return mockJson({ success: true })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoster()

    await screen.findByText('Ada')

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))
    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove students' }))

    const multiDialog = screen.getByRole('dialog', { name: 'Remove students?' })
    await user.click(within(multiDialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to remove students')).toBeInTheDocument()
    })

    const retryDialog = screen.getByRole('dialog', { name: 'Remove students?' })
    expect(within(retryDialog).getByRole('alert')).toHaveTextContent('Failed to remove students')
    expect(retryDialog).toContainElement(document.activeElement as HTMLElement)
    expect(within(retryDialog).getByText(/ada@example\.com/)).toBeInTheDocument()
    expect(within(retryDialog).getByText(/grace@example\.com/)).toBeInTheDocument()

    await user.click(within(retryDialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    expect(getBulkDeleteCalls(fetchMock)).toHaveLength(2)
    expect(getIndividualDeleteCalls(fetchMock)).toHaveLength(0)
  })

  it('keeps the committed post-removal roster visible when its refresh fails', async () => {
    const user = userEvent.setup()
    let rosterLoads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        rosterLoads += 1
        return rosterLoads === 1
          ? mockJson({ roster: [rosterRow, secondRosterRow] })
          : mockJson({ error: 'Roster refresh failed' }, false)
      }
      if (url === `/api/teacher/classrooms/${classroom.id}/roster/bulk-delete` && method === 'POST') {
        return mockJson({ success: true })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))

    renderRoster()
    await user.click(await screen.findByText('Ada'))
    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove student' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Remove student?' }))
      .getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Roster refresh failed')
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.queryByText('No students on the roster')).not.toBeInTheDocument()
  })
})
