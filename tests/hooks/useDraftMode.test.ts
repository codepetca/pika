import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useDraftMode } from '@/hooks/useDraftMode'
import type { QuizQuestion } from '@/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<Parameters<typeof useDraftMode>[0]> = {}) {
  return {
    quizId: 'quiz-1',
    quizTitle: 'Test Quiz',
    showResults: false,
    apiBasePath: '/api/teacher/quizzes',
    onUpdate: vi.fn(),
    onError: vi.fn(),
    onQuestionsChange: vi.fn(),
    ...overrides,
  }
}

function makeQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'q-1',
    quiz_id: 'quiz-1',
    question_text: 'What is 2+2?',
    question_type: 'multiple_choice',
    options: ['1', '2', '4', '5'],
    correct_option: 2,
    points: 1,
    position: 0,
    response_monospace: false,
    answer_key: null,
    ...overrides,
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useDraftMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('initialises editTitle from quizTitle', () => {
      const { result } = renderHook(() => useDraftMode(makeOptions({ quizTitle: 'My Quiz' })))
      expect(result.current.editTitle).toBe('My Quiz')
    })

    it('initialises saveStatus as "saved"', () => {
      const { result } = renderHook(() => useDraftMode(makeOptions()))
      expect(result.current.saveStatus).toBe('saved')
    })

    it('initialises isEditingTitle as false', () => {
      const { result } = renderHook(() => useDraftMode(makeOptions()))
      expect(result.current.isEditingTitle).toBe(false)
    })

    it('initialises conflictDraft as null', () => {
      const { result } = renderHook(() => useDraftMode(makeOptions()))
      expect(result.current.conflictDraft).toBeNull()
    })

    it('initialises pendingDraftRef as null', () => {
      const { result } = renderHook(() => useDraftMode(makeOptions()))
      expect(result.current.pendingDraftRef.current).toBeNull()
    })
  })

  describe('applyServerDraft', () => {
    it('resets title and clears conflict when given a canonical draft', () => {
      const onQuestionsChange = vi.fn()
      const { result } = renderHook(() =>
        useDraftMode(makeOptions({ quizTitle: 'Old Title', onQuestionsChange }))
      )

      act(() => {
        result.current.applyServerDraft({
          version: 2,
          content: { title: 'New Title', show_results: true, questions: [] },
        })
      })

      expect(result.current.editTitle).toBe('New Title')
      expect(result.current.conflictDraft).toBeNull()
      expect(onQuestionsChange).toHaveBeenCalledWith([])
    })

    it('does nothing when draft is null', () => {
      const onQuestionsChange = vi.fn()
      const { result } = renderHook(() =>
        useDraftMode(makeOptions({ quizTitle: 'Original', onQuestionsChange }))
      )

      act(() => {
        result.current.applyServerDraft(null)
      })

      expect(result.current.editTitle).toBe('Original')
      expect(onQuestionsChange).not.toHaveBeenCalled()
    })
  })

  describe('saveDraft', () => {
    it('sends PATCH request with draft content', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ version: 2 }),
      })
      vi.stubGlobal('fetch', fetchSpy)

      const onUpdate = vi.fn()
      const { result } = renderHook(() =>
        useDraftMode(makeOptions({ onUpdate }))
      )

      const draft = { title: 'Updated Title', show_results: false, questions: [] }
      await act(async () => {
        await result.current.saveDraft(draft)
      })

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('/api/teacher/quizzes/quiz-1/draft'),
          expect.objectContaining({ method: 'PATCH' })
        )
      })

      vi.unstubAllGlobals()
    })

    it('calls onError when the server returns an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      }))

      const onError = vi.fn()
      const { result } = renderHook(() =>
        useDraftMode(makeOptions({ onError }))
      )

      await act(async () => {
        await result.current.saveDraft({ title: 'T', show_results: false, questions: [] })
      })

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('Server error'))
      })

      vi.unstubAllGlobals()
    })

    it('detects a 409 conflict and stores conflictDraft', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'Draft updated elsewhere',
          draft: {
            version: 5,
            content: { title: 'Server Title', show_results: false, questions: [] },
          },
        }),
      }))

      const { result } = renderHook(() => useDraftMode(makeOptions()))

      await act(async () => {
        await result.current.saveDraft({ title: 'Local Title', show_results: false, questions: [] })
      })

      await waitFor(() => {
        expect(result.current.conflictDraft).not.toBeNull()
        expect(result.current.conflictDraft?.version).toBe(5)
      })

      vi.unstubAllGlobals()
    })
  })

  describe('title changes on quizId change', () => {
    it('resets editTitle when quizId changes', () => {
      const { result, rerender } = renderHook(
        ({ quizId, quizTitle }) => useDraftMode(makeOptions({ quizId, quizTitle })),
        { initialProps: { quizId: 'quiz-1', quizTitle: 'Quiz One' } }
      )

      act(() => {
        result.current.setEditTitle('Modified Title')
      })
      expect(result.current.editTitle).toBe('Modified Title')

      rerender({ quizId: 'quiz-2', quizTitle: 'Quiz Two' })

      expect(result.current.editTitle).toBe('Quiz Two')
    })
  })

  describe('handleTitleSave', () => {
    it('PATCHes the title and calls onUpdate on success', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ version: 2 }),
      })
      vi.stubGlobal('fetch', fetchSpy)

      const onUpdate = vi.fn()
      const { result } = renderHook(() =>
        useDraftMode(makeOptions({ quizTitle: 'Old', onUpdate }))
      )

      act(() => {
        result.current.setEditTitle('New Title')
      })

      await act(async () => {
        await result.current.handleTitleSave([makeQuestion()])
      })

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
      expect(result.current.isEditingTitle).toBe(false)

      vi.unstubAllGlobals()
    })
  })
})
