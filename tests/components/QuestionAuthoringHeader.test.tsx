import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionAuthoringHeader } from '@/components/assessment/QuestionAuthoringHeader'
import { TooltipProvider } from '@/ui'

describe('QuestionAuthoringHeader', () => {
  it('keeps question context, navigation, save status and accessible icon modes together', () => {
    const onModeChange = vi.fn()
    render(<TooltipProvider><QuestionAuthoringHeader questionNumber={2} navigation={<span>Question navigation fixture</span>} status="saving" mode="edit" onModeChange={onModeChange} /></TooltipProvider>)
    expect(screen.getByText('Q2')).toBeVisible()
    expect(screen.getByText('Question navigation fixture')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Saving')
    expect(screen.getByRole('button', { name: 'Write' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Write' }), { key: 'ArrowRight' })
    expect(onModeChange).toHaveBeenCalledWith('markdown')
    expect(screen.getByRole('button', { name: 'Markdown' })).toHaveFocus()
  })

  it('prevents leaving pending source edits through either click or keyboard', () => {
    const onModeChange = vi.fn()
    render(<TooltipProvider><QuestionAuthoringHeader questionNumber={1} navigation={null} status="unsaved" mode="markdown" onModeChange={onModeChange} writeDisabled /></TooltipProvider>)
    expect(screen.getByRole('button', { name: 'Write' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Markdown' }), { key: 'ArrowLeft' })
    expect(onModeChange).not.toHaveBeenCalledWith('edit')
  })
})
