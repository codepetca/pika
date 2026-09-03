import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'

// Address loading/copying has a real-hook integration suite of its own.
vi.mock('@/hooks/useGradebookEmail2', () => ({
  useGradebookEmail2: () => ({ rows: [], loading: false, error: null, reload: vi.fn() }),
}))

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()),
  invalidateCachedJSONMatching: vi.fn(),
}))

function gradebookResponse() {
  return {
    settings: {
      use_weights: false,
      assignments_weight: 50,
      tests_weight: 30,
    },
    categories: [
      { id: '10000000-0000-4000-8000-000000000001', name: 'Attendance', percentage: 10, default_assessment_weight: 10, position: 0, is_default: false },
      { id: '10000000-0000-4000-8000-000000000002', name: 'Term', percentage: 65, default_assessment_weight: 10, position: 1, is_default: true },
      { id: '10000000-0000-4000-8000-000000000003', name: 'Final', percentage: 25, default_assessment_weight: 10, position: 2, is_default: false },
    ],
    assessment_columns: [
      {
        assessment_id: 'assignment-1',
        assessment_type: 'assignment',
        code: 'A1',
        title: 'Essay',
        possible: 10,
        weight: 10,
        include_in_final: true,
        category_id: '10000000-0000-4000-8000-000000000002',
        category_name: 'Term',
        category_percentage: 65,
        exact_course_weight: 32.5,
        due_at: '2025-01-01T12:00:00.000Z',
        is_draft: false,
      },
      {
        assessment_id: 'test-1',
        assessment_type: 'test',
        code: 'T1',
        title: 'Test 1',
        possible: 10,
        weight: 10,
        include_in_final: true,
        category_id: '10000000-0000-4000-8000-000000000002',
        category_name: 'Term',
        category_percentage: 65,
        exact_course_weight: 32.5,
        status: 'closed',
      },
    ],
    students: [
      {
        student_id: 'student-2',
        student_email: 'grace@example.com',
        student_number: '0002',
        student_first_name: 'Grace',
        student_last_name: 'Hopper',
        assignments_earned: 6,
        assignments_possible: 10,
        assignments_percent: 60,
        tests_earned: 8,
        tests_possible: 10,
        tests_percent: 80,
        final_percent: 70,
        assessment_scores: [
          {
            assessment_id: 'assignment-1',
            assessment_type: 'assignment',
            earned: 6,
            possible: 10,
            percent: 60,
            is_graded: true,
          },
          {
            assessment_id: 'test-1',
            assessment_type: 'test',
            earned: 8,
            possible: 10,
            percent: 80,
            is_graded: true,
          },
        ],
      },
      {
        student_id: 'student-1',
        student_email: 'ada@example.com',
        student_number: '1001',
        student_first_name: 'Ada',
        student_last_name: 'Lovelace',
        assignments_earned: 8,
        assignments_possible: 10,
        assignments_percent: 80,
        tests_earned: 9,
        tests_possible: 10,
        tests_percent: 90,
        final_percent: 85,
        assessment_scores: [
          {
            assessment_id: 'assignment-1',
            assessment_type: 'assignment',
            earned: 8,
            possible: 10,
            percent: 80,
            is_graded: true,
            status: 'submitted_late',
          },
          {
            assessment_id: 'test-1',
            assessment_type: 'test',
            earned: 9,
            possible: 10,
            percent: 90,
            is_graded: true,
          },
        ],
      },
    ],
    class_summary: {
      total_students: 2,
      average_final_percent: 77.5,
      assignments: [],
      tests: [],
    },
  }
}

