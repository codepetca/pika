import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'

afterEach(() => { invalidateCachedJSONMatching(''); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const student = { student_id: 's1', student_email: 'student@school.ca', student_first_name: 'Demo', student_last_name: 'Student', final_percent: null }

function renderGradebook() {
  return render(<AppMessageProvider><TooltipProvider><TeacherGradebookTab classroom={createMockClassroom()} /></TooltipProvider></AppMessageProvider>)
}

async function openCopyMenu() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Demo Student' }))
  fireEvent.click(screen.getByRole('button', { name: '1 selected' }))
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Copy email 2' })).toBeEnabled())
}

function mockRequests(email: string | null) {
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/roster')
    ? { roster: [{ student_id: 's1', counselor_email: email }, { student_id: 's2', counselor_email: 'not-selected@school.ca' }] }
    : { categories: [], assessment_columns: [], students: [student] },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Gradebook Email 2 copy command', () => {
  it('writes selected prefetched addresses directly from the click without another fetch', async () => {
    const fetchMock = mockRequests('counselor@school.ca')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderGradebook()
    await openCopyMenu()
    const calls = fetchMock.mock.calls.length
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy email 2' }))
    // Synchronous assertion: no awaited network/microtask before clipboard write.
    expect(writeText).toHaveBeenCalledWith('counselor@school.ca')
    expect(fetchMock).toHaveBeenCalledTimes(calls)
    await screen.findByText('Email 2 addresses copied')
  })

  it('does not overwrite the clipboard when selected students have no Email 2', async () => {
    mockRequests(null)
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderGradebook()
    await openCopyMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy email 2' }))
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.getByText('No email 2 addresses for selected students')).toBeInTheDocument()
  })

  it('reports clipboard failure without a false success message', async () => {
    mockRequests('counselor@school.ca')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(false) })
    renderGradebook()
    await openCopyMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy email 2' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy email 2 addresses')
    expect(screen.queryByText('Email 2 addresses copied')).not.toBeInTheDocument()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('keeps grades usable when roster loading fails and exposes a working retry', async () => {
    let rosterAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/roster')) {
        rosterAttempts += 1
        if (rosterAttempts === 1) throw new Error('Offline')
        return { ok: true, json: async () => ({ roster: [] }) }
      }
      return { ok: true, json: async () => ({ categories: [], assessment_columns: [], students: [student] }) }
    }))
    renderGradebook()
    expect(await screen.findByText('Demo')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Grades are still available')
    fireEvent.click(screen.getByRole('button', { name: 'Retry Email 2' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(rosterAttempts).toBe(2)
  })
})
