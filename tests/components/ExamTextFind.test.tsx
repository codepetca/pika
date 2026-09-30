import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { ExamDocumentWorkspace, type ExamDocumentItem } from '@/components/ExamDocumentWorkspace'

const documents: ExamDocumentItem[] = [
  { id: 'text-1', title: 'Loop reference', source: 'text', content: 'A **loop** repeats.' },
  { id: 'text-2', title: 'Other reference', source: 'text', content: 'Second loop.' },
  { id: 'pdf', title: 'PDF loop', source: 'upload', url: '/loop.pdf', isPdf: true },
]
function Harness({ locked = false, resetKey = 'exam-1' }: { locked?: boolean; resetKey?: string }) {
  const [active, setActive] = useState<ExamDocumentItem | null>(null)
  return <TooltipProvider><ExamDocumentWorkspace enableTextFind textFindLocked={locked} resetKey={resetKey}
    activeDocument={active} documents={documents} onOpenDocument={setActive} onCloseDocument={() => setActive(null)}
    questionsPane={<section><QuestionMarkdown content="Explain a loop." /><label>Your answer<textarea aria-label="Your answer" /></label></section>}
  /></TooltipProvider>
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('Highlight', class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges) } })
  vi.stubGlobal('CSS', { highlights: new Map() })
})

describe('exam text find', () => {
  it('intercepts Ctrl/Cmd+F, cycles question and unopened reference matches, and preserves drafts and focus', async () => {
    render(<Harness />)
    const answer = screen.getByRole('textbox', { name: 'Your answer' })
    fireEvent.change(answer, { target: { value: 'Unsaved loop answer' } })
    answer.focus()
    expect(fireEvent.keyDown(window, { key: 'f', ctrlKey: true })).toBe(false)
    const input = await screen.findByRole('textbox', { name: 'Find in exam' })
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.change(input, { target: { value: 'loop' } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 of 3 · Exam'))
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 of 3 · Loop reference'))
    expect(input).toHaveFocus()
    expect(document.querySelector('[data-exam-find-document="text-1"]')).not.toHaveClass('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Back to documents list' }))
    expect(screen.queryByRole('button', { name: 'Back to documents list' })).not.toBeInTheDocument()
    input.focus()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('3 of 3 · Other reference'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 · Exam')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('3 of 3 · Other reference')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(answer).toHaveValue('Unsaved loop answer')
    expect(answer).toHaveFocus()
    expect(CSS.highlights.size).toBe(0)
    expect(fireEvent.keyDown(window, { key: 'f', metaKey: true })).toBe(false)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Find in exam' })).toHaveFocus())
  })

  it('shows no results and clears the query for a different attempt', async () => {
    const { rerender } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Find in exam' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in exam' }), { target: { value: 'missing' } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No matches'))
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()
    rerender(<Harness resetKey="exam-2" />)
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Find in exam' }))
    expect(screen.getByRole('textbox', { name: 'Find in exam' })).toHaveValue('')
  })

  it('blocks find while locked, clears highlights, and leaves genuine focus signals alone', async () => {
    const listener = vi.fn()
    window.addEventListener('blur', listener)
    const { rerender } = render(<Harness />)
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in exam' }), { target: { value: 'loop' } })
    await waitFor(() => expect(CSS.highlights.size).toBe(2))
    act(() => window.dispatchEvent(new Event('blur')))
    expect(listener).toHaveBeenCalledOnce()
    rerender(<Harness locked />)
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(CSS.highlights.size).toBe(0)
    expect(fireEvent.keyDown(window, { key: 'f', ctrlKey: true })).toBe(false)
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    window.removeEventListener('blur', listener)
  })
})
