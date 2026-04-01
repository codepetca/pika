'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { DEFAULT_MULTIPLE_CHOICE_POINTS, DEFAULT_OPEN_RESPONSE_POINTS } from '@/lib/test-questions'
import type { JsonPatchOperation, QuizQuestion } from '@/types'

const AUTOSAVE_DEBOUNCE_MS = 3_000
const AUTOSAVE_MIN_INTERVAL_MS = 10_000

export type DraftContent = {
  title: string
  show_results: boolean
  questions: QuizQuestion[]
}

export type DraftSaveStatus = 'saved' | 'saving' | 'unsaved'

export type ConflictDraft = {
  version: number
  content: DraftContent
} | null

interface UseDraftModeOptions {
  quizId: string
  quizTitle: string
  showResults: boolean
  apiBasePath: string
  /** Called after a successful save so the parent can refresh quiz metadata. */
  onUpdate: () => void
  /** Called with a human-readable error message; called with '' to clear. */
  onError: (msg: string) => void
  /** Called whenever the server provides a canonical question list (on load or conflict). */
  onQuestionsChange: (questions: QuizQuestion[]) => void
}

export interface UseDraftModeReturn {
  editTitle: string
  setEditTitle: React.Dispatch<React.SetStateAction<string>>
  isEditingTitle: boolean
  setIsEditingTitle: React.Dispatch<React.SetStateAction<boolean>>
  savingTitle: boolean
  saveStatus: DraftSaveStatus
  conflictDraft: ConflictDraft
  /** Ref to the latest local draft — read by parent to flush saves on unmount. */
  pendingDraftRef: React.MutableRefObject<DraftContent | null>
  /** Apply a server-canonical draft (resets local state + calls onQuestionsChange). */
  applyServerDraft: (
    draft?: {
      version: number
      content?: { title?: string; show_results?: boolean; questions?: unknown[] }
    } | null
  ) => void
  saveDraft: (nextDraft: DraftContent, options?: { forceFull?: boolean }) => Promise<void>
  scheduleSave: (nextDraft: DraftContent, options?: { force?: boolean }) => void
  scheduleAutosave: (nextDraft: DraftContent) => void
  handleTitleSave: (questions: QuizQuestion[]) => Promise<void>
}

/**
 * Manages draft autosave state for quiz/test editors.
 *
 * Isolated concerns: debounced autosave, throttled saves, JSON-Patch
 * diffing, 409 conflict detection, and inline title editing.
 *
 * @example
 * ```tsx
 * const draft = useDraftMode({
 *   quizId: quiz.id,
 *   quizTitle: quiz.title,
 *   showResults: quiz.show_results,
 *   apiBasePath,
 *   onUpdate: onQuizUpdate,
 *   onError: setError,
 *   onQuestionsChange: setQuestions,
 * })
 * ```
 */
