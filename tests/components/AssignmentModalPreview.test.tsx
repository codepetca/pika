import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssignmentModal } from '@/components/AssignmentModal'
import { TooltipProvider } from '@/ui'
import { toTorontoEndOfDayIso } from '@/lib/timezone'
import type { Assignment } from '@/types'

vi.mock('@/components/ClassroomBlueprintDraftSource', () => ({
  ClassroomBlueprintDraftSource: () => null,
}))

const assignment: Assignment = {
  id: 'assignment-preview-1', classroom_id: 'classroom-1', title: 'Original title',
  description: 'Original instructions', instructions_markdown: 'Original instructions',
  due_at: toTorontoEndOfDayIso('2026-10-20'), position: 0, released_at: null,
  track_authenticity: true, created_by: 'teacher-1', is_draft: true,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
}

describe('AssignmentModal Instructions preview lifecycle with the real editor', () => {
  let reducedMotion: boolean
  let motionListeners: Set<() => void>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    reducedMotion = false
    motionListeners = new Set()
    const originalComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalComputedStyle(element)
      style.setProperty('--motion-duration-standard', '180ms')
      return style
    })
    const originalMatchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => query === '(prefers-reduced-motion: reduce)' ? ({
      media: query,
      get matches() { return reducedMotion },
      addEventListener: (_event: string, listener: () => void) => motionListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener),
    }) as MediaQueryList : originalMatchMedia(query))
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignment }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mount(record: Assignment | null = assignment) {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const result = render(
      <AssignmentModal isOpen classroomId="classroom-1" assignment={record} onClose={onClose} onSuccess={onSuccess} />,
      { wrapper: TooltipProvider },
    )
    return { ...result, onClose, onSuccess }
  }

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  function openPreview() {
    const opener = screen.getByRole('button', { name: 'Preview' })
    opener.focus()
    fireEvent.click(opener)
    const preview = screen.getByRole('dialog', { name: 'Instructions' })
    return { opener, preview, layer: preview.parentElement! }
  }

  it('does not let the initial title-focus callback steal focus from a quick preview', async () => {
    mount()
    const { preview } = openPreview()
    const close = within(preview).getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    await advance(100)
    expect(close).toHaveFocus()
  })

  it('does not let post-create title focus steal focus after a quick preview dismissal', async () => {
    let resolveCreate!: (response: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve }))
    mount(null)
    // Let the initial open timer finish while creation is still pending. The
    // response then starts the separate post-create callback under test.
    await advance(100)
    await act(async () => {
      resolveCreate({ ok: true, json: async () => ({ assignment }) })
    })
    const editor = screen.getByRole('textbox', { name: 'Instructions' })
    const { preview } = openPreview()
    fireEvent.click(within(preview).getByRole('button', { name: 'Close' }))
    editor.focus()
    await advance(100)
    expect(editor).toHaveFocus()
  })

  it('cancels the old title callback when an assignment session is replaced', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const { rerender } = render(
      <AssignmentModal isOpen classroomId="classroom-1" assignment={assignment} onClose={onClose} onSuccess={onSuccess} />,
      { wrapper: TooltipProvider },
    )
    await advance(40)
    rerender(<AssignmentModal isOpen classroomId="classroom-1" assignment={{ ...assignment, id: 'second-session', title: 'Second title' }} onClose={onClose} onSuccess={onSuccess} />)
    const editor = screen.getByRole('textbox', { name: 'Instructions' })
    editor.focus()
    await advance(60)
    expect(editor).toHaveFocus()
    await advance(40)
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus()
  })

  it('dismisses the previous preview when another assignment replaces an open owner', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const { rerender } = render(
      <AssignmentModal isOpen classroomId="classroom-1" assignment={assignment} onClose={onClose} onSuccess={onSuccess} />,
      { wrapper: TooltipProvider },
    )
    const { preview, layer } = openPreview()
    rerender(<AssignmentModal isOpen classroomId="classroom-1" assignment={{ ...assignment, id: 'second-session', instructions_markdown: 'Second instructions' }} onClose={onClose} onSuccess={onSuccess} />)
    expect(screen.queryByRole('dialog', { name: 'Instructions' })).not.toBeInTheDocument()
    expect(layer).toHaveAttribute('data-modal-state', 'closing')
    expect(preview).toHaveTextContent('Original instructions')
    expect(preview).not.toHaveTextContent('Second instructions')
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveTextContent('Second instructions')
    const next = openPreview()
    expect(next.preview).toHaveTextContent('Second instructions')
    expect(next.preview).not.toHaveTextContent('Original instructions')
    await advance(180)
    expect(next.preview).toBeInTheDocument()
    expect(within(next.preview).getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each(['header', 'Escape', 'backdrop'] as const)('dismisses via %s with immediate focus and no assignment command', async (method) => {
    const { onClose, onSuccess } = mount()
    await advance(100)
    const editor = screen.getByRole('textbox', { name: 'Instructions' })
    const { opener, preview, layer } = openPreview()
    if (method === 'header') fireEvent.click(within(preview).getByRole('button', { name: 'Close' }))
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (method === 'backdrop') fireEvent.click(within(layer).getByRole('button', { name: 'Close dialog' }))

    expect(screen.queryByRole('dialog', { name: 'Instructions' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit Draft' })).toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(layer).toHaveAttribute('data-modal-state', 'closing')
    expect(layer).toBeInTheDocument()
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.inert).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor)
    expect(editor).toHaveTextContent('Original instructions')
    // The retained close control cannot issue another dismissal command.
    fireEvent.click(within(preview).getByRole('button', { name: 'Close', hidden: true }))
    await advance(180)
    expect(layer).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains outgoing instructions while typing, reopens current text, and preserves real undo history', async () => {
    mount()
    await advance(100)
    const editor = screen.getByRole('textbox', { name: 'Instructions' }) as HTMLElement & { editor: Editor }
    const { preview, layer } = openPreview()
    fireEvent.click(within(preview).getByRole('button', { name: 'Close' }))
    editor.focus()
    // Exercise the mounted Tiptap editor's transaction/history, without replacing it
    // or relying on jsdom's incomplete contenteditable keyboard selection support.
    const tiptap = editor.editor
    act(() => { tiptap.commands.insertContentAt(tiptap.state.doc.content.size - 1, ' updated') })
    expect(editor).toHaveTextContent('Original instructions updated')
    expect(preview).toHaveTextContent('Original instructions')
    expect(preview).not.toHaveTextContent('updated')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    await advance(80)
    const reopened = openPreview()
    await advance(0) // Flush the existing blur-triggered save, independent of preview dismissal.
    const writesBeforeDismissal = fetchMock.mock.calls.length
    expect(reopened.layer).toBe(layer)
    expect(reopened.preview).toHaveTextContent('Original instructions updated')
    await advance(180)
    expect(reopened.preview).toBeInTheDocument()
    expect(reopened.layer).toHaveAttribute('data-modal-state', 'open')
    fireEvent.click(within(reopened.preview).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor)
    editor.focus()
    act(() => { fireEvent.keyDown(editor, { key: 'z', code: 'KeyZ', ctrlKey: true }) })
    expect(editor).toHaveTextContent('Original instructions')
    expect(editor).not.toHaveTextContent('updated')
    await advance(180)
    expect(editor).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledTimes(writesBeforeDismissal)
  })

  it('immediately tears down the owner editor and never activates stale preview text in a new assignment session', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    function Harness() {
      const [record, setRecord] = useState<Assignment | null>(assignment)
      const [open, setOpen] = useState(true)
      return <>
        <button onClick={() => { setOpen(false); setRecord(null) }}>Parent close</button>
        <button onClick={() => { setRecord({ ...assignment, id: 'assignment-2', title: 'Second title', instructions_markdown: 'Second instructions' }); setOpen(true) }}>Second session</button>
        <AssignmentModal isOpen={open} classroomId="classroom-1" assignment={record} onClose={onClose} onSuccess={onSuccess} />
      </>
    }
    render(<Harness />, { wrapper: TooltipProvider })
    const editor = screen.getByRole('textbox', { name: 'Instructions' }) as HTMLElement & { editor: Editor }
    const originalTiptap = editor.editor
    const { preview, layer } = openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Parent close', hidden: true }))
    expect(editor).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Edit Draft' })).not.toBeInTheDocument()
    expect(layer).toHaveAttribute('data-modal-state', 'closing')
    // useEditor owns its existing deferred destroy tick; preview retention must
    // not keep that instance alive for the 180 ms visual exit.
    await advance(1)
    expect(originalTiptap.isDestroyed).toBe(true)
    await advance(39)
    fireEvent.click(screen.getByRole('button', { name: 'Second session' }))
    const newEditor = screen.getByRole('textbox', { name: 'Instructions' })
    expect(newEditor).not.toBe(editor)
    expect(newEditor).toHaveTextContent('Second instructions')
    expect(screen.queryByRole('dialog', { name: 'Instructions' })).not.toBeInTheDocument()
    expect(preview).toHaveTextContent('Original instructions')
    const activePreview = openPreview()
    expect(activePreview.preview).toHaveTextContent('Second instructions')
    expect(activePreview.preview).not.toHaveTextContent('Original instructions')
    await advance(180)
    expect(within(activePreview.preview).getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(activePreview.preview).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['before close', 'during exit'] as const)('removes preview immediately when reduced motion changes %s', async (when) => {
    mount()
    await advance(100)
    const { opener, preview, layer } = openPreview()
    if (when === 'before close') reducedMotion = true
    fireEvent.click(within(preview).getByRole('button', { name: 'Close' }))
    if (when === 'during exit') {
      expect(layer).toBeInTheDocument()
      act(() => { reducedMotion = true; motionListeners.forEach((listener) => listener()) })
    }
    expect(layer).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveTextContent('Original instructions')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
