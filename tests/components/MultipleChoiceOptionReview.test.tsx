import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MultipleChoiceOptionReview } from '@/components/MultipleChoiceOptionReview'

describe('MultipleChoiceOptionReview', () => {
  it('labels selected correct and incorrect answer states', () => {
    render(
      <MultipleChoiceOptionReview
        options={['Mercury', 'Venus', 'Earth']}
        selectedOption={1}
        correctOption={2}
      />,
    )

    const options = screen.getByRole('list', { name: 'Multiple choice answer options' })
    expect(within(options).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByLabelText('Your answer, incorrect')).toBeInTheDocument()
    expect(screen.getByLabelText('Correct answer')).toBeInTheDocument()
  })

  it('labels a selected correct answer without exposing invalid indexes', () => {
    const { rerender } = render(
      <MultipleChoiceOptionReview
        options={['Mercury', 'Venus', 'Earth']}
        selectedOption={2}
        correctOption={2}
      />,
    )

    expect(screen.getByLabelText('Your answer, correct')).toBeInTheDocument()

    rerender(
      <MultipleChoiceOptionReview
        options={['Mercury', 'Venus', 'Earth']}
        selectedOption={9}
        correctOption={-1}
      />,
    )

    expect(screen.queryByLabelText('Your answer, correct')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Your answer, incorrect')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Correct answer')).not.toBeInTheDocument()
  })
})
