import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuizResultsView } from '@/components/QuizResultsView'
import type { QuizResultsAggregate } from '@/types'

const sampleResults: QuizResultsAggregate[] = [
  {
    question_id: 'q1',
    question_text: 'What is the capital of France?',
    options: ['London', 'Paris', 'Berlin', 'Madrid'],
    counts: [2, 15, 1, 2],
    total_responses: 20,
  },
  {
    question_id: 'q2',
    question_text: 'Which planet is closest to the sun?',
    options: ['Venus', 'Mercury', 'Earth'],
    counts: [5, 12, 3],
    total_responses: 20,
  },
]

describe('QuizResultsView', () => {
  it('shows empty state when results is null', () => {
    render(<QuizResultsView results={null} />)
    expect(screen.getByText('No responses yet.')).toBeInTheDocument()
  })

  it('shows empty state when results is empty', () => {
    render(<QuizResultsView results={[]} />)
    expect(screen.getByText('No responses yet.')).toBeInTheDocument()
  })

  it('renders question text with numbers', () => {
    render(<QuizResultsView results={sampleResults} />)

    expect(screen.getByText('Q1. What is the capital of France?')).toBeInTheDocument()
    expect(screen.getByText('Q2. Which planet is closest to the sun?')).toBeInTheDocument()
  })

  it('renders all options for each question', () => {
    render(<QuizResultsView results={sampleResults} />)

    expect(screen.getByText('London')).toBeInTheDocument()
    expect(screen.getByText('Paris')).toBeInTheDocument()
    expect(screen.getByText('Berlin')).toBeInTheDocument()
    expect(screen.getByText('Madrid')).toBeInTheDocument()
    expect(screen.getByText('Venus')).toBeInTheDocument()
    expect(screen.getByText('Mercury')).toBeInTheDocument()
  })

  it('renders counts and percentages', () => {
    render(<QuizResultsView results={sampleResults} />)

    // Paris: 15/20 = 75%
    expect(screen.getByText('15 (75%)')).toBeInTheDocument()
    // Mercury: 12/20 = 60%
    expect(screen.getByText('12 (60%)')).toBeInTheDocument()
    // London and Madrid both: 2/20 = 10%
    expect(screen.getAllByText('2 (10%)')).toHaveLength(2)
  })

  it('renders total response count per question', () => {
    render(<QuizResultsView results={sampleResults} />)

    const responseTexts = screen.getAllByText('20 responses')
    expect(responseTexts).toHaveLength(2)
  })

  it('renders bar widths as percentages', () => {
    const { container } = render(<QuizResultsView results={[sampleResults[0]]} />)

    // Paris bar should be 75% width
    const bars = container.querySelectorAll('.bg-primary')
    const parisBar = bars[1] // second option (index 1)
    expect(parisBar).toHaveStyle({ width: '75%' })
  })

  it('does not render any responder list', () => {
    render(<QuizResultsView results={sampleResults} />)

    // Should NOT have a "Responded" section — that was removed
    expect(screen.queryByText(/Responded/)).not.toBeInTheDocument()
  })

  it('handles single response correctly', () => {
    const single: QuizResultsAggregate[] = [
      {
        question_id: 'q1',
        question_text: 'Yes or no?',
        options: ['Yes', 'No'],
        counts: [1, 0],
        total_responses: 1,
      },
    ]
    render(<QuizResultsView results={single} />)

    expect(screen.getByText('1 response')).toBeInTheDocument() // singular
    expect(screen.getByText('1 (100%)')).toBeInTheDocument()
    expect(screen.getByText('0 (0%)')).toBeInTheDocument()
  })
})
