import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ExamDocumentWorkspace,
  type ExamDocumentItem,
} from '@/components/ExamDocumentWorkspace'

const DOCUMENTS: ExamDocumentItem[] = [
  {
    id: 'text-doc',
    title: 'Unit 1 Docs',
    source: 'text',
    content: 'Reference content',
  },
  {
    id: 'link-doc',
    title: 'API reference',
    source: 'link',
    url: '/api/reference',
  },
  {
    id: 'unavailable-doc',
    title: 'Unavailable reference',
    source: 'link',
  },
]

function Harness({ onDocumentInteraction = vi.fn() }: { onDocumentInteraction?: () => void }) {
  const [activeDocument, setActiveDocument] = useState<ExamDocumentItem | null>(null)

  return (
    <ExamDocumentWorkspace
      activeDocument={activeDocument}
      documents={DOCUMENTS}
      questionsPane={(
        <section aria-label="Test questions">
          <label htmlFor="answer">Answer</label>
          <input id="answer" />
        </section>
      )}
      onCloseDocument={() => setActiveDocument(null)}
      onOpenDocument={setActiveDocument}
      onDocumentInteraction={onDocumentInteraction}
      resetKey="test-1"
      splitTestId="exam-document-split"
    />
  )
}

describe('ExamDocumentWorkspace', () => {
  it('keeps the list at 30/70 and preloads iframe documents before one is opened', () => {
    render(<Harness />)

    const split = screen.getByTestId('exam-document-split').parentElement
    expect(split).toHaveStyle('--exam-documents-grow: 30')
    expect(split).toHaveStyle('--exam-questions-grow: 70')
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByTitle('API reference')).toHaveAttribute('loading', 'eager')
    expect(screen.getByTitle('API reference')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('region', { name: 'Test documents' }).parentElement)
      .toHaveClass('flex-1')
    expect(screen.getByRole('region', { name: 'Test questions' }).parentElement)
      .toHaveClass('flex-1')
  })

  it('opens with a persistent header, focuses Back, and restores focus to the trigger', async () => {
    render(<Harness />)

    const documentButton = screen.getByRole('button', { name: 'Unit 1 Docs' })
    fireEvent.click(documentButton)

    const backButton = screen.getByRole('button', { name: 'Back to documents list' })
    await waitFor(() => expect(backButton).toHaveFocus())
    expect(screen.getByRole('heading', { name: 'Unit 1 Docs' })).toBeInTheDocument()
    expect(screen.getByText('Reference content')).toBeInTheDocument()

    fireEvent.click(backButton)
    await waitFor(() => expect(documentButton).toHaveFocus())
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument()
  })

  it('clamps pointer and keyboard resizing between 30 and 50 percent', () => {
    const onDocumentInteraction = vi.fn()
    render(<Harness onDocumentInteraction={onDocumentInteraction} />)
    fireEvent.click(screen.getByRole('button', { name: 'API reference' }))

    const split = screen.getByTestId('exam-document-split').parentElement!
    const separator = screen.getByRole('separator', {
      name: 'Resize documents and questions panes',
    })
    expect(separator).toHaveAttribute('aria-valuemin', '30')
    expect(separator).toHaveAttribute('aria-valuemax', '50')
    expect(separator).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByTitle('API reference')).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator).toHaveAttribute('aria-valuenow', '45')
    expect(split).toHaveStyle('--exam-documents-grow: 45')
    expect(split).toHaveStyle('--exam-questions-grow: 55')

    fireEvent.keyDown(separator, { key: 'Home' })
    expect(separator).toHaveAttribute('aria-valuenow', '30')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator).toHaveAttribute('aria-valuenow', '30')
    fireEvent.keyDown(separator, { key: 'End' })
    expect(separator).toHaveAttribute('aria-valuenow', '50')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', '50')

    vi.spyOn(split, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({}),
    })
    let pointerMoveListener: ((event: PointerEvent) => void) | undefined
    const originalAddEventListener = window.addEventListener.bind(window)
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'pointermove') {
        pointerMoveListener = listener as (event: PointerEvent) => void
      }
      return originalAddEventListener(type, listener, options)
    })
    fireEvent.pointerDown(separator, { clientX: 500 })
    act(() => pointerMoveListener?.({ clientX: 100 } as PointerEvent))
    expect(separator).toHaveAttribute('aria-valuenow', '30')
    act(() => pointerMoveListener?.({ clientX: 900 } as PointerEvent))
    expect(separator).toHaveAttribute('aria-valuenow', '50')
    addEventListener.mockRestore()
    expect(onDocumentInteraction).toHaveBeenCalled()
  })

  it('remembers the open-document width across Back and resets it on double click', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'API reference' }))
    let separator = screen.getByRole('separator', { name: 'Resize documents and questions panes' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator).toHaveAttribute('aria-valuenow', '40')

    fireEvent.click(screen.getByRole('button', { name: 'Back to documents list' }))
    const split = screen.getByTestId('exam-document-split').parentElement!
    expect(split).toHaveStyle('--exam-documents-grow: 30')
    expect(split).toHaveStyle('--exam-questions-grow: 70')

    fireEvent.click(screen.getByRole('button', { name: 'API reference' }))
    separator = screen.getByRole('separator', { name: 'Resize documents and questions panes' })
    expect(separator).toHaveAttribute('aria-valuenow', '40')
    fireEvent.doubleClick(separator)
    expect(separator).toHaveAttribute('aria-valuenow', '50')
  })

  it('keeps question input state mounted through document navigation and resizing', () => {
    render(<Harness />)
    const answer = screen.getByRole('textbox', { name: 'Answer' })
    fireEvent.change(answer, { target: { value: 'Unsaved answer' } })

    fireEvent.click(screen.getByRole('button', { name: 'API reference' }))
    const separator = screen.getByRole('separator', { name: 'Resize documents and questions panes' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to documents list' }))

    expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue('Unsaved answer')
  })

  it('shows a bounded unavailable state without unmounting preloaded iframe documents', () => {
    render(<Harness />)
    const iframe = screen.getByTitle('API reference')
    fireEvent.click(screen.getByRole('button', { name: 'Unavailable reference' }))

    expect(screen.getByText('This document is unavailable.')).toBeInTheDocument()
    expect(screen.getByTitle('API reference')).toBe(iframe)
  })
})
