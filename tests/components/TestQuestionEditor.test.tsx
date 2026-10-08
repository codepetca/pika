import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('grows a blank split option and keeps the correct answer when options move', async () => {
    const onChange = vi.fn()
    render(
      <TestQuestionEditor
        question={createMockTestQuestion({
          id: 'question-split',
          question_text: 'Choose one answer.',
          question_type: 'multiple_choice',
          options: ['First', 'Second'],
          correct_option: 1,
        })}
        questionNumber={1}
        isEditable
        onChange={onChange}
        onDelete={vi.fn()}
        variant="split"
      />,
    )

    const blankOption = await screen.findByRole('textbox', { name: 'Question 1 option C' })
    expect(blankOption).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Remove question 1 option C' })).not.toBeInTheDocument()
    fireEvent.change(blankOption, { target: { value: 'Third' } })
    expect(screen.getByRole('textbox', { name: 'Question 1 option C' })).toHaveValue('Third')
    expect(screen.getByRole('textbox', { name: 'Question 1 option D' })).toHaveValue('')
    fireEvent.blur(screen.getByRole('textbox', { name: 'Question 1 option C' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: ['First', 'Second', 'Third'] }), expect.anything())

    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder option C/ }), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      options: ['First', 'Third', 'Second'],
      correct_option: 2,
    }), expect.anything())
  })
})

it.each(['card', 'accordion', 'detail', 'split'] as const)('keeps the %s prompt and choice text editable but locks grading after Start', async (variant) => {
  const onChange = vi.fn()
  render(<TestQuestionEditor question={createMockTestQuestion({ question_type: 'multiple_choice', options: ['One', 'Two', 'Three', 'Four'], correct_option: 0 })} questionNumber={1} isEditable structureLocked variant={variant} onChange={onChange} onDelete={vi.fn()} />)
  expect(await screen.findByRole('textbox', { name: 'Question 1 prompt' })).toHaveAttribute('contenteditable', 'true')
  const choice = screen.getByRole('textbox', { name: 'Question 1 option A' })
  expect(choice).toBeEnabled()
  fireEvent.change(choice, { target: { value: 'Corrected one' } })
  fireEvent.blur(choice)
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ options: ['Corrected one', 'Two', 'Three', 'Four'], correct_option: 0 }), { force: true })
  if (variant === 'split') {
    expect(screen.getByRole('button', { name: 'Mark option A correct' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Reorder option A/ })).toBeDisabled()
  } else {
    expect(screen.getByRole('radio', { name: 'Question 1 option A correct answer' })).toBeDisabled()
  }
  expect(screen.queryByRole('spinbutton', { name: 'Question 1 points' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Drag to reorder' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Delete|Duplicate/ })).not.toBeInTheDocument()
})
