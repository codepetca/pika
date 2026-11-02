import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionAuthoringHeader } from '@/components/assessment/QuestionAuthoringHeader'
import { AuthoringModeControl } from '@/components/creation/AuthoringModeControl'
import { TooltipProvider } from '@/ui'

describe('question authoring controls', () => {
  it('keeps question context, navigation, save status and actions together', () => {
    render(<TooltipProvider><QuestionAuthoringHeader questionNumber={2} navigation={<span>Question navigation fixture</span>} status="saving" actions={<button>Question actions</button>} /></TooltipProvider>)
    expect(screen.getByText('Q2')).toBeVisible()
    expect(screen.getByText('Question navigation fixture')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Saving')
    expect(screen.getByRole('button', { name: 'Question actions' })).toBeVisible()
  })

  it('supports keyboard selection and prevents leaving pending source edits', () => {
    const onChange = vi.fn()
    const { rerender } = render(<AuthoringModeControl ariaLabel="Editing mode" value="write" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Write' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('markdown')
    expect(screen.getByRole('button', { name: 'Markdown' })).toHaveFocus()
    onChange.mockClear()
    rerender(<AuthoringModeControl ariaLabel="Editing mode" value="markdown" onChange={onChange} writeDisabled />)
    expect(screen.getByRole('button', { name: 'Write' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Markdown' }), { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalledWith('write')
  })
})
