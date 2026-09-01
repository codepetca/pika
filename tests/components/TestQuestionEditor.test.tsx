import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TestQuestionEditor } from '@/components/TestQuestionEditor'
import { createMockTestQuestion } from '../helpers/mocks'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

describe('TestQuestionEditor', () => {
  it('uses compact WYSIWYG for the prompt and structured option inputs', async () => {
    render(
      <TestQuestionEditor
        question={createMockTestQuestion({
          id: 'question-1',
          question_text: 'Choose **one** answer.',
          question_type: 'multiple_choice',
          options: ['First', 'Second'],
          correct_option: 0,
        })}
        questionNumber={1}
        isEditable
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const prompt = await screen.findByRole('textbox', { name: 'Question 1 prompt' })
    expect(prompt).toHaveTextContent('Choose one answer.')
    expect(
      within(prompt.closest('.simple-editor-wrapper')!)
        .getByRole('toolbar', { name: 'Formatting options' }),
    ).toHaveAttribute('data-toolbar-preset', 'compact')
    expect(screen.getByRole('textbox', { name: 'Question 1 option A' })).toHaveValue('First')
    expect(screen.getByRole('textbox', { name: 'Question 1 option B' })).toHaveValue('Second')
  })
})

it.each(['card', 'accordion', 'detail'] as const)('keeps the %s prompt editable but locks choices and grading after Start', async (variant) => {
  render(<TestQuestionEditor question={createMockTestQuestion({ question_type: 'multiple_choice', options: ['One', 'Two', 'Three', 'Four'] })} questionNumber={1} isEditable structureLocked variant={variant} onChange={vi.fn()} onDelete={vi.fn()} />)
  expect(await screen.findByRole('textbox', { name: 'Question 1 prompt' })).toHaveAttribute('contenteditable', 'true')
  expect(screen.queryByRole('textbox', { name: 'Question 1 option A' })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Question 1 option A correct answer' })).toBeDisabled()
  expect(screen.queryByRole('spinbutton', { name: 'Question 1 points' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Drag to reorder' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Delete|Duplicate/ })).not.toBeInTheDocument()
})
