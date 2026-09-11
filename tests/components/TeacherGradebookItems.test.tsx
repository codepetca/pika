import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'

vi.mock('@/hooks/useGradebookEmail2', () => ({ useGradebookEmail2: () => ({ rows: [], loading: false, error: null, reload: vi.fn() }) }))
vi.mock('@/lib/request-cache', () => ({ fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()), invalidateCachedJSONMatching: vi.fn() }))
const classroom = createMockClassroom()
const item = { assessment_id: 'item-1', assessment_type: 'item', code: 'I1', title: 'Attendance – Term 1', possible: 20, weight: 10, include_in_final: true, category_id: null, scored_count: 1, returned_count: 0 }
function payload(earned: number | null = 15) { return { items_available: true, categories: [], assessment_columns: [item], students: [{ student_id: 'student-1', student_email: 'ada@example.com', student_first_name: 'Ada', student_last_name: 'Lovelace', final_percent: earned == null ? null : earned * 5, assessment_scores: [{ ...item, earned, is_graded: earned != null, percent: earned == null ? null : earned * 5, returned_at: null }] }] } }
function renderTab(archived = false) { return render(<AppMessageProvider><TooltipProvider><TeacherGradebookTab classroom={{ ...classroom, archived_at: archived ? '2026-01-01' : null }} /></TooltipProvider></AppMessageProvider>) }

describe('Gradebook standalone item interactions', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { window.localStorage.clear(); fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload() }); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('keeps a create UUID stable when retrying an uncertain save', async () => {
    let attempts = 0
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST' && ++attempts === 1 ? { ok: false, json: async () => ({ error: 'Connection interrupted' }) } : { ok: true, json: async () => payload() })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Gradebook more actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Add other assessment' })).toBeEnabled())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add other assessment' }))
    const dialog = screen.getByRole('dialog', { name: 'Add other assessment' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assessment title' }), { target: { value: 'Participation' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add other assessment' }))
    await screen.findByText('Connection interrupted')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add other assessment' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add other assessment' })).not.toBeInTheDocument())
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body))
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ action: 'create', classroom_id: classroom.id, title: 'Participation', points_possible: 100, include_in_final: true })
    expect(writes[0].item_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(writes[1].item_id).toBe(writes[0].item_id)
  })
  it('saves and clears original marks via the item endpoint, including mobile controls', async () => {
    renderTab()
    const mobileEdit = await screen.findByRole('button', { name: /Edit Ada Lovelace item mark/ })
    fireEvent.click(mobileEdit)
    expect(screen.queryByRole('button', { name: 'Undo override' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Mark earned' }), { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save mark' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit mark' })).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/gradebook/items/scores', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ classroom_id: classroom.id, student_id: 'student-1', item_id: 'item-1', earned: 18 }) }))
    fireEvent.click(screen.getByRole('button', { name: /Edit Ada Lovelace item mark/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear mark' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit mark' })).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/gradebook/items/scores', expect.objectContaining({ body: JSON.stringify({ classroom_id: classroom.id, student_id: 'student-1', item_id: 'item-1', earned: null }) }))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('manual-scores'))).toBe(false)
  })
  it('opens item details from mobile and confirms returning marks', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: `Edit item: ${item.title}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Return marks' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Return marks?' })).getByRole('button', { name: 'Return marks' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/gradebook/items', expect.objectContaining({ body: JSON.stringify({ action: 'return_marks', classroom_id: classroom.id, item_id: 'item-1' }) })))
  })
  it('disables item actions for archived classrooms and missing schema', async () => {
    const view = renderTab(true)
    await screen.findByRole('button', { name: `Edit item: ${item.title}` })
    fireEvent.click(screen.getByRole('button', { name: 'Gradebook more actions' }))
    expect(screen.getByRole('menuitem', { name: 'Add other assessment' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Edit Ada Lovelace item mark/ })).toBeDisabled()
    view.unmount()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...payload(), items_available: false }) })
    renderTab()
    await screen.findByRole('button', { name: `Edit item: ${item.title}` })
    fireEvent.click(screen.getByRole('button', { name: 'Gradebook more actions' }))
    expect(screen.getByRole('menuitem', { name: 'Add other assessment' })).toBeDisabled()
  })
  it('does not refresh a previous classroom after an item write resolves', async () => {
    let resolveWrite: (result: unknown) => void = () => {}
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === 'POST' ? new Promise((resolve) => { resolveWrite = resolve }) : Promise.resolve({ ok: true, json: async () => payload() }))
    const view = renderTab()
    fireEvent.click(await screen.findByRole('button', { name: `Edit item: ${item.title}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }))
    view.rerender(<AppMessageProvider><TooltipProvider><TeacherGradebookTab classroom={{ ...classroom, id: 'second-classroom' }} /></TooltipProvider></AppMessageProvider>)
    await act(async () => resolveWrite({ ok: true, json: async () => ({}) }))
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/teacher/gradebook?classroom_id=${classroom.id}`)).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: 'Edit item' })).not.toBeInTheDocument()
  })
})
