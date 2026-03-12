import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudentQuizForm } from '@/components/StudentQuizForm'
import { createMockQuizQuestion } from '../helpers/mocks'

describe('StudentQuizForm preview mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('simulates submit without saving data', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="test-preview-id"
        questions={[
          createMockQuizQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        assessmentType="test"
        previewMode
        onSubmitted={onSubmitted}
      />
    )

    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate Submit' }))

    await waitFor(() => {
      expect(screen.getByText('Preview mode only. Submission was not saved.')).toBeInTheDocument()
    })

    expect(global.fetch).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
  })
})