describe('TeacherGradebookTab', () => {
  const classroom = createMockClassroom()
  let fetchMock: ReturnType<typeof vi.fn>
  let clipboardWriteText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.localStorage.clear()
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => gradebookResponse(),
    })
    vi.stubGlobal('fetch', fetchMock)
    clipboardWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderGradebook(sectionParam: 'grades' | 'settings', onSectionChange = vi.fn()) {
    return render(
      <AppMessageProvider>
        <TooltipProvider>
          <TeacherGradebookTab
            classroom={classroom}
            sectionParam={sectionParam}
            onSectionChange={onSectionChange}
          />
        </TooltipProvider>
      </AppMessageProvider>,
    )
  }

  function openGradebookActions() {
    const existingMenu = screen.queryByRole('menu')
    if (existingMenu) return existingMenu

    fireEvent.click(screen.getByRole('button', { name: 'Gradebook more actions' }))
    return screen.getByRole('menu')
  }

  async function renderWeightEditor() {
    const view = renderGradebook('grades')
    await screen.findByText('Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Show weights' }))
    return view
  }

  it('opens the approved compact category and assessment editors', async () => {
    renderGradebook('grades')
    await screen.findByText('Ada')
    fireEvent.click(within(openGradebookActions()).getByRole('menuitem', { name: 'Edit categories' }))
    expect(screen.getByRole('heading', { name: 'Edit categories' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Category name for Attendance' })).toHaveValue('Attendance')
    expect(screen.queryByText('Total:')).not.toBeInTheDocument()
    expect(screen.queryByText('Default item weight')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Term is the default category' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit A1: Essay' }))
    expect(screen.getByRole('heading', { name: 'Edit assessment' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Assessment title' })).toHaveValue('Essay')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('10000000-0000-4000-8000-000000000002')
    expect(screen.getByRole('textbox', { name: 'Course weight' })).toHaveValue('32.5%')
  })

  it('persists display preferences and exposes two weight metadata rows', async () => {
    renderGradebook('grades')
    await screen.findByText('Ada')
    expect(screen.getByRole('button', { name: 'Student Actions' })).toBeDisabled()
    expect(screen.queryByText('1001')).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'Class average' })).toHaveTextContent('70%85%77.5%')
    expect(screen.queryByRole('row', { name: 'Class median' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'x/y' }))
    expect(screen.getByRole('row', { name: /Ada Lovelace.*8[/]10 9[/]10 85[.]0%/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MED' }))
    expect(screen.getByRole('row', { name: 'Class median' })).toBeInTheDocument()
    fireEvent.click(within(openGradebookActions()).getByRole('menuitem', { name: 'Show last name in column 1' }))
    fireEvent.click(within(openGradebookActions()).getByRole('menuitemcheckbox', { name: 'Show student IDs' }))
    expect(screen.getByText('1001')).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader')
    expect(headers[1]).toHaveTextContent('Last')
    const firstResize = screen.getByRole('separator', { name: 'Resize First column' })
    fireEvent.keyDown(firstResize, { key: 'ArrowRight' })
    expect(firstResize).toHaveAttribute('aria-valuenow', '104')
    fireEvent.click(screen.getByRole('button', { name: 'Show weights' }))
    expect(screen.getByRole('row', { name: 'Category weight' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'Course weight' })).toBeInTheDocument()
    expect(screen.getByLabelText('Course weight for Essay')).toHaveTextContent('32.5%')
    expect(JSON.parse(window.localStorage.getItem('teacher-gradebook:display:v1')!)).toMatchObject({
      scoreDisplayMode: 'raw', summaryKind: 'median', lastNameFirst: true, showStudentIds: true, showWeights: true,
    })
  })

  it('supports shared keyboard row navigation and dismissal', async () => {
    renderGradebook('grades')

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    const tableRegion = screen.getByRole('region', { name: 'Gradebook students' })
    expect(tableRegion).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End Escape')

    fireEvent.keyDown(tableRegion, { key: 'End' })
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Ada Lovelace assessment details' })).toBeInTheDocument()
    })
    expect(screen.getByRole('row', { name: /Ada Lovelace.*80% 90% 85\.0%/ })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('row', { name: /Ada Lovelace.*80% 90% 85\.0%/ }), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Ada Lovelace assessment details' })).not.toBeInTheDocument()
  })

  it('distinguishes a cold failure from an empty gradebook and restores focus after retry', async () => {
    let attempts = 0
    let resolveRetry: (() => void) | null = null
    fetchMock.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Gradebook service unavailable' }),
        })
      }
      return new Promise((resolve) => {
        resolveRetry = () => resolve({
          ok: true,
          json: async () => gradebookResponse(),
        })
      })
    })

    renderGradebook('grades')

    expect(await screen.findByText('Gradebook unavailable')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Gradebook service unavailable')
    expect(screen.queryByText('No students enrolled yet')).not.toBeInTheDocument()

    const retry = screen.getByRole('button', { name: 'Retry loading gradebook' })
    retry.focus()
    fireEvent.click(retry)
    expect(screen.getByRole('button', { name: 'Retrying gradebook' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Retrying gradebook' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await act(async () => {
      resolveRetry?.()
    })

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Gradebook students' })).toHaveFocus()
  })

  it('renders a successful empty gradebook without an error', async () => {
    const emptyResponse = gradebookResponse()
    emptyResponse.students = []
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => emptyResponse,
    })

    renderGradebook('grades')

    expect(await screen.findByText('No students enrolled yet')).toBeInTheDocument()
    expect(screen.queryByText('Gradebook unavailable')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('retains the last loaded matrix when a post-save refresh fails', async () => {
    let gradebookReads = 0
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/teacher/gradebook' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ assessment: { gradebook_weight: 20 } }),
        })
      }
      if (url === `/api/teacher/gradebook?classroom_id=${classroom.id}`) {
        gradebookReads += 1
        if (gradebookReads !== 2 && gradebookReads !== 3) {
          return Promise.resolve({ ok: true, json: async () => gradebookResponse() })
        }
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Refresh failed' }),
        })
      }
      throw new Error(`Unhandled fetch: ${init?.method ?? 'GET'} ${url}`)
    })

    await renderWeightEditor()
    const weightInput = await screen.findByRole('spinbutton', { name: 'Category weight for Essay' })
    fireEvent.change(weightInput, { target: { value: '20' } })
    fireEvent.blur(weightInput)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Gradebook could not be refreshed. Showing the last loaded grades.',
    )
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit A1: Essay' })).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry loading gradebook' })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry loading gradebook' })).toHaveFocus()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Gradebook could not be refreshed. Showing the last loaded grades.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading gradebook' }))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Gradebook students' })).toHaveFocus()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refreshes the matrix after each concurrently saved assessment weight', async () => {
    let gradebookReads = 0
    let a1Weight = 10
    let t1Weight = 10
    let resolveA1Save: (() => void) | null = null
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/teacher/gradebook' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as {
          assessment_id: string
          gradebook_weight: number
        }
        if (body.assessment_id === 'assignment-1') {
          return new Promise((resolve) => {
            resolveA1Save = () => {
              a1Weight = body.gradebook_weight
              resolve({ ok: true, json: async () => ({}) })
            }
          })
        }
        t1Weight = body.gradebook_weight
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      if (url === `/api/teacher/gradebook?classroom_id=${classroom.id}`) {
        gradebookReads += 1
        const response = gradebookResponse()
        response.assessment_columns = response.assessment_columns.map((column) => ({
          ...column,
          weight: column.assessment_id === 'assignment-1' ? a1Weight : t1Weight,
        }))
        return Promise.resolve({ ok: true, json: async () => response })
      }
      throw new Error(`Unhandled fetch: ${init?.method ?? 'GET'} ${url}`)
    })

    await renderWeightEditor()
    const a1Input = await screen.findByRole('spinbutton', { name: 'Category weight for Essay' })
    const t1Input = screen.getByRole('spinbutton', { name: 'Category weight for Test 1' })
    fireEvent.change(a1Input, { target: { value: '20' } })
    fireEvent.blur(a1Input)
    await waitFor(() => expect(resolveA1Save).toEqual(expect.any(Function)))

    fireEvent.change(t1Input, { target: { value: '30' } })
    fireEvent.blur(t1Input)
    await waitFor(() => expect(gradebookReads).toBe(2))
    expect(screen.getByRole('spinbutton', { name: 'Category weight for Test 1' })).toHaveValue(30)

    await act(async () => {
      resolveA1Save?.()
    })

    await waitFor(() => expect(gradebookReads).toBe(3))
    expect(screen.getByRole('spinbutton', { name: 'Category weight for Essay' })).toHaveValue(20)
    expect(screen.getByRole('spinbutton', { name: 'Category weight for Test 1' })).toHaveValue(30)
  })

  it('serializes rapid saves for the same assessment so the newest weight persists', async () => {
    let persistedWeight = 10
    let resolveFirstSave: (() => void) | null = null
    const patchWeights: number[] = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/teacher/gradebook' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { gradebook_weight: number }
        patchWeights.push(body.gradebook_weight)
        if (patchWeights.length === 1) {
          return new Promise((resolve) => {
            resolveFirstSave = () => {
              persistedWeight = body.gradebook_weight
              resolve({ ok: true, json: async () => ({}) })
            }
          })
        }
        persistedWeight = body.gradebook_weight
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      if (url === `/api/teacher/gradebook?classroom_id=${classroom.id}`) {
        const response = gradebookResponse()
        response.assessment_columns = response.assessment_columns.map((column) => ({
          ...column,
          weight: column.assessment_id === 'assignment-1' ? persistedWeight : column.weight,
        }))
        return Promise.resolve({ ok: true, json: async () => response })
      }
      throw new Error(`Unhandled fetch: ${init?.method ?? 'GET'} ${url}`)
    })

    await renderWeightEditor()
    let input = await screen.findByRole('spinbutton', { name: 'Category weight for Essay' })
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.blur(input)
    await waitFor(() => expect(resolveFirstSave).toEqual(expect.any(Function)))

    input = screen.getByRole('spinbutton', { name: 'Category weight for Essay' })
    input.removeAttribute('disabled')
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.blur(input)
    expect(patchWeights).toEqual([20])

    await act(async () => {
      resolveFirstSave?.()
    })

    await waitFor(() => expect(patchWeights).toEqual([20, 30]))
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: 'Category weight for Essay' })).toHaveValue(30)
    })
    expect(persistedWeight).toBe(30)
  })

  it('preserves another assessment’s unsaved draft during a save refresh', async () => {
    await renderWeightEditor()
    const essay = screen.getByRole('spinbutton', { name: 'Category weight for Essay' })
    const test = screen.getByRole('spinbutton', { name: 'Category weight for Test 1' })
    fireEvent.change(test, { target: { value: '37' } })
    fireEvent.change(essay, { target: { value: '20' } })
    fireEvent.blur(essay)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(test).toHaveValue(37)
  })

  it('keeps category drafts when saving fails and retries the same draft', async () => {
    renderGradebook('grades')
    await screen.findByText('Ada')
    fireEvent.click(within(openGradebookActions()).getByRole('menuitem', { name: 'Edit categories' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Category name for Term' }), { target: { value: 'Term work' } })
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Try again' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Save categories' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again')
    expect(screen.getByRole('textbox', { name: 'Category name for Term work' })).toHaveValue('Term work')
    fireEvent.click(screen.getByRole('button', { name: 'Save categories' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit categories' })).not.toBeInTheDocument())
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(puts).toHaveLength(2)
    expect(puts[0][1].body).toEqual(puts[1][1].body)
  })

  it('disables gradebook edits for an archived classroom', async () => {
    render(<AppMessageProvider><TooltipProvider><TeacherGradebookTab classroom={{ ...classroom, archived_at: '2026-09-01T00:00:00Z' }} /></TooltipProvider></AppMessageProvider>)
    await screen.findByText('Ada')
    expect(screen.getByRole('button', { name: 'Edit A1: Essay' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Show weights' }))
    expect(screen.getByRole('spinbutton', { name: 'Category weight for Essay' })).toBeDisabled()
    expect(within(openGradebookActions()).getByRole('menuitem', { name: 'Edit categories' })).toBeDisabled()
  })

  it('refreshes canonical titles when returning from Classwork', async () => {
    const view = render(<AppMessageProvider><TooltipProvider><TeacherGradebookTab classroom={classroom} isActive /></TooltipProvider></AppMessageProvider>)
    await screen.findByText('Ada')
    view.rerender(<AppMessageProvider><TooltipProvider><TeacherGradebookTab classroom={classroom} isActive={false} /></TooltipProvider></AppMessageProvider>)
    const response = gradebookResponse()
    response.assessment_columns[0].title = 'Renamed in Classwork'
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response })
    view.rerender(<AppMessageProvider><TooltipProvider><TeacherGradebookTab classroom={classroom} isActive /></TooltipProvider></AppMessageProvider>)
    expect(await screen.findByRole('button', { name: 'Edit A1: Renamed in Classwork' })).toBeInTheDocument()
  })

  it('ignores a stale classroom response after the classroom changes', async () => {
    const secondClassroom = createMockClassroom({ id: 'classroom-2', title: 'Second classroom' })
    let resolveFirst: ((value: unknown) => void) | null = null
    let resolveSecond: ((value: unknown) => void) | null = null
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`classroom_id=${classroom.id}`)) {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      if (url.includes(`classroom_id=${secondClassroom.id}`)) {
        return new Promise((resolve) => { resolveSecond = resolve })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const view = renderGradebook('grades')
    view.rerender(
      <AppMessageProvider>
        <TooltipProvider>
          <TeacherGradebookTab
            classroom={secondClassroom}
            sectionParam="grades"
            onSectionChange={vi.fn()}
          />
        </TooltipProvider>
      </AppMessageProvider>,
    )

    const secondResponse = gradebookResponse()
    secondResponse.students = secondResponse.students.map((student) => ({
      ...student,
      student_first_name: `Second ${student.student_first_name}`,
    }))
    await act(async () => {
      resolveSecond?.({ ok: true, json: async () => secondResponse })
    })
    expect(await screen.findByText('Second Ada')).toBeInTheDocument()

    await act(async () => {
      resolveFirst?.({ ok: true, json: async () => gradebookResponse() })
    })
    expect(screen.getByText('Second Ada')).toBeInTheDocument()
    expect(screen.queryByText('Ada', { exact: true })).not.toBeInTheDocument()
  })

  it('does not apply or refresh an assessment save after the classroom changes', async () => {
    const secondClassroom = createMockClassroom({ id: 'classroom-2', title: 'Second classroom' })
    let resolveSave: ((value: unknown) => void) | null = null
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/teacher/gradebook' && init?.method === 'PATCH') {
        return new Promise((resolve) => { resolveSave = resolve })
      }
      if (url.includes(`classroom_id=${classroom.id}`)) {
        return Promise.resolve({ ok: true, json: async () => gradebookResponse() })
      }
      if (url.includes(`classroom_id=${secondClassroom.id}`)) {
        const response = gradebookResponse()
        response.students = response.students.map((student) => ({
          ...student,
          student_first_name: `Second ${student.student_first_name}`,
        }))
        return Promise.resolve({ ok: true, json: async () => response })
      }
      throw new Error(`Unhandled fetch: ${init?.method ?? 'GET'} ${url}`)
    })

    const view = await renderWeightEditor()
    const weightInput = await screen.findByRole('spinbutton', { name: 'Category weight for Essay' })
    fireEvent.change(weightInput, { target: { value: '20' } })
    fireEvent.blur(weightInput)
    await waitFor(() => expect(resolveSave).toEqual(expect.any(Function)))

    view.rerender(
      <AppMessageProvider>
        <TooltipProvider>
          <TeacherGradebookTab
            classroom={secondClassroom}
            sectionParam="grades"
            onSectionChange={vi.fn()}
          />
        </TooltipProvider>
      </AppMessageProvider>,
    )
    expect(await screen.findByText('Second Ada')).toBeInTheDocument()

    await act(async () => {
      resolveSave?.({ ok: true, json: async () => ({ assessment: { gradebook_weight: 20 } }) })
    })

    expect(screen.getByText('Second Ada')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => (
      String(input) === `/api/teacher/gradebook?classroom_id=${classroom.id}`
    ))).toHaveLength(1)
  })

  it('color codes grade text by percentage band', async () => {
    const response = gradebookResponse()
    const grace = response.students.find((student) => student.student_id === 'student-2')
    if (!grace) throw new Error('Missing Grace fixture')

    grace.final_percent = 40
    grace.assessment_scores[0] = {
      ...grace.assessment_scores[0],
      earned: 1,
      percent: 10,
      is_graded: true,
    }
    grace.assessment_scores[1] = {
      ...grace.assessment_scores[1],
      earned: 7,
      percent: 70,
      is_graded: true,
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    })

    renderGradebook('grades')

    const graceRow = await screen.findByRole('row', { name: /Grace Hopper.*10%.*70%.*40\.0%/ })
    expect(within(graceRow).getByText('40.0%')).toHaveClass('text-danger')
    expect(within(graceRow).getByText('10%')).toHaveClass('text-danger')
    expect(within(graceRow).getByText('70%')).toHaveClass('text-text-default')

    const avgRow = screen.getByRole('row', { name: 'Class average' })
    expect(within(avgRow).getByText('45%')).toHaveClass('text-danger')
    expect(within(avgRow).getByText('80%')).toHaveClass('text-text-default')
    expect(within(avgRow).getByText('62.5%')).toHaveClass('text-warning')

    fireEvent.click(screen.getByRole('button', { name: 'MED' }))
    const medRow = screen.getByRole('row', { name: 'Class median' })
    expect(within(medRow).getByText('45%')).toHaveClass('text-danger')
    expect(within(medRow).getByText('80%')).toHaveClass('text-text-default')
    expect(within(medRow).getByText('62.5%')).toHaveClass('text-warning')

    fireEvent.click(graceRow)
    const detailPanel = screen.getByRole('region', { name: 'Grace Hopper assessment details' })
    expect(within(detailPanel).getByText('40.0%')).toHaveClass('text-danger')
    expect(within(detailPanel).getByText('10%')).toHaveClass('text-danger')
    expect(within(detailPanel).getByText('70%')).toHaveClass('text-text-default')
  })

  it('keeps menus outside the scrollable display cluster and frozen cells opaque', async () => {
    renderGradebook('grades')
    await screen.findByText('Ada')
    expect(screen.getByRole('region', { name: 'Gradebook controls' })).toHaveClass('grid', 'relative', 'z-floating')
    expect(screen.getByRole('button', { name: 'Gradebook more actions' }).closest('.fixed')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'First' })).toHaveClass('sticky', 'bg-surface-2', 'z-sticky-table')
    expect(screen.getByRole('columnheader', { name: 'Final' })).toHaveClass('sticky', 'bg-surface-2')
    expect(screen.getByRole('table')).toHaveClass('border-separate', 'border-spacing-0')
    expect(screen.getByTestId('gradebook-display-controls')).not.toContainElement(screen.getByRole('button', { name: 'Student Actions' }))
  })

  it('keeps selection while changing display settings and copies selected emails', async () => {
    renderGradebook('grades')
    await screen.findByText('Ada')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    fireEvent.click(screen.getByRole('button', { name: '1 selected' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy emails' }))
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith('ada@example.com'))
    fireEvent.click(screen.getByRole('button', { name: 'Show weights' }))
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).toBeChecked()
    expect(screen.getByRole('button', { name: '1 selected' })).toBeInTheDocument()
  })

  it('opens the categories modal for a legacy settings link', async () => {
    const onSectionChange = vi.fn()
    renderGradebook('settings', onSectionChange)
    expect(await screen.findByRole('heading', { name: 'Edit categories' })).toBeInTheDocument()
    expect(onSectionChange).toHaveBeenCalledWith('grades')
  })

})