export function useDraftMode({
  quizId,
  quizTitle,
  showResults,
  apiBasePath,
  onUpdate,
  onError,
  onQuestionsChange,
}: UseDraftModeOptions): UseDraftModeReturn {
  const [editTitle, setEditTitle] = useState(quizTitle)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('saved')
  const [conflictDraft, setConflictDraft] = useState<ConflictDraft>(null)

  const draftVersionRef = useRef(1)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const lastSavedDraftRef = useRef('')
  const saveStatusRef = useRef<DraftSaveStatus>('saved')
  const pendingDraftRef = useRef<DraftContent | null>(null)

  // Keep saveStatusRef in sync so the unmount cleanup can flush without stale closure
  useEffect(() => {
    saveStatusRef.current = saveStatus
  }, [saveStatus])

  // Reset title/conflict state when a different quiz is selected
  useEffect(() => {
    setEditTitle(quizTitle)
    setIsEditingTitle(false)
    setConflictDraft(null)
  }, [quizId, quizTitle])

  /** Normalise raw question data from the server into the QuizQuestion shape. */
  const normalizeDraftQuestions = useCallback(
    (rawQuestions: unknown[]): QuizQuestion[] => {
      return (rawQuestions || []).map((rawQuestion, index) => {
        const question = (rawQuestion || {}) as Record<string, unknown>
        const questionType =
          question.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
        return {
          id: String(question.id || crypto.randomUUID()),
          quiz_id: quizId,
          question_text: String(question.question_text || ''),
          options: Array.isArray(question.options)
            ? question.options.map((o) => String(o))
            : questionType === 'open_response'
              ? []
              : ['Option 1', 'Option 2'],
          correct_option:
            typeof question.correct_option === 'number' &&
            Number.isInteger(question.correct_option)
              ? question.correct_option
              : questionType === 'multiple_choice'
                ? 0
                : null,
          question_type: questionType,
          points:
            typeof question.points === 'number'
              ? question.points
              : questionType === 'open_response'
                ? DEFAULT_OPEN_RESPONSE_POINTS
                : DEFAULT_MULTIPLE_CHOICE_POINTS,
          response_max_chars:
            typeof question.response_max_chars === 'number' ? question.response_max_chars : 5000,
          response_monospace: question.response_monospace === true,
          answer_key:
            typeof question.answer_key === 'string' && question.answer_key.trim().length > 0
              ? question.answer_key.trim()
              : null,
          sample_solution:
            typeof question.sample_solution === 'string' && question.sample_solution.trim().length > 0
              ? question.sample_solution.trim()
              : null,
          position: index,
          created_at: String(question.created_at || new Date().toISOString()),
          updated_at: String(question.updated_at || new Date().toISOString()),
        } as QuizQuestion
      })
    },
    [quizId]
  )

  const applyServerDraft = useCallback(
    (
      draft?: {
        version: number
        content?: { title?: string; show_results?: boolean; questions?: unknown[] }
      } | null
    ) => {
      if (!draft?.content) return

      const nextTitle =
        typeof draft.content.title === 'string' ? draft.content.title : quizTitle
      const nextShowResults =
        typeof draft.content.show_results === 'boolean' ? draft.content.show_results : showResults
      const nextQuestions = normalizeDraftQuestions(draft.content.questions || [])
      const nextSnapshot: DraftContent = {
        title: nextTitle,
        show_results: nextShowResults,
        questions: nextQuestions,
      }

      setEditTitle(nextTitle)
      onQuestionsChange(nextQuestions)
      draftVersionRef.current = draft.version
      lastSavedDraftRef.current = JSON.stringify(nextSnapshot)
      pendingDraftRef.current = nextSnapshot
      setSaveStatus('saved')
      onError('')
      setConflictDraft(null)
    },
    [normalizeDraftQuestions, onError, onQuestionsChange, quizTitle, showResults]
  )

  const saveDraft = useCallback(
    async (nextDraft: DraftContent, options?: { forceFull?: boolean }) => {
      const nextSerialized = JSON.stringify(nextDraft)
      if (!options?.forceFull && nextSerialized === lastSavedDraftRef.current) {
        setSaveStatus('saved')
        return
      }

      setSaveStatus('saving')
      lastSaveAttemptAtRef.current = Date.now()

      let baseDraft = nextDraft
      try {
        if (lastSavedDraftRef.current) {
          baseDraft = JSON.parse(lastSavedDraftRef.current) as DraftContent
        }
      } catch {
        baseDraft = nextDraft
      }

      const patch = createJsonPatch(baseDraft, nextDraft)
      const shouldSendPatch =
        !options?.forceFull &&
        patch.length > 0 &&
        !shouldStoreSnapshot(patch as JsonPatchOperation[], nextDraft)

      const body: {
        version: number
        patch?: JsonPatchOperation[]
        content?: DraftContent
      } = { version: draftVersionRef.current }

      if (shouldSendPatch) {
        body.patch = patch as JsonPatchOperation[]
      } else {
        body.content = nextDraft
      }

      try {
        const response = await fetch(`${apiBasePath}/${quizId}/draft`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await response.json()

        if (response.status === 409) {
          const serverDraft = data?.draft as
            | {
                version: number
                content: { title: string; show_results: boolean; questions: QuizQuestion[] }
              }
            | undefined
          if (serverDraft) {
            setConflictDraft({
              version: serverDraft.version,
              content: {
                title: serverDraft.content.title,
                show_results: serverDraft.content.show_results,
                questions: normalizeDraftQuestions(serverDraft.content.questions || []),
              },
            })
          }
          setSaveStatus('unsaved')
          onError(data?.error || 'Draft updated elsewhere')
          return
        }

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to save draft')
        }

        const serverDraft = data?.draft as
          | { version: number; content?: { title?: string; show_results?: boolean; questions?: unknown[] } }
          | undefined
        if (serverDraft?.content) {
          applyServerDraft(serverDraft)
        } else {
          draftVersionRef.current += 1
          lastSavedDraftRef.current = nextSerialized
          pendingDraftRef.current = nextDraft
          setSaveStatus('saved')
          onError('')
          setConflictDraft(null)
        }
        onUpdate()
      } catch (saveError: unknown) {
        console.error('Error saving draft:', saveError)
        setSaveStatus('unsaved')
        onError(saveError instanceof Error ? saveError.message : 'Failed to save draft')
      }
    },
    [apiBasePath, applyServerDraft, normalizeDraftQuestions, onError, onUpdate, quizId]
  )

  const scheduleSave = useCallback(
    (nextDraft: DraftContent, options?: { force?: boolean }) => {
      if (conflictDraft) return

      pendingDraftRef.current = nextDraft

      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
        throttledSaveTimeoutRef.current = null
      }

      const now = Date.now()
      const msSinceLastAttempt = now - lastSaveAttemptAtRef.current

      if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
        void saveDraft(nextDraft)
        return
      }

      const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
      throttledSaveTimeoutRef.current = setTimeout(() => {
        throttledSaveTimeoutRef.current = null
        const latestDraft = pendingDraftRef.current
        if (latestDraft) void saveDraft(latestDraft)
      }, waitMs)
    },
    [conflictDraft, saveDraft]
  )

  const scheduleAutosave = useCallback(
    (nextDraft: DraftContent) => {
      if (conflictDraft) return

      pendingDraftRef.current = nextDraft
      setSaveStatus('unsaved')
      onError('')

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

      saveTimeoutRef.current = setTimeout(() => {
        scheduleSave(nextDraft)
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [conflictDraft, onError, scheduleSave]
  )

  const handleTitleSave = useCallback(
    async (questions: QuizQuestion[]) => {
      const trimmed = editTitle.trim()
      const fallbackTitle =
        (pendingDraftRef.current?.title ||
          (() => {
            try {
              return (JSON.parse(lastSavedDraftRef.current) as { title?: string })?.title
            } catch {
              return quizTitle
            }
          })()) ||
        quizTitle

      if (!trimmed) {
        setEditTitle(fallbackTitle)
        setIsEditingTitle(false)
        return
      }

      setSavingTitle(true)
      setIsEditingTitle(false)
      setEditTitle(trimmed)
      setSavingTitle(false)

      const nextDraft: DraftContent = { title: trimmed, show_results: showResults, questions }
      pendingDraftRef.current = nextDraft
      setSaveStatus('unsaved')
      onError('')
      scheduleSave(nextDraft, { force: true })
    },
    [editTitle, onError, quizTitle, scheduleSave, showResults]
  )

  // Flush pending unsaved draft on unmount (e.g. navigating away mid-edit)
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (throttledSaveTimeoutRef.current) clearTimeout(throttledSaveTimeoutRef.current)
      if (pendingDraftRef.current && saveStatusRef.current === 'unsaved') {
        void saveDraft(pendingDraftRef.current, { forceFull: true })
      }
    }
  }, [saveDraft])

  return {
    editTitle,
    setEditTitle,
    isEditingTitle,
    setIsEditingTitle,
    savingTitle,
    saveStatus,
    conflictDraft,
    pendingDraftRef,
    applyServerDraft,
    saveDraft,
    scheduleSave,
    scheduleAutosave,
    handleTitleSave,
  }
}
