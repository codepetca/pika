'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Check, Copy, ExternalLink, Plus, X } from 'lucide-react'
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
import { markdownToTest, testToMarkdown, TEST_MARKDOWN_AI_SCHEMA } from '@/lib/test-markdown'
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
  onRequestDelete?: () => void
}

export function QuizDetailPanel({
  quiz,
  classroomId,
  apiBasePath = '/api/teacher/quizzes',
  onQuizUpdate,
  onRequestDelete,
}: Props) {
  const AUTOSAVE_DEBOUNCE_MS = 3000
  const AUTOSAVE_MIN_INTERVAL_MS = 10_000
  const isTestsView = quiz.assessment_type === 'test' || apiBasePath.includes('/tests')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [documents, setDocuments] = useState<TestDocument[]>(
    () => normalizeTestDocuments((quiz as { documents?: unknown }).documents)
  )
  const [results, setResults] = useState<QuizResultsAggregate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'questions' | 'documents' | 'markdown' | 'preview' | 'results'>('questions')
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [draftShowResults, setDraftShowResults] = useState(quiz.show_results)
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownError, setMarkdownError] = useState('')
  const [markdownInfo, setMarkdownInfo] = useState('')
  const [markdownDirty, setMarkdownDirty] = useState(false)
  const [markdownSaving, setMarkdownSaving] = useState(false)
  const [openingTestPreview, setOpeningTestPreview] = useState(false)
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
          answer_key:
            typeof question.answer_key === 'string' && question.answer_key.trim().length > 0
              ? question.answer_key.trim()
              : null,
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
      setDraftShowResults(nextShowResults)
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
    setDraftShowResults(quiz.show_results)
    setIsEditingTitle(false)
    setConflictDraft(null)
    setMarkdownDirty(false)
    setMarkdownError('')
    setMarkdownInfo('')
  }, [quiz.id, quiz.show_results, quiz.title])

  useEffect(() => {
    setDocuments(normalizeTestDocuments((quiz as { documents?: unknown }).documents))
  }, [quiz])

  const currentTestMarkdown = useMemo(() => {
    if (!isTestsView) return ''
    return testToMarkdown({
      title: editTitle,
      show_results: draftShowResults,
      questions,
      documents,
    })
  }, [documents, draftShowResults, editTitle, isTestsView, questions])

  useEffect(() => {
    if (!isTestsView || markdownDirty) return
    setMarkdownContent(currentTestMarkdown)
  }, [currentTestMarkdown, isTestsView, markdownDirty])

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
      options?: { forceFull?: boolean; documents?: TestDocument[] }
    ) => {
      const nextSerialized = JSON.stringify(nextDraft)
      if (!options?.forceFull && nextSerialized === lastSavedDraftRef.current) {
        setSaveStatus('saved')
        return true
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
        documents?: TestDocument[]
      } = {
        version: draftVersionRef.current,
      }

      if (shouldSendPatch) {
        body.patch = patch as JsonPatchOperation[]
      } else {
        body.content = nextDraft
      }
      if (options?.documents) {
        body.documents = options.documents
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
          return false
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
        return true
      } catch (saveError: any) {
        console.error('Error saving draft:', saveError)
        setSaveStatus('unsaved')
        setError(saveError?.message || 'Failed to save draft')
        return false
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

  useEffect(() => {
    if (!isTestsView) return
    if (viewMode !== 'preview') return
    setViewMode('questions')
  }, [isTestsView, viewMode])

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
        show_results: draftShowResults,
        questions: reordered,
      })
    },
    [draftShowResults, editTitle, isEditable, normalizeQuestionPositions, questions, scheduleAutosave]
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
      show_results: draftShowResults,
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
            answer_key: null,
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
            answer_key: null,
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
      show_results: draftShowResults,
      questions: nextQuestions,
    })
  }

  function handleQuestionChange(updatedQuestion: QuizQuestion, options?: { force?: boolean }) {
    const nextQuestions = normalizeQuestionPositions(
      questions.map((question) =>
        question.id === updatedQuestion.id ? { ...updatedQuestion } : question
      )
    )
    setQuestions(nextQuestions)

    const nextDraft = {
      title: editTitle,
      show_results: draftShowResults,
      questions: nextQuestions,
    }

    if (options?.force) {
      scheduleSave(nextDraft, { force: true })
      return
    }

    scheduleAutosave(nextDraft)
  }

  function handleQuestionDelete(questionId: string) {
    const nextQuestions = normalizeQuestionPositions(
      questions.filter((question) => question.id !== questionId)
    )
    setQuestions(nextQuestions)

    scheduleAutosave({
      title: editTitle,
      show_results: draftShowResults,
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

  function handleMarkdownChange(content: string) {
    setMarkdownContent(content)
    setMarkdownDirty(true)
    setMarkdownError('')
    setMarkdownInfo('')
  }

  function handleResetMarkdown() {
    setMarkdownContent(currentTestMarkdown)
    setMarkdownDirty(false)
    setMarkdownError('')
    setMarkdownInfo('')
  }

  async function handleCopyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdownContent)
      setMarkdownError('')
      setMarkdownInfo('Markdown copied to clipboard')
    } catch {
      setMarkdownError('Failed to copy markdown')
    }
  }

  async function handleCopyMarkdownSchema() {
    try {
      await navigator.clipboard.writeText(TEST_MARKDOWN_AI_SCHEMA)
      setMarkdownError('')
      setMarkdownInfo('Markdown schema copied to clipboard')
    } catch {
      setMarkdownError('Failed to copy markdown schema')
    }
  }

  async function handleApplyMarkdown() {
    if (!isTestsView) return
    if (!isEditable) {
      setMarkdownError('This test cannot be edited after students have responded.')
      return
    }

    setMarkdownSaving(true)
    setMarkdownError('')
    setMarkdownInfo('')

    const parsed = markdownToTest(markdownContent, {
      defaultShowResults: draftShowResults,
      existingQuestions: questions.map((question) => ({ id: question.id })),
      existingDocuments: documents,
    })

    if (parsed.errors.length > 0 || !parsed.draftContent) {
      setMarkdownError(parsed.errors.join('\n') || 'Invalid markdown')
      setMarkdownSaving(false)
      return
    }

    const existingById = new Map(questions.map((question) => [question.id, question]))
    const now = new Date().toISOString()
    const nextQuestions = normalizeQuestionPositions(
      parsed.draftContent.questions.map((question, index) => {
        const existing = existingById.get(question.id)
        return {
          id: question.id,
          quiz_id: quiz.id,
          question_type: question.question_type,
          question_text: question.question_text,
          options: question.options,
          correct_option: question.correct_option,
          answer_key: question.answer_key,
          points: question.points,
          response_max_chars: question.response_max_chars,
          response_monospace: question.response_monospace,
          position: index,
          created_at: existing?.created_at || now,
          updated_at: now,
        }
      })
    )

    const nextDraft = {
      title: parsed.draftContent.title,
      show_results: parsed.draftContent.show_results,
      questions: nextQuestions,
    }

    const saved = await saveDraft(nextDraft, {
      forceFull: true,
      documents: parsed.documents,
    })

    if (saved) {
      setEditTitle(parsed.draftContent.title)
      setDraftShowResults(parsed.draftContent.show_results)
      setQuestions(nextQuestions)
      setDocuments(parsed.documents)
      setMarkdownDirty(false)
      setMarkdownError('')
      setMarkdownInfo('Markdown applied')
    }

    setMarkdownSaving(false)
  }

  const handleOpenTestPreview = useCallback(async () => {
    if (!isTestsView) return

    setOpeningTestPreview(true)
    const nextDraft = {
      title: editTitle,
      show_results: draftShowResults,
      questions,
    }

    const saved = await saveDraft(nextDraft, {
      forceFull: true,
      documents,
    })

    if (saved) {
      const popupWidth = Math.max(window.screen?.availWidth ?? 0, window.innerWidth ?? 0, 1280)
      const popupHeight = Math.max(window.screen?.availHeight ?? 0, window.innerHeight ?? 0, 720)
      const popupFeatures = [
        'noopener',
        'noreferrer',
        'popup=yes',
        'resizable=yes',
        'scrollbars=yes',
        'left=0',
        'top=0',
        `width=${popupWidth}`,
        `height=${popupHeight}`,
      ].join(',')
      const previewWindow = window.open(
        `/classrooms/${classroomId}/tests/${quiz.id}/preview`,
        '_blank',
        popupFeatures
      )
      if (previewWindow) {
        try {
          previewWindow.moveTo(0, 0)
          previewWindow.resizeTo(popupWidth, popupHeight)
          previewWindow.focus()
        } catch {
          // Browsers may block scripted move/resize/focus based on user settings.
        }
      }
    }

    setOpeningTestPreview(false)
  }, [classroomId, documents, draftShowResults, editTitle, isTestsView, questions, quiz.id, saveDraft])

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
            {documents.length > 0 ? `Documents (${documents.length})` : 'Documents'}
          </button>
        )}
        {isTestsView && (
          <button
            type="button"
            onClick={() => setViewMode('markdown')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              viewMode === 'markdown'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-default'
            }`}
          >
            Markdown
          </button>
        )}
        {!isTestsView && (
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
        )}
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
        {isTestsView && (
          <div className="ml-2 flex items-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void handleOpenTestPreview()
              }}
              disabled={openingTestPreview}
              className="h-8 gap-1.5 px-3 font-semibold"
            >
              <ExternalLink className="h-4 w-4" />
              {openingTestPreview ? 'Opening Preview...' : 'Preview'}
            </Button>
          </div>
        )}
        {isTestsView && onRequestDelete ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onRequestDelete}
            className="ml-auto mr-3 h-8 px-3 font-semibold"
          >
            Delete Test
          </Button>
        ) : null}
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
            <h3 className="text-lg font-semibold text-text-default">Reference Documents</h3>
            <TestDocumentsEditor
              testId={quiz.id}
              documents={documents}
              apiBasePath={apiBasePath}
              isEditable={isEditable}
              onUpdated={loadQuizDetails}
            />
          </div>
        ) : viewMode === 'markdown' && isTestsView ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void handleCopyMarkdown()
                }}
                className="gap-1.5"
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void handleCopyMarkdownSchema()
                }}
                className="gap-1.5"
              >
                <Copy className="h-4 w-4" />
                Copy Schema
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleResetMarkdown}
                disabled={!markdownDirty || markdownSaving}
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void handleApplyMarkdown()
                }}
                disabled={markdownSaving || !isEditable}
              >
                {markdownSaving ? 'Applying...' : 'Apply Markdown'}
              </Button>
            </div>
            {!isEditable && (
              <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
                This test is locked because students have responded.
              </div>
            )}
            {markdownInfo && (
              <div className="rounded-md border border-success bg-success-bg px-3 py-2 text-sm text-success">
                {markdownInfo}
              </div>
            )}
            {markdownError && (
              <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger whitespace-pre-wrap">
                {markdownError}
              </div>
            )}
            <textarea
              value={markdownContent}
              onChange={(event) => handleMarkdownChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  void handleApplyMarkdown()
                }
              }}
              className="min-h-[420px] w-full rounded-md border border-border bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
              spellCheck={false}
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
