import { startTransition, Suspense, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssignmentModal } from '@/components/AssignmentModal'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { toTorontoEndOfDayIso } from '@/lib/timezone'
import { TooltipProvider } from '@/ui'
import type { Assignment } from '@/types'

// All descendants are real, including private provenance, requirements and Tiptap.
const assignment: Assignment = {
  id: 'assignment-exit-A', classroom_id: 'classroom-exit', title: 'Original title',
  description: 'Original instructions', instructions_markdown: 'Original instructions',
  due_at: toTorontoEndOfDayIso('2026-10-20'), position: 0, released_at: null,
  track_authenticity: true, created_by: 'teacher-exit', is_draft: true,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
}
type EditorElement = HTMLElement & { editor: Editor }

describe('AssignmentModal logical close with retained real descendants', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let resolveProvenance: (value: Response) => void
  let reducedMotion: boolean
  let mobile: boolean
  let motionListeners: Set<() => void>

  beforeEach(() => {
    vi.useFakeTimers()
    reducedMotion = false
    mobile = false
    motionListeners = new Set()
    const originalMatchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => query === '(prefers-reduced-motion: reduce)' ? ({
      media: query,
      get matches() { return reducedMotion },
      addEventListener: (_event: string, listener: () => void) => motionListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener),
    }) as MediaQueryList : query === '(max-width: 767px)' ? {
      ...originalMatchMedia(query), matches: mobile,
    } : originalMatchMedia(query))
    invalidateCachedJSONMatching('classroom-draft-source:')
    const originalComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalComputedStyle(element)
      style.setProperty('--motion-duration-standard', '200ms')
      return style
    })
    const provenance = new Promise<Response>((resolve) => { resolveProvenance = resolve })
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/teacher/classrooms/classroom-exit/authoring-drafts/provenance?')) return provenance
      if (url === `/api/teacher/assignments/${assignment.id}` && init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ assignment: { ...assignment, ...JSON.parse(String(init.body)) } }) } as Response
      }
      throw new Error(`Unexpected mocked request: ${init?.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    await act(async () => { resolveProvenance({ ok: true, json: async () => ({ provenance: null }) } as Response) })
    cleanup()
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mount(initial = assignment) {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    let changeOwner!: (open: boolean, record?: Assignment | null) => void
    function Parent() {
      const [open, setOpen] = useState(false)
      const [record, setRecord] = useState<Assignment | null>(initial)
      changeOwner = (nextOpen, nextRecord = record) => { setRecord(nextRecord); setOpen(nextOpen) }
      return <>
        <button onClick={() => setOpen(true)}>Open assignment</button>
        <AssignmentModal isOpen={open} classroomId="classroom-exit" assignment={record} onClose={onClose} onSuccess={onSuccess} />
      </>
    }
    const result = render(<Parent />, { wrapper: TooltipProvider })
    const opener = screen.getByRole('button', { name: 'Open assignment' })
    opener.focus()
    fireEvent.click(opener)
    return { ...result, opener, onClose, onSuccess, changeOwner: (...args: Parameters<typeof changeOwner>) => act(() => changeOwner(...args)) }
  }

  async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  function editor() { return screen.getByRole('textbox', { name: 'Instructions' }) as EditorElement }
  function writes() { return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH') }
  function editInstructions(target: EditorElement) {
    act(() => { target.editor.commands.insertContentAt(target.editor.state.doc.content.size - 1, ' old-session edit') })
    expect(target).toHaveTextContent('Original instructions old-session edit')
    expect(target.editor.can().undo()).toBe(true)
  }

  it('retains the outgoing editor for 200ms while releasing focus, scroll and commands immediately', async () => {
    const owner = mount()
    await advance(100)
    const oldEditor = editor()
    const tiptap = oldEditor.editor
    const panel = screen.getByRole('dialog', { name: 'Edit Draft' })
    const layer = panel.parentElement!
    owner.changeOwner(false, null)
    expect(screen.queryByRole('dialog', { name: 'Edit Draft' })).not.toBeInTheDocument()
    expect(owner.opener).toHaveFocus()
    expect(document.body.style.overflow).not.toBe('hidden')
    // Physical retention is separate from logical removal from the accessibility tree.
    expect(layer).toBeInTheDocument()
    expect(layer).toHaveAttribute('data-modal-state', 'closing')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.inert).toBe(true)
    expect(layer).toHaveClass('pointer-events-none')
    expect(oldEditor).toBeInTheDocument()
    expect(oldEditor).toHaveTextContent('Original instructions')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close assignment modal', hidden: true }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(owner.onClose).not.toHaveBeenCalled()
    expect(owner.onSuccess).not.toHaveBeenCalled()
    await advance(199)
    expect(oldEditor).toBeInTheDocument()
    expect(tiptap.isDestroyed).toBe(false)
    await advance(2)
    expect(layer).not.toBeInTheDocument()
    await advance(1) // useEditor destroys on its existing deferred unmount tick.
    expect(tiptap.isDestroyed).toBe(true)
    expect(writes()).toHaveLength(0)
  })

  it('ignores a pending real provenance response after logical close', async () => {
    const owner = mount()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('artifact_id=assignment-exit-A'), undefined)
    owner.changeOwner(false, null)
    await act(async () => {
      resolveProvenance({ ok: true, json: async () => ({ provenance: { source_blueprint_version_number: 19, unit_label: 'Late source' } }) } as Response)
    })
    expect(screen.queryByText('Drafted with Blueprint Version 19 · Late source')).not.toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    expect(owner.onSuccess).not.toHaveBeenCalled()
  })

  it('retires an open saved-attachment Remove confirmation on whole-owner close', async () => {
    const requirement = { id: 'saved-exit-link', type: 'link' as const, label: 'Saved link', instructions: '', required: true, position: 0, validation_policy_json: {} }
    const owner = mount({ ...assignment, submission_requirements: [requirement] } as Assignment)
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
    expect(screen.getByRole('dialog', { name: 'Remove attachment?' })).toBeInTheDocument()
    owner.changeOwner(false, null)
    expect.soft(screen.queryByRole('dialog', { name: 'Remove attachment?' })).not.toBeInTheDocument()
    expect.soft(owner.opener).toHaveFocus()
    expect.soft(document.body.style.overflow).not.toBe('hidden')
    await advance(3000)
    expect(writes()).toHaveLength(0)
    expect(owner.onSuccess).not.toHaveBeenCalled()
  })

  it('does not start a PATCH when an old focused title blurs after logical close', async () => {
    const owner = mount()
    await advance(100)
    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    fireEvent.change(title, { target: { value: 'Uncommitted old title' } })
    expect(writes()).toHaveLength(0)
    owner.changeOwner(false, null)
    expect.soft(writes()).toEqual([])
    // Exercise the retained callback in addition to layout focus restoration.
    fireEvent.blur(title)
    await advance(3000)
    expect(writes()).toHaveLength(0)
    expect(owner.onSuccess).not.toHaveBeenCalled()
  })

  it('opens a fresh Tiptap body before expiry and fences old-session undo', async () => {
    const owner = mount()
    await advance(100)
    const oldEditor = editor()
    const oldTiptap = oldEditor.editor
    editInstructions(oldEditor)
    owner.changeOwner(false, null)
    await advance(40)
    owner.changeOwner(true, assignment)
    const freshEditor = editor()
    expect.soft(freshEditor).not.toBe(oldEditor)
    expect.soft(freshEditor.editor).not.toBe(oldTiptap)
    expect(freshEditor).toHaveTextContent('Original instructions')
    expect.soft(freshEditor.editor.can().undo()).toBe(false)
    act(() => { freshEditor.editor.commands.undo() })
    expect(freshEditor).not.toHaveTextContent('old-session edit')
    await advance(200)
    expect(freshEditor).toBeInTheDocument()
    expect.soft(oldTiptap.isDestroyed).toBe(true)
    expect(writes()).toHaveLength(0)
  })

  it('keeps real undo and editor identity through preview within one open session', async () => {
    mount()
    await advance(100)
    const current = editor()
    editInstructions(current)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const preview = screen.getByRole('dialog', { name: 'Instructions' })
    fireEvent.click(within(preview).getByRole('button', { name: 'Close' }))
    expect(editor()).toBe(current)
    act(() => { current.editor.commands.undo() })
    expect(current).toHaveTextContent('Original instructions')
    expect(current).not.toHaveTextContent('old-session edit')
  })

  it('keeps the editor instance while resetting values for a same-ID external refresh', async () => {
    const owner = mount()
    await advance(100)
    const current = editor()
    editInstructions(current)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Old local title' } })
    owner.changeOwner(true, { ...assignment, title: 'Refreshed title', instructions_markdown: 'Refreshed instructions' })
    expect(editor()).toBe(current)
    expect(current).toHaveTextContent('Refreshed instructions')
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Refreshed title')
    await advance(3000)
    expect(writes()).toHaveLength(0)
  })

  it.each(['before close', 'during exit'] as const)('destroys the main editor when reduced motion changes %s', async (when) => {
    const owner = mount()
    const current = editor()
    const tiptap = current.editor
    if (when === 'before close') reducedMotion = true
    owner.changeOwner(false, null)
    if (when === 'during exit') {
      expect(current).toBeInTheDocument()
      act(() => { reducedMotion = true; motionListeners.forEach((listener) => listener()) })
    }
    expect(current).not.toBeInTheDocument()
    await advance(1)
    expect(tiptap.isDestroyed).toBe(true)
    expect(owner.opener).toHaveFocus()
    expect(writes()).toHaveLength(0)
  })

  it('destroys the outgoing editor on source unmount without waiting for exit expiry', async () => {
    const owner = mount()
    const current = editor()
    const tiptap = current.editor
    owner.changeOwner(false, null)
    expect(current).toBeInTheDocument()
    owner.unmount()
    expect(current).not.toBeInTheDocument()
    await advance(1)
    expect(tiptap.isDestroyed).toBe(true)
    await advance(3000)
    expect(writes()).toHaveLength(0)
  })

  it('retires a real open desktop Link portal while keeping the editor and toolbar footprint', async () => {
    const owner = mount()
    const current = editor()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting options' })
    fireEvent.click(screen.getByRole('button', { name: 'Link', exact: true }))
    expect(screen.getByPlaceholderText('Paste a link...')).toBeInTheDocument()
    owner.changeOwner(false, null)
    expect(screen.queryByPlaceholderText('Paste a link...')).not.toBeInTheDocument()
    expect(toolbar).not.toBeInTheDocument()
    expect(current.closest('.simple-editor-wrapper')?.querySelector('.tiptap-toolbar[data-variant="fixed"]')).toBeInTheDocument()
    expect(current).toBeInTheDocument()
    expect(current).toHaveTextContent('Original instructions')
    expect(current.editor.isEditable).toBe(false)
    expect(owner.opener).toHaveFocus()
    await advance(100)
    expect(owner.opener).toHaveFocus()
    expect(writes()).toHaveLength(0)
  })

  it('keeps an already displayed real source note and saved requirement presentation through exit', async () => {
    const requirement = { id: 'saved-source-link', type: 'link' as const, label: 'Preserved link', instructions: '', required: true, position: 0, validation_policy_json: {} }
    const owner = mount({ ...assignment, submission_requirements: [requirement] } as Assignment)
    await act(async () => {
      resolveProvenance({ ok: true, json: async () => ({ provenance: { source_blueprint_version_number: 7, unit_label: 'Visible source' } }) } as Response)
    })
    const note = screen.getByText('Drafted with Blueprint Version 7 · Visible source')
    const title = screen.getByRole('textbox', { name: 'Title' })
    const titleClass = title.className
    owner.changeOwner(false, null)
    expect(note).toBeInTheDocument()
    expect(title).toHaveValue('Original title')
    expect(title.className).toBe(titleClass)
    expect(title).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Link label', hidden: true })).toHaveValue('Preserved link')
    await advance(199)
    expect(note).toBeInTheDocument()
    await advance(1)
    expect(note).not.toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  it('retires an open real mobile Heading menu portal without deferred focus return into the exit', async () => {
    mobile = true
    const owner = mount()
    const current = editor()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Format text as heading' }), { key: 'ArrowDown' })
    await advance(0)
    expect(screen.getByRole('menuitem', { name: 'Heading 1' })).toBeInTheDocument()
    owner.changeOwner(false, null)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(current).toHaveTextContent('Original instructions')
    expect(current).toBeInTheDocument()
    await advance(100)
    expect(owner.opener).toHaveFocus()
    expect(document.body.style.overflow).not.toBe('hidden')
    expect(writes()).toHaveLength(0)
  })

  it('preserves the committed editor and undo when a concurrent close render is abandoned', () => {
    const pending = new Promise<void>(() => {})
    let suspendedAttempts = 0
    let change!: (open: boolean, suspend: boolean) => void
    function Suspender({ suspend }: { suspend: boolean }) {
      if (suspend) { suspendedAttempts += 1; throw pending }
      return null
    }
    function Parent() {
      const [state, setState] = useState({ open: true, suspend: false })
      change = (open, suspend) => setState({ open, suspend })
      return <Suspense fallback={<p>Pending parent</p>}>
        <AssignmentModal isOpen={state.open} classroomId="classroom-exit" assignment={assignment} onClose={vi.fn()} onSuccess={vi.fn()} />
        <Suspender suspend={state.suspend} />
      </Suspense>
    }
    render(<Parent />, { wrapper: TooltipProvider })
    const current = editor()
    editInstructions(current)
    act(() => { startTransition(() => change(false, true)) })
    expect(suspendedAttempts).toBeGreaterThan(0)
    expect(current).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit Draft' })).toBeInTheDocument()
    const title = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'Typed while close is suspended' } })
    expect(title).toHaveValue('Typed while close is suspended')
    act(() => { change(true, false) })
    expect(editor()).toBe(current)
    expect(current).toHaveTextContent('Original instructions old-session edit')
    expect(current.editor.can().undo()).toBe(true)
    expect(writes()).toHaveLength(0)
  })

  it('keeps an activated requirement drag through an abandoned close and retires it on external refresh', async () => {
    const pending = new Promise<void>(() => {})
    const record = { ...assignment, submission_requirements: ['First', 'Second'].map((label, position) => ({
      id: label, type: 'link' as const, label, instructions: '', required: true, position, validation_policy_json: {},
    })) } as Assignment
    let suspendedAttempts = 0
    let change!: (open: boolean, suspend: boolean, nextRecord?: Assignment) => void
    function Suspender({ suspend }: { suspend: boolean }) {
      if (suspend) { suspendedAttempts += 1; throw pending }
      return null
    }
    function Parent() {
      const [state, setState] = useState({ open: true, suspend: false, record })
      change = (open, suspend, nextRecord = state.record) => setState({ open, suspend, record: nextRecord })
      return <Suspense fallback={<p>Pending parent</p>}>
        <AssignmentModal isOpen={state.open} classroomId="classroom-exit" assignment={state.record} onClose={vi.fn()} onSuccess={vi.fn()} />
        <Suspender suspend={state.suspend} />
      </Suspense>
    }
    render(<Parent />, { wrapper: TooltipProvider })
    const current = editor()
    const handle = screen.getByRole('button', { name: 'Drag to reorder First' })
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' })
    await advance(0)
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    act(() => { startTransition(() => change(false, true)) })
    expect(suspendedAttempts).toBeGreaterThan(0)
    const duringSuspension = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true })
    act(() => { document.dispatchEvent(duringSuspension) })
    expect(duringSuspension.defaultPrevented).toBe(true)
    act(() => { change(true, false) })
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Committed open edit' } })
    expect(screen.getByRole('button', { name: 'Drag to reorder First' })).toBe(handle)
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    const afterEdit = new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true })
    act(() => { document.dispatchEvent(afterEdit) })
    expect(afterEdit.defaultPrevented).toBe(true)
    act(() => { change(true, false, { ...record, title: 'External refresh' }) })
    expect(screen.getByRole('button', { name: 'Drag to reorder First' })).not.toBe(handle)
    expect(editor()).toBe(current)
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('External refresh')
    const afterRefresh = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true })
    act(() => { document.dispatchEvent(afterRefresh) })
    expect(afterRefresh.defaultPrevented).toBe(false)
    expect(writes()).toHaveLength(0)
  })
})
