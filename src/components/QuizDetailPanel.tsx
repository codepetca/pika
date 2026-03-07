'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Check, Plus, X } from 'lucide-react'
import { Button, Tooltip } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { canEditQuizQuestions } from '@/lib/quizzes'
import { QuizQuestionEditor } from '@/components/QuizQuestionEditor'
import { TestQuestionEditor } from '@/components/TestQuestionEditor'
import { TestDocumentsEditor } from '@/components/TestDocumentsEditor'
import { QuizResultsView } from '@/components/QuizResultsView'
import { QuizIndividualResponses } from '@/components/QuizIndividualResponses'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { DEFAULT_MULTIPLE_CHOICE_POINTS, DEFAULT_OPEN_RESPONSE_POINTS } from '@/lib/test-questions'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import type {
  JsonPatchOperation,
  QuizQuestion,
  QuizWithStats,
  QuizResultsAggregate,
  TestDocument,
} from '@/types'

interface Props {
  quiz: QuizWithStats
  classroomId: string
  apiBasePath?: string
  onQuizUpdate: () => void
}

export function QuizDetailPanel({
  quiz,
  classroomId,
  apiBasePath = '/api/teacher/quizzes',
  onQuizUpdate,
}: Props) {
  void classroomId
  const AUTOSAVE_DEBOUNCE_MS = 3000
  const AUTOSAVE_MIN_INTERVAL_MS = 10_000
  const isTestsView = quiz.assessment_type === 'test' || apiBasePath.includes('/tests')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [documents, setDocuments] = useState<TestDocument[]>(
    () => normalizeTestDocuments((quiz as { documents?: unknown }).documents)
  )
  const [results, setResults] = useState<QuizResultsAggregate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'questions' | 'documents' | 'preview' | 'results'>('questions')
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [conflictDraft, setConflictDraft] = useState<{
    version: number
    content: { title: string; show_results: boolean; questions: QuizQuestion[] }
  } | null>(null)

  // Inline title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(quiz.title)
  const [savingTitle, setSavingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const draftVersionRef = useRef(1)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const lastSavedDraftRef = useRef('')
  const saveStatusRef = useRef<'saved' | 'saving' | 'unsaved'>('saved')
  const pendingDraftRef = useRef<{
    title: string
    show_results: boolean
    questions: QuizQuestion[]
  } | null>(null)

  const normalizeQuestionPositions = useCallback((nextQuestions: QuizQuestion[]): QuizQuestion[] => {
    return nextQuestions.map((question, index) => ({ ...question, position: index }))
  }, [])

  const normalizeDraftQuestions = useCallback((rawQuestions: unknown[]): QuizQuestion[] => {
    return normalizeQuestionPositions(
      (rawQuestions || []).map((rawQuestion, index) => {
        const question = (rawQuestion || {}) as Record<string, unknown>
        const questionType = question.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
        return {
          id: String(question.id || crypto.randomUUID()),
          quiz_id: quiz.id,
          question_text: String(question.question_text || ''),
          options: Array.isArray(question.options)
            ? question.options.map((option) => String(option))
            : questionType === 'open_response'
              ? []
              : ['Option 1', 'Option 2'],
          correct_option:
            typeof question.correct_option === 'number' && Number.isInteger(question.correct_option)
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
          position: index,
          created_at: String(question.created_at || new Date().toISOString()),
          updated_at: String(question.updated_at || new Date().toISOString()),
        }
      })
    )
  }, [normalizeQuestionPositions, quiz.id])

  const applyServerDraft = useCallback(
    (draft?: {
      version: number
      content?: { title?: string; show_results?: boolean; questions?: unknown[] }
    } | null) => {
      if (!draft?.content) return

      const nextTitle = typeof draft.content.title === 'string' ? draft.content.title : quiz.title
      const nextShowResults =
        typeof draft.content.show_results === 'boolean' ? draft.content.show_results : quiz.show_results
      const nextQuestions = normalizeDraftQuestions(draft.content.questions || [])
      const nextSnapshot = {
        title: nextTitle,
        show_results: nextShowResults,
        questions: nextQuestions,
      }

      setEditTitle(nextTitle)
      setQuestions(nextQuestions)
      draftVersionRef.current = draft.version
      lastSavedDraftRef.current = JSON.stringify(nextSnapshot)
      pendingDraftRef.current = nextSnapshot
      setSaveStatus('saved')
      setError('')
      setConflictDraft(null)
    },
    [normalizeDraftQuestions, quiz.show_results, quiz.title]
  )

  // Sync editTitle when quiz changes
  useEffect(() => {
    setEditTitle(quiz.title)
    setIsEditingTitle(false)
    setConflictDraft(null)
  }, [quiz.id, quiz.title])

  useEffect(() => {
    setDocuments(normalizeTestDocuments((quiz as { documents?: unknown }).documents))
  }, [quiz])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [isEditingTitle])

  const hasResponses = quiz.stats.responded > 0
  const isEditable = canEditQuizQuestions(quiz, hasResponses)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const saveDraft = useCallback(
    async (
      nextDraft: { title: string; show_results: boolean; questions: QuizQuestion[] },
      options?: { forceFull?: boolean }
    ) => {
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
          baseDraft = JSON.parse(lastSavedDraftRef.current) as typeof nextDraft
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
        content?: typeof nextDraft
      } = {
        version: draftVersionRef.current,
      }

      if (shouldSendPatch) {
        body.patch = patch as JsonPatchOperation[]
      } else {
        body.content = nextDraft
      }

      try {
        const response = await fetch(`${apiBasePath}/${quiz.id}/draft`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await response.json()

        if (response.status === 409) {
          const serverDraft = data?.draft as
            | { version: number; content: { title: string; show_results: boolean; questions: QuizQuestion[] } }
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
          setError(data?.error || 'Draft updated elsewhere')
          return
        }

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to save draft')
        }

        const serverDraft = data?.draft as
          | {
              version: number
              content?: { title?: string; show_results?: boolean; questions?: unknown[] }
            }
          | undefined
        if (serverDraft?.content) {
          applyServerDraft(serverDraft)
        } else {
          draftVersionRef.current += 1
          lastSavedDraftRef.current = nextSerialized
          pendingDraftRef.current = nextDraft
          setSaveStatus('saved')
          setError('')
          setConflictDraft(null)
        }
        onQuizUpdate()
      } catch (saveError: any) {
        console.error('Error saving draft:', saveError)
        setSaveStatus('unsaved')
        setError(saveError?.message || 'Failed to save draft')
      }
    },
    [apiBasePath, applyServerDraft, normalizeDraftQuestions, onQuizUpdate, quiz.id]
  )

  const scheduleSave = useCallback(
    (
      nextDraft: { title: string; show_results: boolean; questions: QuizQuestion[] },
      options?: { force?: boolean }
    ) => {
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
        if (latestDraft) {
          void saveDraft(latestDraft)
        }
      }, waitMs)
    },
    [AUTOSAVE_MIN_INTERVAL_MS, conflictDraft, saveDraft]
  )

  const scheduleAutosave = useCallback(
    (nextDraft: { title: string; show_results: boolean; questions: QuizQuestion[] }) => {
      if (conflictDraft) return

      pendingDraftRef.current = nextDraft
      setSaveStatus('unsaved')
      setError('')

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(() => {
        scheduleSave(nextDraft)
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [AUTOSAVE_DEBOUNCE_MS, conflictDraft, scheduleSave]
  )

  const loadQuizDetails = useCallback(async () => {
    setLoading(true)
    try {
      const draftRes = await fetch(`${apiBasePath}/${quiz.id}/draft`)
      const draftData = await draftRes.json()
      if (!draftRes.ok) {
        throw new Error(draftData.error || 'Failed to load assessment draft')
      }

      const normalizedDraft = draftData?.draft?.content
        ? draftData.draft
        : {
            version: 1,
            content: {
              title: quiz.title,
              show_results: quiz.show_results,
              questions: Array.isArray(draftData?.questions) ? draftData.questions : [],
            },
          }

      applyServerDraft(normalizedDraft)

      if (isTestsView) {
        const detailRes = await fetch(`${apiBasePath}/${quiz.id}`)
        if (detailRes?.ok) {
          const detailData = await detailRes.json()
          setDocuments(normalizeTestDocuments(detailData?.quiz?.documents))
        }
      }

      if (hasResponses) {
        const resultsRes = await fetch(`${apiBasePath}/${quiz.id}/results`)
        const resultsData = await resultsRes.json()
        setResults(resultsData.results || [])
      } else {
        setResults(null)
      }
    } catch (err: any) {
      console.error('Error loading quiz details:', err)
      setError(err?.message || 'Failed to load assessment details')
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, applyServerDraft, hasResponses, isTestsView, quiz.id, quiz.show_results, quiz.title])

  useEffect(() => {
    loadQuizDetails()
  }, [loadQuizDetails])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !isEditable) return

      const oldIndex = questions.findIndex((q) => q.id === active.id)
      const newIndex = questions.findIndex((q) => q.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = normalizeQuestionPositions(arrayMove(questions, oldIndex, newIndex))
      setQuestions(reordered)

      scheduleAutosave({
        title: editTitle,
        show_results: quiz.show_results,
        questions: reordered,
      })
    },
    [editTitle, isEditable, normalizeQuestionPositions, questions, quiz.show_results, scheduleAutosave]
  )

  useEffect(() => {
    saveStatusRef.current = saveStatus
  }, [saveStatus])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (throttledSaveTimeoutRef.current) clearTimeout(throttledSaveTimeoutRef.current)
      if (pendingDraftRef.current && saveStatusRef.current === 'unsaved') {
        void saveDraft(pendingDraftRef.current, { forceFull: true })
      }
    }
  }, [saveDraft])

  async function handleTitleSave() {
    const trimmed = editTitle.trim()
    const fallbackTitle =
      (pendingDraftRef.current?.title || (() => {
        try {
          const parsed = JSON.parse(lastSavedDraftRef.current) as { title?: string }
          return parsed?.title
        } catch {
          return quiz.title
        }
      })()) || quiz.title

    if (!trimmed) {
      setEditTitle(fallbackTitle)
      setIsEditingTitle(false)
      return
    }

    setSavingTitle(true)
    setIsEditingTitle(false)
    const nextTitle = trimmed
    setEditTitle(nextTitle)
    setSavingTitle(false)

    const nextDraft = {
      title: nextTitle,
      show_results: quiz.show_results,
      questions,
    }
    pendingDraftRef.current = nextDraft
    setSaveStatus('unsaved')
    setError('')
    scheduleSave(nextDraft, { force: true })
  }

  function handleTitleCancel() {
    const fallbackTitle = pendingDraftRef.current?.title || quiz.title
    setEditTitle(fallbackTitle)
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleTitleSave()
    if (e.key === 'Escape') handleTitleCancel()
  }

  function handleAddQuestion(questionType: 'multiple_choice' | 'open_response' = 'multiple_choice') {
    if (!isEditable) return

    const nextQuestion: QuizQuestion = isTestsView
      ? questionType === 'open_response'
        ? {
            id: crypto.randomUUID(),
            quiz_id: quiz.id,
            question_type: 'open_response',
            question_text: '',
            options: [],
            correct_option: null,
            points: DEFAULT_OPEN_RESPONSE_POINTS,
            response_max_chars: 5000,
            response_monospace: false,
            position: questions.length,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        : {
            id: crypto.randomUUID(),
            quiz_id: quiz.id,
            question_type: 'multiple_choice',
            question_text: '',
            options: ['Option 1', 'Option 2'],
            correct_option: 0,
            points: DEFAULT_MULTIPLE_CHOICE_POINTS,
            response_max_chars: 5000,
            response_monospace: false,
            position: questions.length,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
      : {
          id: crypto.randomUUID(),
          quiz_id: quiz.id,
          question_text: 'New question',
          options: ['Option 1', 'Option 2'],
          position: questions.length,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

    const nextQuestions = normalizeQuestionPositions([...questions, nextQuestion])
    setQuestions(nextQuestions)

    scheduleAutosave({
      title: editTitle,
      show_results: quiz.show_results,
      questions: nextQuestions,
    })
  }

  function handleQuestionChange(updatedQuestion: QuizQuestion) {
    const nextQuestions = normalizeQuestionPositions(
      questions.map((question) =>
        question.id === updatedQuestion.id ? { ...updatedQuestion } : question
      )
    )
    setQuestions(nextQuestions)

    scheduleAutosave({
      title: editTitle,
      show_results: quiz.show_results,
      questions: nextQuestions,
    })
  }

  function handleQuestionDelete(questionId: string) {
    const nextQuestions = normalizeQuestionPositions(
      questions.filter((question) => question.id !== questionId)
    )
    setQuestions(nextQuestions)

    scheduleAutosave({
      title: editTitle,
      show_results: quiz.show_results,
      questions: nextQuestions,
    })
  }

  function handleConflictReload() {
    if (!conflictDraft) return
    applyServerDraft({
      version: conflictDraft.version,
      content: conflictDraft.content,
    })
  }

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => setViewMode('questions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'questions'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default'
          }`}
        >
          Questions ({questions.length})
        </button>
        {isTestsView && (
          <button
            type="button"
            onClick={() => setViewMode('documents')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              viewMode === 'documents'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-default'
            }`}
          >
            Documents ({documents.length})
          </button>
        )}
        <button
          type="button"
          onClick={() => setViewMode('preview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'preview'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default'
          }`}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setViewMode('results')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'results'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default'
          }`}
        >
          Results ({quiz.stats.responded})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="p-2 bg-danger-bg text-danger text-sm rounded mb-4">{error}</div>
        )}
        {conflictDraft && (
          <div className="p-2 border border-warning rounded bg-warning-bg text-warning text-sm mb-4 flex items-center justify-between gap-2">
            <span>Draft conflict detected. Load the latest saved draft before continuing.</span>
            <Button size="sm" variant="secondary" onClick={handleConflictReload}>
              Load Latest
            </Button>
          </div>
        )}

        {viewMode === 'questions' ? (
          <div className="space-y-3">
            {/* Inline editable title */}
            {isEditingTitle ? (
              <div className="flex items-center gap-1">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={handleTitleSave}
                  disabled={savingTitle}
                  className="flex-1 text-lg font-semibold text-text-default bg-transparent border-b-2 border-primary outline-none py-0.5"
                />
                <Tooltip content="Save">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 text-success"
                    onClick={handleTitleSave}
                    disabled={savingTitle}
                    aria-label="Save title"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </Tooltip>
                <Tooltip content="Cancel">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1"
                    onClick={handleTitleCancel}
                    disabled={savingTitle}
                    aria-label="Cancel editing"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <h3
                className="text-lg font-semibold text-text-default cursor-pointer hover:text-primary transition-colors"
                onClick={() => setIsEditingTitle(true)}
                title="Click to rename"
              >
                {editTitle}
              </h3>
            )}
            <div className="text-xs text-text-muted">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={questions.map((q) => q.id)}
                strategy={verticalListSortingStrategy}
              >
                {questions.map((question, index) => (
                  isTestsView ? (
                    <TestQuestionEditor
                      key={question.id}
                      question={question}
                      questionNumber={index + 1}
                      isEditable={isEditable}
                      onChange={handleQuestionChange}
                      onDelete={handleQuestionDelete}
                    />
                  ) : (
                    <QuizQuestionEditor
                      key={question.id}
                      question={question}
                      questionNumber={index + 1}
                      isEditable={isEditable}
                      onChange={handleQuestionChange}
                      onDelete={handleQuestionDelete}
                    />
                  )
                ))}
              </SortableContext>
            </DndContext>

            {isEditable && (
              isTestsView ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleAddQuestion('multiple_choice')}
                    className="w-full gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add MC Question
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleAddQuestion('open_response')}
                    className="w-full gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add Open Question
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAddQuestion('multiple_choice')}
                  className="w-full gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Question
                </Button>
              )
            )}

          </div>
        ) : viewMode === 'documents' && isTestsView ? (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-text-default">Documents</h3>
            <TestDocumentsEditor
              testId={quiz.id}
              documents={documents}
              apiBasePath={apiBasePath}
              isEditable={isEditable}
              onUpdated={loadQuizDetails}
            />
          </div>
        ) : viewMode === 'preview' ? (
          <QuizPreview questions={questions} isTestsView={isTestsView} />
        ) : (
          <div className="space-y-6">
            {!isTestsView && <QuizResultsView results={results} />}
            {isTestsView && (
              <div>
                <h4 className="text-sm font-semibold text-text-default mb-2">Multiple-choice distribution</h4>
                <QuizResultsView results={results} />
              </div>
            )}
            {hasResponses && !isTestsView && (
              <div className="pt-4 border-t border-border">
                <QuizIndividualResponses
                  quizId={quiz.id}
                  apiBasePath={apiBasePath}
                  assessmentType={isTestsView ? 'test' : 'quiz'}
                  onUpdated={loadQuizDetails}
                />
              </div>
            )}
            {hasResponses && isTestsView && (
              <p className="pt-4 text-xs text-text-muted border-t border-border">
                Use Grading mode to review individual student responses.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Read-only preview of the quiz as students see it */
function QuizPreview({ questions, isTestsView }: { questions: QuizQuestion[]; isTestsView: boolean }) {
  const [selected, setSelected] = useState<Record<string, number | string>>({})

  if (questions.length === 0) {
    return (
      <p className="text-sm text-text-muted py-4 text-center">
        No questions to preview.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {!isTestsView && (
        <p className="text-xs text-text-muted italic">
          This is how students will see the quiz. Selections are not saved.
        </p>
      )}
      {questions.map((question, index) => (
        <div key={question.id} className="space-y-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Q{index + 1}
              {isTestsView && (
                <span className="ml-1 font-normal normal-case tracking-normal">
                  ({question.points ?? (question.question_type === 'open_response' ? DEFAULT_OPEN_RESPONSE_POINTS : DEFAULT_MULTIPLE_CHOICE_POINTS)} pts)
                </span>
              )}
            </p>
            <QuestionMarkdown content={question.question_text} />
          </div>
          {question.question_type === 'open_response' ? (
            <div className="space-y-2">
              <textarea
                value={typeof selected[question.id] === 'string' ? (selected[question.id] as string) : ''}
                onChange={(event) => setSelected((prev) => ({ ...prev, [question.id]: event.target.value }))}
                maxLength={question.response_max_chars ?? 5000}
                className={`w-full min-h-[120px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary ${
                  question.response_monospace ? 'font-mono leading-6' : ''
                }`}
                style={question.response_monospace ? { tabSize: 4 } : undefined}
                placeholder="Student enters response here"
              />
            </div>
          ) : (
            <div className="space-y-2">
              {question.options.map((option, optionIndex) => {
                const isSelected = selected[question.id] === optionIndex
                return (
                  <label
                    key={optionIndex}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`preview-${question.id}`}
                      checked={isSelected}
                      onChange={() => setSelected((prev) => ({ ...prev, [question.id]: optionIndex }))}
                      className="sr-only"
                    />
                    <span
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-primary' : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </span>
                    <span className="text-text-default">{option}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
