import { useCallback, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssignmentModal } from '@/components/AssignmentModal'
import { TooltipProvider } from '@/ui'
import { toTorontoEndOfDayIso } from '@/lib/timezone'
import type { Assignment } from '@/types'

// Only the unrelated backend source is mocked. Form, requirements and Tiptap are real.
vi.mock('@/components/ClassroomBlueprintDraftSource', () => ({ ClassroomBlueprintDraftSource: () => null }))

function record(id: string, title = id, classroomId = 'classroom-A'): Assignment {
  return {
    id, classroom_id: classroomId, title, description: 'Instructions', instructions_markdown: 'Instructions',
    due_at: toTorontoEndOfDayIso('2026-10-20'), position: 0, released_at: null,
    track_authenticity: true, created_by: 'teacher-session', is_draft: true,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  }
}
const A = record('assignment-session-A')
const B = record('assignment-session-B')

type Write = { url: string; method: string; body: Record<string, unknown> }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('AssignmentModal async ownership across editor sessions', () => {
  let writes: Write[]
  let held: Array<{ match: (write: Write) => boolean; response: ReturnType<typeof deferred<unknown>>; used: boolean }>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T15:00:00Z'))
    writes = []
    held = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const write = { url, method: init.method!, body: init.body ? JSON.parse(String(init.body)) : {} }
      writes.push(write)
      const request = held.find((entry) => !entry.used && entry.match(write))
      if (request) {
        request.used = true
        return request.response.promise
      }
      // Every request is intercepted, including a wrong-resource follow-up PATCH.
      const source = [A, B].find((item) => url === `/api/teacher/assignments/${item.id}`)
      if (source && init.method === 'PATCH') return { ok: true, json: async () => ({ assignment: { ...source, ...write.body } }) }
      throw new Error(`Unexpected mocked request: ${write.method} ${url}`)
    }))
  })

  afterEach(async () => {
    // Settle every response before restoring fetch, even after a failed assertion.
    await act(async () => {
      held.forEach((entry) => entry.response.resolve({ ok: false, json: async () => ({ error: 'Fixture cleanup' }) }))
    })
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function hold(match: (write: Write) => boolean) {
    const entry = { match, response: deferred<unknown>(), used: false }
    held.push(entry)
    return {
      entry,
      async finish(data: unknown, ok = true) {
        await act(async () => { entry.response.resolve({ ok, json: async () => data }) })
      },
    }
  }

  function mount(initial: Assignment | null = A) {
    const publication = vi.fn()
    const close = vi.fn()
    let changeOwner!: (assignment: Assignment | null, open?: boolean, classroomId?: string) => void
    function Parent() {
      const [assignment, setAssignment] = useState(initial)
      const [open, setOpen] = useState(true)
      const [classroomId, setClassroomId] = useState(initial?.classroom_id ?? 'classroom-A')
      changeOwner = (next, nextOpen = true, nextClassroom = next?.classroom_id ?? classroomId) => {
        setAssignment(next); setOpen(nextOpen); setClassroomId(nextClassroom)
      }
      const onClose = useCallback(() => { close(); setOpen(false) }, [])
      // Model TeacherClassroomView: onSuccess closes by default, independently of onClose.
      const onSuccess = useCallback((saved: Assignment, options?: { closeModal?: boolean }) => {
        publication(saved, options)
        if (options?.closeModal !== false) setOpen(false)
      }, [])
      return <AssignmentModal isOpen={open} classroomId={classroomId} assignment={assignment} onClose={onClose} onSuccess={onSuccess} />
    }
    render(<Parent />, { wrapper: TooltipProvider })
    return { publication, close, changeOwner: (...args: Parameters<typeof changeOwner>) => act(() => changeOwner(...args)) }
  }

  async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  function title(value: string) { fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value } }) }
  function selectDraftAction() {
    fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Draft' }))
  }
  function draftSave() {
    selectDraftAction()
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }))
  }
  function assertBOpen() { expect(screen.queryByRole('textbox', { name: 'Title' })).toHaveValue(B.title) }

  it('does not adopt A identity or requirements when an old autosave completes into pristine B', async () => {
    const saveA = hold((write) => write.url.endsWith(A.id) && write.body.title === 'A autosave')
    const owner = mount()
    title('A autosave')
    await advance(3000)
    expect(saveA.entry.used).toBe(true)
    owner.changeOwner(B)
    await saveA.finish({ assignment: { ...A, title: 'A autosave', submission_requirements: [{ id: 'requirement-A', type: 'link', label: 'A requirement', instructions: '', required: true, position: 0, validation_policy_json: {} }] } })
    assertBOpen()
    expect.soft(screen.queryByDisplayValue('A requirement')).not.toBeInTheDocument()
    title('B follow-up')
    draftSave()
    await advance(0)
    const followup = writes.find((write) => write.body.title === 'B follow-up')!
    expect(followup).toMatchObject({ url: `/api/teacher/assignments/${B.id}`, method: 'PATCH', body: { title: 'B follow-up' } })
  })

  it('keeps B dirty values and its own save baseline after A autosave succeeds', async () => {
    const saveA = hold((write) => write.url.endsWith(A.id))
    const owner = mount()
    title('A autosave')
    await advance(3000)
    owner.changeOwner(B)
    title('B dirty buffer')
    await saveA.finish({ assignment: { ...A, title: 'A autosave' } })
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('B dirty buffer')
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved')
    draftSave()
    await advance(0)
    expect(writes.find((write) => write.body.title === 'B dirty buffer')).toMatchObject({ url: `/api/teacher/assignments/${B.id}`, body: { title: 'B dirty buffer' } })
  })

  it('ignores a failed old autosave after ordinary close-save succeeds and the owner reopens', async () => {
    const saveA = hold((write) => write.url.endsWith(A.id) && write.body.title === 'A autosave')
    const owner = mount()
    title('A autosave')
    await advance(3000)
    fireEvent.click(screen.getByRole('button', { name: 'Close assignment modal' }))
    await advance(0)
    expect(owner.close).toHaveBeenCalledTimes(1)
    owner.changeOwner(B)
    await saveA.finish({ error: 'Old autosave failure' }, false)
    assertBOpen()
    expect.soft(screen.queryByText('Old autosave failure')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('does not reuse A active save for equal-valued B manual save', async () => {
    const saveA = hold((write) => write.url.endsWith(A.id))
    const equalB = { ...B, title: 'Shared values' }
    const owner = mount()
    title('Shared values')
    await advance(3000)
    owner.changeOwner(equalB)
    draftSave()
    await saveA.finish({ assignment: { ...A, title: 'Shared values' } })
    expect(owner.publication).toHaveBeenCalledWith(expect.objectContaining({ id: B.id }), undefined)
    expect(owner.publication).not.toHaveBeenCalledWith(expect.objectContaining({ id: A.id }), undefined)
  })

  it('finishes initiated A manual Draft with newer A values while preserving B pending edits', async () => {
    const saveA = hold((write) => write.url.endsWith(A.id) && write.body.title === 'A autosave')
    const owner = mount()
    title('A autosave')
    await advance(3000)
    title('A manual values')
    draftSave()
    owner.changeOwner(B)
    title('B pending values')
    await saveA.finish({ assignment: { ...A, title: 'A autosave' } })
    expect.soft(writes.find((write) => write.body.title === 'A manual values')).toMatchObject({
      url: `/api/teacher/assignments/${A.id}`, method: 'PATCH', body: { title: 'A manual values' },
    })
    expect.soft(owner.publication).toHaveBeenCalledWith(expect.objectContaining({ id: A.id, title: 'A manual values' }), { closeModal: false })
    expect.soft(owner.close).not.toHaveBeenCalled()
    expect.soft(screen.queryByRole('textbox', { name: 'Title' })).toHaveValue('B pending values')
    expect.soft(screen.queryByRole('status')).toHaveTextContent('Unsaved')
    draftSave()
    await advance(0)
    expect(writes.find((write) => write.body.title === 'B pending values')).toMatchObject({
      url: `/api/teacher/assignments/${B.id}`, body: { title: 'B pending values' },
    })
  })

  it.each(['preselected Draft', 'menu after input'] as const)('restores reverted A title after completed autosave while preserving B pending edits (%s)', async (action) => {
    const saveA = hold((write) => write.url.endsWith(A.id) && write.body.title === 'A autosave')
    const owner = mount()
    if (action === 'preselected Draft') selectDraftAction()
    title('A autosave')
    await advance(3000)
    expect(saveA.entry.used).toBe(true)
    title(A.title)
    if (action === 'preselected Draft') fireEvent.click(screen.getByRole('button', { name: 'Draft', exact: true }))
    else draftSave()
    if (action === 'preselected Draft') expect(writes).toHaveLength(1)
    owner.changeOwner(B)
    title('B pending after A revert')
    const bTitle = screen.getByRole('textbox', { name: 'Title' })
    bTitle.focus()
    await saveA.finish({ assignment: { ...A, title: 'A autosave' } })
    expect.soft(writes.filter((write) => write.url.endsWith(A.id))).toEqual([
      { url: `/api/teacher/assignments/${A.id}`, method: 'PATCH', body: { title: 'A autosave' } },
      { url: `/api/teacher/assignments/${A.id}`, method: 'PATCH', body: { title: A.title } },
    ])
    expect.soft(owner.publication).toHaveBeenCalledWith(expect.objectContaining({ id: A.id, title: A.title }), { closeModal: false })
    expect.soft(owner.close).not.toHaveBeenCalled()
    expect.soft(screen.queryByRole('textbox', { name: 'Title' })).toHaveValue('B pending after A revert')
    expect.soft(bTitle).toHaveFocus()
    expect.soft(screen.queryByRole('status')).toHaveTextContent('Unsaved')
    expect.soft(screen.queryByRole('button', { name: 'Post', exact: true })).toBeEnabled()
    draftSave()
    await advance(0)
    expect(writes.find((write) => write.body.title === 'B pending after A revert')).toEqual({
      url: `/api/teacher/assignments/${B.id}`, method: 'PATCH', body: { title: 'B pending after A revert' },
    })
  })

  it.each(['preselected Draft', 'menu after input'] as const)('restores reverted A requirement alongside changed title after autosave without erasing B edits (%s)', async (action) => {
    const requirement = { id: 'session-requirement-A', type: 'link' as const, label: 'Original A link',
      instructions: '', required: true, position: 0, validation_policy_json: {} }
    const initial = { ...A, submission_requirements: [requirement] } as Assignment
    const saveA = hold((write) => write.url.endsWith(A.id) && Array.isArray(write.body.submission_requirements))
    const owner = mount(initial)
    if (action === 'preselected Draft') selectDraftAction()
    fireEvent.change(screen.getByRole('textbox', { name: 'Link label' }), { target: { value: 'A autosaved link' } })
    await advance(3000)
    expect(saveA.entry.used).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Link label' }), { target: { value: requirement.label } })
    title('A mixed manual title')
    if (action === 'preselected Draft') fireEvent.click(screen.getByRole('button', { name: 'Draft', exact: true }))
    else draftSave()
    if (action === 'preselected Draft') expect(writes).toHaveLength(1)
    owner.changeOwner(B)
    title('B pending after A mixed revert')
    const bTitle = screen.getByRole('textbox', { name: 'Title' })
    bTitle.focus()
    await saveA.finish({ assignment: { ...initial, submission_requirements: [{ ...requirement, label: 'A autosaved link' }] } })
    const writesA = writes.filter((write) => write.url.endsWith(A.id))
    expect.soft(writesA).toHaveLength(2)
    expect.soft(writesA[1]).toEqual({ url: `/api/teacher/assignments/${A.id}`, method: 'PATCH',
      body: { title: 'A mixed manual title', submission_requirements: [requirement] } })
    expect.soft(owner.publication).toHaveBeenCalledWith(expect.objectContaining({
      id: A.id, title: 'A mixed manual title', submission_requirements: [requirement],
    }), { closeModal: false })
    expect.soft(owner.close).not.toHaveBeenCalled()
    expect.soft(screen.queryByRole('textbox', { name: 'Title' })).toHaveValue('B pending after A mixed revert')
    expect.soft(bTitle).toHaveFocus()
    expect.soft(screen.queryByRole('textbox', { name: 'Link label' })).not.toBeInTheDocument()
    expect.soft(screen.queryByRole('status')).toHaveTextContent('Unsaved')
    expect.soft(screen.queryByRole('button', { name: 'Post', exact: true })).toBeEnabled()
    draftSave()
    await advance(0)
    expect(writes.find((write) => write.body.title === 'B pending after A mixed revert')).toEqual({
      url: `/api/teacher/assignments/${B.id}`, method: 'PATCH', body: { title: 'B pending after A mixed revert' },
    })
  })

  it('restores A using the last persisted baseline when an intervening queued save fails', async () => {
    const first = hold((write) => write.url.endsWith(A.id) && write.body.title === 'A first persisted title')
    const second = hold((write) => write.url.endsWith(A.id) && write.body.title === 'A failed queued title')
    const owner = mount()
    title('A first persisted title')
    await advance(3000)
    title('A failed queued title')
    fireEvent.blur(screen.getByRole('textbox', { name: 'Title' }))
    title(A.title)
    draftSave()
    owner.changeOwner(B)
    title('B pending after queued failure')
    await first.finish({ assignment: { ...A, title: 'A first persisted title' } })
    expect(second.entry.used).toBe(true)
    await second.finish({ error: 'A queued save failed' }, false)
    expect.soft(writes.filter((write) => write.url.endsWith(A.id))).toEqual([
      { url: `/api/teacher/assignments/${A.id}`, method: 'PATCH', body: { title: 'A first persisted title' } },
      { url: `/api/teacher/assignments/${A.id}`, method: 'PATCH', body: { title: 'A failed queued title' } },
      { url: `/api/teacher/assignments/${A.id}`, method: 'PATCH', body: { title: A.title } },
    ])
    expect.soft(owner.publication).toHaveBeenCalledWith(expect.objectContaining({ id: A.id, title: A.title }), { closeModal: false })
    expect.soft(owner.close).not.toHaveBeenCalled()
    expect.soft(screen.queryByText('A queued save failed')).not.toBeInTheDocument()
    expect.soft(screen.queryByRole('textbox', { name: 'Title' })).toHaveValue('B pending after queued failure')
    expect.soft(screen.queryByRole('status')).toHaveTextContent('Unsaved')
    draftSave()
    await advance(0)
    expect(writes.find((write) => write.body.title === 'B pending after queued failure')).toEqual({
      url: `/api/teacher/assignments/${B.id}`, method: 'PATCH', body: { title: 'B pending after queued failure' },
    })
  })

  it.each(['success', 'failure'] as const)('does not let abandoned backing-draft %s adopt or close B', async (outcome) => {
    const createA = hold((write) => write.method === 'POST' && write.body.classroom_id === 'classroom-A')
    const owner = mount(null)
    expect(createA.entry.used).toBe(true)
    expect(screen.getByRole('button', { name: 'Close assignment modal' })).toBeDisabled()
    // Owner-driven replacement; normal close is blocked while creating.
    owner.changeOwner(B)
    await createA.finish(outcome === 'success' ? { assignment: record('abandoned-draft-A', 'Abandoned draft') } : { error: 'Old create failure' }, outcome === 'success')
    assertBOpen()
    expect(owner.close).not.toHaveBeenCalled()
    expect(owner.publication).not.toHaveBeenCalled() // Existing auto-create policy publishes nothing.
    expect(screen.queryByText('Old create failure')).not.toBeInTheDocument()
  })

  it('starts one new backing-draft request when create mode is closed and reopened during creation', async () => {
    const first = hold((write) => write.method === 'POST')
    const second = hold((write) => write.method === 'POST')
    const owner = mount(null)
    expect(first.entry.used).toBe(true)
    owner.changeOwner(null, false)
    owner.changeOwner(null, true)
    await advance(0)
    expect.soft(second.entry.used).toBe(true)
    expect.soft(writes.filter((write) => write.method === 'POST')).toHaveLength(2)
    await first.finish({ assignment: record('abandoned-create-A', 'Old create') })
    await second.finish({ assignment: record('new-create-B', 'New create') })
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('New create')
    expect(screen.getByRole('button', { name: 'Close assignment modal' })).toBeEnabled()
  })

  it('keeps the new classroom backing draft when old classroom creation completes last', async () => {
    const createA = hold((write) => write.method === 'POST' && write.body.classroom_id === 'classroom-A')
    const createB = hold((write) => write.method === 'POST' && write.body.classroom_id === 'classroom-B')
    const owner = mount(null)
    expect(createA.entry.used).toBe(true)
    owner.changeOwner(null, true, 'classroom-B')
    expect(createB.entry.used).toBe(true)
    await createB.finish({ assignment: record('classroom-B-created', 'New classroom draft', 'classroom-B') })
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('New classroom draft')
    await createA.finish({ assignment: record('classroom-A-abandoned', 'Old classroom draft') })
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('New classroom draft')
    expect(writes.filter((write) => write.method === 'POST')).toHaveLength(2)
    expect(owner.publication).not.toHaveBeenCalled()
  })

  it('does not resurrect A schedule dialog or erase B pending edits after delayed flush', async () => {
    const flushA = hold((write) => write.url.endsWith(A.id))
    const owner = mount()
    title('A flush')
    fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))
    expect(flushA.entry.used).toBe(true)
    owner.changeOwner(B)
    title('B pending after flush')
    await flushA.finish({ assignment: { ...A, title: 'A flush' } })
    expect.soft(screen.queryByRole('dialog', { name: 'Schedule Release' })).not.toBeInTheDocument()
    expect.soft(screen.getByRole('status', { hidden: true })).toHaveTextContent('Unsaved')
    // Cancel any incorrectly resurrected dialog to inspect the replacement buffer.
    const schedule = screen.queryByRole('dialog', { name: 'Schedule Release' })
    if (schedule) fireEvent.click(within(schedule.parentElement!).getByRole('button', { name: 'Close dialog' }))
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))
    await advance(0)
    expect(writes.find((write) => write.body.title === 'B pending after flush')).toMatchObject({ url: `/api/teacher/assignments/${B.id}`, body: { title: 'B pending after flush' } })
  })

  it('publishes completed A close-save without indirectly closing replacement B', async () => {
    const closeSave = hold((write) => write.url.endsWith(A.id))
    const owner = mount()
    title('A close-save')
    fireEvent.click(screen.getByRole('button', { name: 'Close assignment modal' }))
    expect(closeSave.entry.used).toBe(true)
    owner.changeOwner(B)
    await closeSave.finish({ assignment: { ...A, title: 'A close-save' } })
    expect.soft(owner.publication).toHaveBeenCalledWith(expect.objectContaining({ id: A.id }), { closeModal: false })
    expect.soft(owner.close).not.toHaveBeenCalled()
    assertBOpen()
  })
  it.each(['preserved', 'failure'] as const)('keeps replacement B open after stale pristine-discard %s', async (outcome) => {
    const create = hold((write) => write.method === 'POST' && write.url === '/api/teacher/assignments')
    const discard = hold((write) => write.method === 'POST' && write.url.endsWith('/discard-pristine'))
    const owner = mount(null)
    const backing = record('backing-draft-A', 'Untitled (session A)')
    await create.finish({ assignment: backing })
    fireEvent.click(screen.getByRole('button', { name: 'Close assignment modal' }))
    expect(discard.entry.used).toBe(true)
    expect(writes.at(-1)).toMatchObject({ url: `/api/teacher/assignments/${backing.id}/discard-pristine`, body: { expected_updated_at: backing.updated_at } })
    owner.changeOwner(B)
    await discard.finish(outcome === 'preserved' ? { discarded: false, assignment: backing } : { error: 'Stale discard failure' }, outcome === 'preserved')
    if (outcome === 'preserved') expect.soft(owner.publication).toHaveBeenCalledWith(backing, { closeModal: false })
    else expect.soft(owner.publication).not.toHaveBeenCalled()
    expect.soft(owner.close).not.toHaveBeenCalled()
    expect.soft(screen.queryByText('Stale discard failure')).not.toBeInTheDocument()
    assertBOpen()
  })

})
