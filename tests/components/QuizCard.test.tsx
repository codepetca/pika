import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QuizCard } from '@/components/QuizCard'
import { TooltipProvider } from '@/ui'
import { createMockQuiz } from '../helpers/mocks'
import type { QuizWithStats } from '@/types'

// Mock useRightSidebar — not used directly by QuizCard but imported transitively
vi.mock('@/components/layout', () => ({
  useRightSidebar: () => ({ setOpen: vi.fn() }),
}))

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

function makeQuizWithStats(overrides: Partial<QuizWithStats> = {}): QuizWithStats {
  const base = createMockQuiz(overrides)
  return {
    ...base,
    stats: { total_students: 25, responded: 10, questions_count: 3 },
    ...overrides,
  } as QuizWithStats
}

describe('QuizCard', () => {
  const defaultProps = {
    isSelected: false,
    isReadOnly: false,
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onQuizUpdate: vi.fn(),
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders quiz title and response stats', () => {
    const quiz = makeQuizWithStats({ title: 'Chapter 1 Quiz' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByText('Chapter 1 Quiz')).toBeInTheDocument()
    expect(screen.getByText('10/25 responded')).toBeInTheDocument()
  })

  it('shows Draft badge for draft quizzes', () => {
    const quiz = makeQuizWithStats({ status: 'draft' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('shows Active badge for active quizzes', () => {
    const quiz = makeQuizWithStats({ status: 'active' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('shows Closed badge for closed quizzes', () => {
    const quiz = makeQuizWithStats({ status: 'closed' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByText('Closed')).toBeInTheDocument()
  })

  it('calls onSelect when card is clicked', () => {
    const onSelect = vi.fn()
    const quiz = makeQuizWithStats()
    render(<QuizCard quiz={quiz} {...defaultProps} onSelect={onSelect} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByText(quiz.title))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows activate button for draft quizzes with questions', () => {
    const quiz = makeQuizWithStats({ status: 'draft' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByLabelText('Activate quiz')).toBeInTheDocument()
  })

  it('shows close button for active quizzes', () => {
    const quiz = makeQuizWithStats({ status: 'active' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByLabelText('Close quiz')).toBeInTheDocument()
  })

  it('shows reopen button for closed quizzes', () => {
    const quiz = makeQuizWithStats({ status: 'closed' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByLabelText('Reopen quiz')).toBeInTheDocument()
  })

  it('shows eye icon reflecting show_results state', () => {
    const quiz = makeQuizWithStats({ show_results: true })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByLabelText('Hide results from students')).toBeInTheDocument()
  })

  it('shows eye-off icon when results are hidden', () => {
    const quiz = makeQuizWithStats({ show_results: false })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    expect(screen.getByLabelText('Show results to students')).toBeInTheDocument()
  })

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn()
    const quiz = makeQuizWithStats({ title: 'My Quiz' })
    render(<QuizCard quiz={quiz} {...defaultProps} onDelete={onDelete} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByLabelText('Delete My Quiz'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('disables action buttons when isReadOnly', () => {
    const quiz = makeQuizWithStats({ status: 'active' })
    render(<QuizCard quiz={quiz} {...defaultProps} isReadOnly={true} />, { wrapper: Wrapper })

    expect(screen.getByLabelText('Close quiz')).toBeDisabled()
    expect(screen.getByLabelText('Delete Test Quiz')).toBeDisabled()
  })

  it('applies selected styles when isSelected', () => {
    const quiz = makeQuizWithStats()
    const { container } = render(<QuizCard quiz={quiz} {...defaultProps} isSelected={true} />, { wrapper: Wrapper })

    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('bg-info-bg')
    expect(card.className).toContain('border-primary')
  })

  it('shows activate confirmation dialog', async () => {
    const quiz = makeQuizWithStats({ status: 'draft' })
    render(<QuizCard quiz={quiz} {...defaultProps} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByLabelText('Activate quiz'))

    expect(screen.getByText('Activate quiz?')).toBeInTheDocument()
    expect(screen.getByText('Once activated, students will be able to respond.')).toBeInTheDocument()
  })

  it('sends PATCH to activate quiz on confirm', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    const onQuizUpdate = vi.fn()
    const quiz = makeQuizWithStats({ status: 'draft' })
    render(<QuizCard quiz={quiz} {...defaultProps} onQuizUpdate={onQuizUpdate} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByLabelText('Activate quiz'))
    fireEvent.click(screen.getByText('Activate'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/teacher/quizzes/quiz-1')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ status: 'active' })

    await waitFor(() => {
      expect(onQuizUpdate).toHaveBeenCalled()
    })
  })

  it('toggles show_results on eye button click', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    const onQuizUpdate = vi.fn()
    const quiz = makeQuizWithStats({ show_results: false })
    render(<QuizCard quiz={quiz} {...defaultProps} onQuizUpdate={onQuizUpdate} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByLabelText('Show results to students'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ show_results: true })
  })
})
