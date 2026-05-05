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
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, Plus, RotateCcw, X } from 'lucide-react'
import { Button, EmptyState, SplitButton, Tooltip, cn } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { useRefRect } from '@/hooks/use-element-rect'
import { useWindowSize } from '@/hooks/use-window-size'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import { canEditQuizQuestions } from '@/lib/quizzes'
import { QuizQuestionEditor } from '@/components/QuizQuestionEditor'
import { TestQuestionEditor } from '@/components/TestQuestionEditor'
import { TestDocumentsEditor } from '@/components/TestDocumentsEditor'
import { QuizResultsView } from '@/components/QuizResultsView'
import { QuizIndividualResponses } from '@/components/QuizIndividualResponses'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { SummaryDetailWorkspaceShell } from '@/components/SummaryDetailWorkspaceShell'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import { DEFAULT_MULTIPLE_CHOICE_POINTS, DEFAULT_OPEN_RESPONSE_POINTS } from '@/lib/test-questions'
import { isLinkDocumentSnapshotStale, normalizeTestDocuments } from '@/lib/test-documents'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { markdownToTest, testToMarkdown, TEST_MARKDOWN_AI_SCHEMA } from '@/lib/test-markdown'
import type {
  AssessmentEditorSummaryUpdate,
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
  onQuizUpdate: (update?: AssessmentEditorSummaryUpdate) => void
  onDraftSummaryChange?: (update: AssessmentEditorSummaryUpdate) => void
  onRequestDelete?: () => void
  onRequestTestPreview?: (preview: { testId: string; title: string }) => void
  onPendingMarkdownImportChange?: (pending: boolean) => void
  onSaveStatusChange?: (status: 'saved' | 'saving' | 'unsaved') => void
  showInlineDeleteAction?: boolean
  testQuestionLayout?: 'stacked' | 'summary-detail' | 'editor-only' | 'markdown-only'
  showPreviewButton?: boolean
  showResultsTab?: boolean
  previewRequestToken?: number
}

type AssessmentEditorDraft = {
  title: string
  show_results: boolean
  questions: QuizQuestion[]
  source_format?: 'markdown'
  source_markdown?: string
}

const TEST_SUMMARY_DETAIL_LAYOUT = {
  defaultMarkdownWidth: 50,
  minMarkdownWidthPx: 360,
  minEditorWidthPx: 420,
} as const

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10
}

function clampNumber(value: number, min: number, max: number): number {
  if (max <= min) return min
  return Math.min(max, Math.max(min, value))
}

function clampSummaryDetailMarkdownWidthPercent(value: number, totalWidth: number): number {
  if (!Number.isFinite(value)) {
    return TEST_SUMMARY_DETAIL_LAYOUT.defaultMarkdownWidth
  }

  if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
    return roundPercent(value)
  }

  const minPercent =
    (TEST_SUMMARY_DETAIL_LAYOUT.minMarkdownWidthPx / totalWidth) * 100
  const maxPercent = Math.max(
    minPercent,
    ((totalWidth - TEST_SUMMARY_DETAIL_LAYOUT.minEditorWidthPx) / totalWidth) * 100,
  )

  return roundPercent(clampNumber(value, minPercent, maxPercent))
}

function summarizeDraftContent(
  content: Pick<AssessmentEditorDraft, 'title' | 'show_results' | 'questions'>
): AssessmentEditorSummaryUpdate {
  return {
    title: content.title,
    show_results: content.show_results,
    questions_count: content.questions.length,
  }
}

export function QuizDetailPanel({
  quiz,
  classroomId,
  apiBasePath = '/api/teacher/quizzes',
  onQuizUpdate,
  onDraftSummaryChange,
  onRequestDelete,
  onRequestTestPreview,
  onPendingMarkdownImportChange,
  onSaveStatusChange,
  showInlineDeleteAction = true,
  testQuestionLayout = 'stacked',
  showPreviewButton = true,
  showResultsTab,
  previewRequestToken = 0,
}: Props) {
  const AUTOSAVE_DEBOUNCE_MS = 3000
  const AUTOSAVE_MIN_INTERVAL_MS = 10_000
  const isTestsView = quiz.assessment_type === 'test' || apiBasePath.includes('/tests')
  const { showMarkdown } = useMarkdownPreference()
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [documents, setDocuments] = useState<TestDocument[]>(
    () => normalizeTestDocuments((quiz as { documents?: unknown }).documents)
  )
  const [results, setResults] = useState<QuizResultsAggregate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'questions' | 'documents' | 'markdown' | 'preview' | 'results'>(
    () => 'questions'
  )
  const [isDocumentsCardExpanded, setIsDocumentsCardExpanded] = useState(true)
  const [externalDocumentAddRequest, setExternalDocumentAddRequest] = useState<{
    id: number
    mode: 'link' | 'text' | 'upload'
  } | null>(null)
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [draftShowResults, setDraftShowResults] = useState(quiz.show_results)
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownError, setMarkdownError] = useState('')
  const [markdownInfo, setMarkdownInfo] = useState('')
  const [markdownDirty, setMarkdownDirty] = useState(false)
  const [isMarkdownEditing, setIsMarkdownEditing] = useState(false)
  const [markdownSaving, setMarkdownSaving] = useState(false)
  const [openingTestPreview, setOpeningTestPreview] = useState(false)
  const [preferredTestQuestionType, setPreferredTestQuestionType] = useState<'multiple_choice' | 'open_response'>(
    'multiple_choice'
  )
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
  const draftMutationRevisionRef = useRef(0)
  const saveStatusRef = useRef<'saved' | 'saving' | 'unsaved'>('saved')
  const pendingDraftRef = useRef<AssessmentEditorDraft | null>(null)
  const saveDraftRef = useRef<
    | ((
        nextDraft: AssessmentEditorDraft,
        options?: { forceFull?: boolean; documents?: TestDocument[]; sourceMarkdown?: string }
      ) => Promise<boolean>)
    | null
  >(null)
  const markdownDirtyRef = useRef(false)
  const savedMarkdownRef = useRef('')
  const documentsRef = useRef(documents)
  const autoSyncAttemptedRef = useRef<Set<string>>(new Set())
  const previousPreviewRequestTokenRef = useRef(previewRequestToken)
  const previousQuestionIdsRef = useRef<string[]>([])
  const summaryDetailWorkspaceRef = useRef<HTMLDivElement>(null)
  const summaryDetailResizeCleanupRef = useRef<(() => void) | null>(null)
  const [summaryDetailMarkdownWidthPercent, setSummaryDetailMarkdownWidthPercent] = useState<number>(
    TEST_SUMMARY_DETAIL_LAYOUT.defaultMarkdownWidth
  )
  const loadedDraftQuizIdRef = useRef<string | null>(null)

  const updateSaveStatus = useCallback((status: 'saved' | 'saving' | 'unsaved') => {
    saveStatusRef.current = status
    setSaveStatus(status)
    onSaveStatusChange?.(status)
  }, [onSaveStatusChange])

  const markDraftUnsaved = useCallback(() => {
    draftMutationRevisionRef.current += 1
    updateSaveStatus('unsaved')
  }, [updateSaveStatus])

  const requestCurrentWindowFullscreen = useCallback(async () => {
    const fullscreenElement = document.documentElement as HTMLElement & {
      requestFullscreen?: () => Promise<void>
    }
    if (typeof fullscreenElement.requestFullscreen !== 'function') return
    if (document.fullscreenElement) return

    try {
      await fullscreenElement.requestFullscreen()
    } catch {
      // Browsers can reject fullscreen requests even on direct clicks.
    }
  }, [])

  const openMaximizedTestPreviewWindow = useCallback((url = '') => {
    const popupWidth = Math.max(window.screen?.availWidth ?? 0, window.innerWidth ?? 0, 1280)
    const popupHeight = Math.max(window.screen?.availHeight ?? 0, window.innerHeight ?? 0, 720)
    const popupFeatures = [
      'popup=yes',
      'resizable=yes',
      'scrollbars=yes',
      'left=0',
      'top=0',
      `width=${popupWidth}`,
      `height=${popupHeight}`,
    ].join(',')
    const previewWindow = window.open(url, '_blank', popupFeatures)

    if (previewWindow) {
      try {
        if (!url) {
          previewWindow.document.title = 'Opening Preview'
          previewWindow.document.body.innerHTML = `
            <div style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font:600 16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              Opening preview...
            </div>
          `
          previewWindow.document.body.style.margin = '0'
        }
        previewWindow.moveTo(0, 0)
        previewWindow.resizeTo(popupWidth, popupHeight)
        previewWindow.focus()
        const requestFullscreen = previewWindow.document.documentElement.requestFullscreen
        if (typeof requestFullscreen === 'function') {
          void requestFullscreen.call(previewWindow.document.documentElement).catch(() => {
            // Browsers may reject fullscreen even on a fresh popup.
          })
        }
      } catch {
        // Browsers may block scripted move/resize/focus based on user settings.
      }
    }

    return previewWindow
  }, [])

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
          sample_solution:
            typeof question.sample_solution === 'string' && question.sample_solution.trim().length > 0
              ? question.sample_solution.trim()
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
      content?: {
        title?: string
        show_results?: boolean
        questions?: unknown[]
        source_format?: 'markdown'
        source_markdown?: string
      }
    } | null) => {
      if (!draft?.content) return

      const nextTitle = typeof draft.content.title === 'string' ? draft.content.title : quiz.title
      const nextShowResults =
        typeof draft.content.show_results === 'boolean' ? draft.content.show_results : quiz.show_results
      const nextQuestions = normalizeDraftQuestions(draft.content.questions || [])
      const nextSourceMarkdown =
        typeof draft.content.source_markdown === 'string'
          ? draft.content.source_markdown
          : testToMarkdown({
              title: nextTitle,
              show_results: nextShowResults,
              questions: nextQuestions,
              documents: documentsRef.current,
            })
      const nextSnapshot = {
        title: nextTitle,
        show_results: nextShowResults,
        questions: nextQuestions,
        ...(draft.content.source_format === 'markdown' ? { source_format: 'markdown' as const } : {}),
        source_markdown: nextSourceMarkdown,
      }

      setEditTitle(nextTitle)
      setDraftShowResults(nextShowResults)
      setQuestions(nextQuestions)
      savedMarkdownRef.current = nextSourceMarkdown
      if (!markdownDirtyRef.current) {
        setMarkdownContent(nextSourceMarkdown)
      }
      draftVersionRef.current = draft.version
      lastSavedDraftRef.current = JSON.stringify(nextSnapshot)
      pendingDraftRef.current = nextSnapshot
      loadedDraftQuizIdRef.current = quiz.id
      draftMutationRevisionRef.current += 1
      updateSaveStatus('saved')
      setError('')
      setConflictDraft(null)
    },
    [normalizeDraftQuestions, quiz.id, quiz.show_results, quiz.title, updateSaveStatus]
  )

  // Sync editTitle when quiz changes
  useEffect(() => {
    loadedDraftQuizIdRef.current = null
    setEditTitle(quiz.title)
    setDraftShowResults(quiz.show_results)
    setIsEditingTitle(false)
    setConflictDraft(null)
    setIsMarkdownEditing(false)
    setMarkdownDirty(false)
    markdownDirtyRef.current = false
    setMarkdownError('')
    setMarkdownInfo('')
  }, [quiz.id, quiz.show_results, quiz.title])

  useEffect(() => {
    setDocuments(normalizeTestDocuments((quiz as { documents?: unknown }).documents))
  }, [quiz])

  useEffect(() => {
    autoSyncAttemptedRef.current.clear()
  }, [quiz.id])

  const emitDraftSummaryChange = useCallback(
    (content: Pick<AssessmentEditorDraft, 'title' | 'show_results' | 'questions'>) => {
      if (!onDraftSummaryChange) return
      onDraftSummaryChange(summarizeDraftContent(content))
    },
    [onDraftSummaryChange]
  )

  useEffect(() => {
    if (!onDraftSummaryChange) return
    if (loadedDraftQuizIdRef.current !== quiz.id) return

    emitDraftSummaryChange({
      title: editTitle,
      show_results: draftShowResults,
      questions,
    })
  }, [draftShowResults, editTitle, emitDraftSummaryChange, onDraftSummaryChange, questions, quiz.id])

  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  const currentTestMarkdown = useMemo(() => {
    if (!isTestsView) return ''
    return testToMarkdown({
      title: editTitle,
      show_results: draftShowResults,
      questions,
      documents,
    })
  }, [documents, draftShowResults, editTitle, isTestsView, questions])
  const hasResponses = quiz.stats.responded > 0
  const isEditable = canEditQuizQuestions(quiz, hasResponses)
  const usesMarkdownOnlyQuestions = isTestsView && testQuestionLayout === 'markdown-only'
  const isMarkdownSurfaceEnabled = showMarkdown || usesMarkdownOnlyQuestions
  const hasPendingMarkdownImport = isTestsView && isMarkdownSurfaceEnabled && markdownDirty
  const isMarkdownEditable = isEditable && isMarkdownEditing
  const markdownHelperStatus = markdownSaving
    ? 'Applying markdown...'
    : hasPendingMarkdownImport
      ? 'Markdown edits not applied'
      : isMarkdownEditing
        ? 'Editing markdown'
        : 'Markdown mirror'
  const usesSummaryDetailQuestions = isTestsView && showMarkdown && testQuestionLayout === 'summary-detail'
  const usesEditorOnlyQuestions = isTestsView && testQuestionLayout === 'editor-only'
  const { width: summaryDetailWorkspaceWidth } = useRefRect(summaryDetailWorkspaceRef, {
    enabled: usesSummaryDetailQuestions,
  })
  const { width: viewportWidth } = useWindowSize()
  const hasInlineDocumentsCard = usesSummaryDetailQuestions || usesEditorOnlyQuestions
  const resolvedShowResultsTab = showResultsTab ?? !isTestsView
  const totalQuestionPoints = useMemo(
    () =>
      questions.reduce(
        (sum, question) =>
          sum +
          (typeof question.points === 'number'
            ? question.points
            : question.question_type === 'open_response'
              ? DEFAULT_OPEN_RESPONSE_POINTS
              : DEFAULT_MULTIPLE_CHOICE_POINTS),
        0
      ),
    [questions]
  )
  const areAllQuestionsExpanded =
    questions.length > 0 && questions.every((question) => expandedQuestionIds.includes(question.id))
  const clampedSummaryDetailMarkdownWidthPercent = useMemo(
    () =>
      clampSummaryDetailMarkdownWidthPercent(
        summaryDetailMarkdownWidthPercent,
        summaryDetailWorkspaceWidth
      ),
    [summaryDetailMarkdownWidthPercent, summaryDetailWorkspaceWidth]
  )
  const usesWideSummaryDetailLayout =
    (viewportWidth === 0 || viewportWidth >= DESKTOP_BREAKPOINT) &&
    (summaryDetailWorkspaceWidth === 0 ||
      summaryDetailWorkspaceWidth >=
        TEST_SUMMARY_DETAIL_LAYOUT.minEditorWidthPx +
          TEST_SUMMARY_DETAIL_LAYOUT.minMarkdownWidthPx +
          48)
  const hasCollapsibleEditorSections = questions.length > 0 || hasInlineDocumentsCard
  const areAllEditorSectionsExpanded =
    (questions.length === 0 || areAllQuestionsExpanded) &&
    (!hasInlineDocumentsCard || isDocumentsCardExpanded)

  useEffect(() => {
    if (!isTestsView) return
    if (markdownDirty) return
    if (markdownContent !== currentTestMarkdown) {
      setMarkdownContent(currentTestMarkdown)
    }
    savedMarkdownRef.current = currentTestMarkdown
  }, [currentTestMarkdown, isTestsView, markdownContent, markdownDirty])

  useEffect(() => {
    if (isMarkdownSurfaceEnabled) return
    if (viewMode === 'markdown') {
      setViewMode('questions')
    }
    if (markdownDirty) {
      const fallbackMarkdown = savedMarkdownRef.current || currentTestMarkdown
      setMarkdownContent(fallbackMarkdown)
      setMarkdownDirty(false)
      markdownDirtyRef.current = false
    }
    setIsMarkdownEditing(false)
    setMarkdownError('')
    setMarkdownInfo('')
  }, [currentTestMarkdown, isMarkdownSurfaceEnabled, markdownDirty, viewMode])

  useEffect(() => {
    onPendingMarkdownImportChange?.(isTestsView ? hasPendingMarkdownImport : false)

    return () => {
      onPendingMarkdownImportChange?.(false)
    }
  }, [hasPendingMarkdownImport, isTestsView, onPendingMarkdownImportChange])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [isEditingTitle])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const saveDraft = useCallback(
    async (
      nextDraft: AssessmentEditorDraft,
      options?: { forceFull?: boolean; documents?: TestDocument[]; sourceMarkdown?: string }
    ) => {
      const contentDraft =
        isTestsView
          ? {
              ...nextDraft,
              source_format: 'markdown' as const,
              source_markdown:
                options?.sourceMarkdown ??
                testToMarkdown({
                  title: nextDraft.title,
                  show_results: nextDraft.show_results,
                  questions: nextDraft.questions,
                  documents: options?.documents ?? documents,
                }),
            }
          : nextDraft
      const nextSerialized = JSON.stringify(contentDraft)
      const saveRevision = draftMutationRevisionRef.current
      const isLatestSave = () => saveRevision === draftMutationRevisionRef.current
      if (!options?.forceFull && nextSerialized === lastSavedDraftRef.current) {
        if (isLatestSave()) {
          updateSaveStatus('saved')
        }
        return true
      }

      if (isLatestSave()) {
        updateSaveStatus('saving')
      }
      lastSaveAttemptAtRef.current = Date.now()

      let baseDraft = contentDraft
      try {
        if (lastSavedDraftRef.current) {
          baseDraft = JSON.parse(lastSavedDraftRef.current) as AssessmentEditorDraft
        }
      } catch {
        baseDraft = contentDraft
      }

      const patch = createJsonPatch(baseDraft, contentDraft)
      const shouldSendPatch =
        !isTestsView &&
        !options?.forceFull &&
        patch.length > 0 &&
        !shouldStoreSnapshot(patch as JsonPatchOperation[], nextDraft)

      const body: {
        version: number
        patch?: JsonPatchOperation[]
        content?: AssessmentEditorDraft
        documents?: TestDocument[]
      } = {
        version: draftVersionRef.current,
      }

      if (shouldSendPatch) {
        body.patch = patch as JsonPatchOperation[]
      } else {
        body.content = contentDraft
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
          if (!isLatestSave()) {
            return false
          }

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
          updateSaveStatus('unsaved')
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
          draftVersionRef.current = serverDraft.version
          lastSavedDraftRef.current = nextSerialized
          if (isLatestSave()) {
            applyServerDraft(serverDraft)
            onQuizUpdate({
              title:
                typeof serverDraft.content.title === 'string'
                  ? serverDraft.content.title
                  : contentDraft.title,
              show_results:
                typeof serverDraft.content.show_results === 'boolean'
                  ? serverDraft.content.show_results
                  : contentDraft.show_results,
              questions_count: Array.isArray(serverDraft.content.questions)
                ? serverDraft.content.questions.length
                : contentDraft.questions.length,
            })
          }
        } else {
          draftVersionRef.current += 1
          lastSavedDraftRef.current = nextSerialized
          if (isLatestSave()) {
            pendingDraftRef.current = nextDraft
            updateSaveStatus('saved')
            setError('')
            setConflictDraft(null)
            onQuizUpdate(summarizeDraftContent(contentDraft))
          }
        }
        return true
      } catch (saveError: any) {
        console.error('Error saving draft:', saveError)
        if (isLatestSave()) {
          updateSaveStatus('unsaved')
          setError(saveError?.message || 'Failed to save draft')
        }
        return false
      }
    },
    [apiBasePath, applyServerDraft, documents, isTestsView, normalizeDraftQuestions, onQuizUpdate, quiz.id, updateSaveStatus]
  )

  const scheduleSave = useCallback(
    (
      nextDraft: AssessmentEditorDraft,
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
    (nextDraft: AssessmentEditorDraft) => {
      if (conflictDraft) return

      pendingDraftRef.current = nextDraft
      markDraftUnsaved()
      setError('')

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(() => {
        scheduleSave(nextDraft)
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [AUTOSAVE_DEBOUNCE_MS, conflictDraft, markDraftUnsaved, scheduleSave]
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

    const staleDoc = normalizeTestDocuments(documents).find((doc) => {
      if (!isLinkDocumentSnapshotStale(doc)) return false
      const attemptKey = `${doc.id}:${doc.url || ''}:${doc.synced_at || ''}:${doc.snapshot_path || ''}`
      return !autoSyncAttemptedRef.current.has(attemptKey)
    })

    if (!staleDoc) return

    const attemptKey = `${staleDoc.id}:${staleDoc.url || ''}:${staleDoc.synced_at || ''}:${staleDoc.snapshot_path || ''}`
    autoSyncAttemptedRef.current.add(attemptKey)

    let isCancelled = false

    void (async () => {
      try {
        const response = await fetch(`${apiBasePath}/${quiz.id}/documents/${staleDoc.id}/sync`, {
          method: 'POST',
        })
        const data = await response.json()
        if (!response.ok || isCancelled) {
          if (!response.ok) {
            console.error(`Auto-sync failed for ${staleDoc.title}:`, data?.error || 'Unknown error')
          }
          return
        }

        setDocuments(normalizeTestDocuments(data?.quiz?.documents))
      } catch (error) {
        if (!isCancelled) {
          console.error(`Auto-sync failed for ${staleDoc.title}:`, error)
        }
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [apiBasePath, documents, isTestsView, quiz.id])

  useEffect(() => {
    if (!isTestsView) return
    if (viewMode !== 'preview') return
    setViewMode('questions')
  }, [isTestsView, viewMode])

  useEffect(() => {
    const currentQuestionIds = questions.map((question) => question.id)
    const previousQuestionIds = previousQuestionIdsRef.current

    setExpandedQuestionIds((prev) => {
      const retained = prev.filter((questionId) => currentQuestionIds.includes(questionId))
      if (previousQuestionIds.length === 0) {
        return currentQuestionIds[0] ? [currentQuestionIds[0]] : []
      }

      const newQuestionIds = currentQuestionIds.filter((questionId) => !previousQuestionIds.includes(questionId))
      return [...retained, ...newQuestionIds]
    })

    previousQuestionIdsRef.current = currentQuestionIds
  }, [questions])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !isEditable) return

      const oldIndex = questions.findIndex((q) => q.id === active.id)
      const newIndex = questions.findIndex((q) => q.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = normalizeQuestionPositions(arrayMove(questions, oldIndex, newIndex))
      setQuestions(reordered)
      emitDraftSummaryChange({
        title: editTitle,
        show_results: draftShowResults,
        questions: reordered,
      })

      scheduleAutosave({
        title: editTitle,
        show_results: draftShowResults,
        questions: reordered,
      })
    },
    [draftShowResults, editTitle, emitDraftSummaryChange, isEditable, normalizeQuestionPositions, questions, scheduleAutosave]
  )

  useEffect(() => {
    saveStatusRef.current = saveStatus
  }, [saveStatus])

  useEffect(() => {
    saveDraftRef.current = saveDraft
  }, [saveDraft])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (throttledSaveTimeoutRef.current) clearTimeout(throttledSaveTimeoutRef.current)
      if (pendingDraftRef.current && saveStatusRef.current === 'unsaved') {
        void saveDraftRef.current?.(pendingDraftRef.current, { forceFull: true })
      }
    }
  }, [])

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
    markDraftUnsaved()
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
            sample_solution: null,
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
            sample_solution: null,
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
    emitDraftSummaryChange({
      title: editTitle,
      show_results: draftShowResults,
      questions: nextQuestions,
    })

    scheduleAutosave({
      title: editTitle,
      show_results: draftShowResults,
      questions: nextQuestions,
    })
  }

  function handleAddTestQuestionViaSplitButton(
    questionType: 'multiple_choice' | 'open_response' = preferredTestQuestionType
  ) {
    setPreferredTestQuestionType(questionType)
    handleAddQuestion(questionType)
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
    emitDraftSummaryChange(nextDraft)

    if (options?.force) {
      pendingDraftRef.current = nextDraft
      markDraftUnsaved()
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
    emitDraftSummaryChange({
      title: editTitle,
      show_results: draftShowResults,
      questions: nextQuestions,
    })

    scheduleAutosave({
      title: editTitle,
      show_results: draftShowResults,
      questions: nextQuestions,
    })
  }

  function handleDuplicateQuestion(questionId: string) {
    const sourceIndex = questions.findIndex((question) => question.id === questionId)
    if (sourceIndex === -1) return

    const sourceQuestion = questions[sourceIndex]
    const now = new Date().toISOString()
    const duplicatedQuestion: QuizQuestion = {
      ...sourceQuestion,
      id: crypto.randomUUID(),
      options: [...sourceQuestion.options],
      created_at: now,
      updated_at: now,
    }

    const nextQuestions = normalizeQuestionPositions([
      ...questions.slice(0, sourceIndex + 1),
      duplicatedQuestion,
      ...questions.slice(sourceIndex + 1),
    ])

    setQuestions(nextQuestions)
    setExpandedQuestionIds((prev) =>
      prev.includes(questionId) ? [...prev, duplicatedQuestion.id] : prev
    )
    emitDraftSummaryChange({
      title: editTitle,
      show_results: draftShowResults,
      questions: nextQuestions,
    })

    scheduleAutosave({
      title: editTitle,
      show_results: draftShowResults,
      questions: nextQuestions,
    })
  }

  function handleToggleQuestionExpanded(questionId: string) {
    setExpandedQuestionIds((prev) =>
      prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId]
    )
  }

  function handleToggleAllQuestions() {
    const nextExpandedState = !areAllEditorSectionsExpanded

    if (hasInlineDocumentsCard) {
      setIsDocumentsCardExpanded(nextExpandedState)
    }

    if (questions.length === 0) {
      setExpandedQuestionIds([])
      return
    }

    setExpandedQuestionIds(nextExpandedState ? questions.map((question) => question.id) : [])
  }

  const clearSummaryDetailResizeListeners = useCallback(() => {
    summaryDetailResizeCleanupRef.current?.()
    summaryDetailResizeCleanupRef.current = null
  }, [])

  const handleSummaryDetailResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!summaryDetailWorkspaceRef.current) return

    clearSummaryDetailResizeListeners()
    event.preventDefault()

    const divider = event.currentTarget
    const pointerId = event.pointerId
    const { right, width } = summaryDetailWorkspaceRef.current.getBoundingClientRect()
    if (width <= 0) return

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextMarkdownWidth = ((right - moveEvent.clientX) / width) * 100
      setSummaryDetailMarkdownWidthPercent(
        clampSummaryDetailMarkdownWidthPercent(nextMarkdownWidth, width)
      )
    }

    const handleResizeEnd = () => {
      if (summaryDetailResizeCleanupRef.current !== cleanup) return
      summaryDetailResizeCleanupRef.current = null
      cleanup()
    }

    const handleLostPointerCapture = () => {
      handleResizeEnd()
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handleResizeEnd)
      window.removeEventListener('pointercancel', handleResizeEnd)
      window.removeEventListener('blur', handleResizeEnd)
      divider.removeEventListener('lostpointercapture', handleLostPointerCapture)

      if (divider.hasPointerCapture?.(pointerId)) {
        try {
          divider.releasePointerCapture(pointerId)
        } catch {
          // Pointer capture may already be released by the browser.
        }
      }
    }

    summaryDetailResizeCleanupRef.current = cleanup

    if (divider.setPointerCapture) {
      try {
        divider.setPointerCapture(pointerId)
      } catch {
        // Browsers may reject pointer capture for synthetic or interrupted events.
      }
    }

    divider.addEventListener('lostpointercapture', handleLostPointerCapture)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handleResizeEnd)
    window.addEventListener('pointercancel', handleResizeEnd)
    window.addEventListener('blur', handleResizeEnd)
  }, [clearSummaryDetailResizeListeners])

  const handleSummaryDetailResizeReset = useCallback(() => {
    setSummaryDetailMarkdownWidthPercent(TEST_SUMMARY_DETAIL_LAYOUT.defaultMarkdownWidth)
  }, [])

  useEffect(() => {
    return () => {
      clearSummaryDetailResizeListeners()
    }
  }, [clearSummaryDetailResizeListeners])

  function handleConflictReload() {
    if (!conflictDraft) return
    applyServerDraft({
      version: conflictDraft.version,
      content: conflictDraft.content,
    })
  }

  function handleMarkdownChange(content: string) {
    setIsMarkdownEditing(true)
    setMarkdownContent(content)
    setMarkdownDirty(true)
    markdownDirtyRef.current = true
    setMarkdownError('')
    setMarkdownInfo('')
  }

  function handleEditMarkdown() {
    setIsMarkdownEditing(true)
    setMarkdownError('')
    setMarkdownInfo('')
  }

  function handleUndoMarkdownChanges() {
    setMarkdownContent(currentTestMarkdown)
    setIsMarkdownEditing(false)
    setMarkdownDirty(false)
    markdownDirtyRef.current = false
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
          sample_solution: question.sample_solution,
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

    const nextDerivedMarkdown = testToMarkdown({
      title: parsed.draftContent.title,
      show_results: parsed.draftContent.show_results,
      questions: nextQuestions,
      documents: parsed.documents,
    })

    setEditTitle(parsed.draftContent.title)
    setDraftShowResults(parsed.draftContent.show_results)
    setQuestions(nextQuestions)
    setDocuments(parsed.documents)
    emitDraftSummaryChange(nextDraft)
    setMarkdownContent(nextDerivedMarkdown)
    savedMarkdownRef.current = nextDerivedMarkdown
    setIsMarkdownEditing(false)
    setMarkdownDirty(false)
    markdownDirtyRef.current = false
    setMarkdownError('')
    setMarkdownInfo('')
    pendingDraftRef.current = nextDraft
    markDraftUnsaved()

    const saved = await saveDraft(nextDraft, {
      forceFull: true,
      documents: parsed.documents,
      sourceMarkdown: nextDerivedMarkdown,
    })

    if (saved) {
      setMarkdownInfo('Markdown applied')
    }

    setMarkdownSaving(false)
  }

  const handleOpenTestPreview = useCallback(async () => {
    if (!isTestsView) return

    const previewUrl = `/classrooms/${classroomId}/tests/${quiz.id}/preview`
    let previewWindow: Window | null = null

    if (onRequestTestPreview) {
      void requestCurrentWindowFullscreen()
    } else {
      previewWindow = openMaximizedTestPreviewWindow()
    }

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
      if (onRequestTestPreview) {
        onRequestTestPreview({
          testId: quiz.id,
          title: nextDraft.title,
        })
      } else if (previewWindow && !previewWindow.closed) {
        try {
          previewWindow.location.replace(previewUrl)
          previewWindow.focus()
        } catch {
          openMaximizedTestPreviewWindow(previewUrl)
        }
      } else {
        openMaximizedTestPreviewWindow(previewUrl)
      }
    } else if (previewWindow && !previewWindow.closed) {
      previewWindow.close()
    }

    setOpeningTestPreview(false)
  }, [
    classroomId,
    documents,
    draftShowResults,
    editTitle,
    isTestsView,
    openMaximizedTestPreviewWindow,
    onRequestTestPreview,
    questions,
    quiz.id,
    requestCurrentWindowFullscreen,
    saveDraft,
  ])

  useEffect(() => {
    if (!isTestsView) return
    if (previousPreviewRequestTokenRef.current === previewRequestToken) return
    previousPreviewRequestTokenRef.current = previewRequestToken
    if (previewRequestToken === 0) return

    void handleOpenTestPreview()
  }, [handleOpenTestPreview, isTestsView, previewRequestToken])

  const testsMarkdownPanel = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span data-testid="markdown-helper-status" className="text-xs font-medium text-text-muted">
          {markdownHelperStatus}
        </span>
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
            Schema
          </Button>
          {!isMarkdownEditing ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleEditMarkdown}
              disabled={!isEditable || markdownSaving}
            >
              Edit Markdown
            </Button>
          ) : null}
          {hasPendingMarkdownImport ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Undo markdown edits"
                title="Undo markdown edits"
                onClick={handleUndoMarkdownChanges}
                disabled={markdownSaving}
                className="h-8 w-8 p-0"
              >
                <RotateCcw className="h-4 w-4" />
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
            </>
          ) : null}
        </div>
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
        data-testid="test-markdown-editor"
        value={markdownContent}
        readOnly={!isMarkdownEditable}
        onChange={(event) => handleMarkdownChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && hasPendingMarkdownImport) {
            event.preventDefault()
            void handleApplyMarkdown()
          }
        }}
        className={cn(
          'min-h-[420px] flex-1 w-full rounded-md border border-border p-3 font-mono text-sm text-text-default',
          isMarkdownEditable
            ? 'bg-surface focus:outline-none focus:ring-2 focus:ring-primary'
            : 'cursor-default bg-surface-2 focus:outline-none'
        )}
        spellCheck={false}
      />
    </div>
  )

  function renderTestAddQuestionSplitButton() {
    return (
      <SplitButton
        label={preferredTestQuestionType === 'open_response' ? '+ Open Question' : '+ MC Question'}
        onPrimaryClick={() => handleAddTestQuestionViaSplitButton(preferredTestQuestionType)}
        options={[
          {
            id: 'multiple_choice',
            label: 'MC',
            onSelect: () => handleAddTestQuestionViaSplitButton('multiple_choice'),
          },
          {
            id: 'open_response',
            label: 'Open',
            onSelect: () => handleAddTestQuestionViaSplitButton('open_response'),
          },
        ]}
        variant="primary"
        size="sm"
        disabled={hasPendingMarkdownImport}
        className="flex w-full shadow-sm"
        toggleAriaLabel="Choose question type"
        primaryButtonProps={{
          className: 'min-w-0 flex-1 justify-center font-semibold',
        }}
      />
    )
  }

  const testsDocumentsPanel = (
    <div className="space-y-3 p-4">
      <div className="text-xs text-text-muted">
        {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
      </div>
      <TestDocumentsEditor
        testId={quiz.id}
        documents={documents}
        apiBasePath={apiBasePath}
        isEditable={isEditable}
        onDocumentsChange={setDocuments}
      />
    </div>
  )

  const testsInlineDocumentsCard = (
    <div
      data-testid="test-documents-card"
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          type="button"
          data-testid="test-documents-card-toggle"
          aria-expanded={isDocumentsCardExpanded}
          aria-label={isDocumentsCardExpanded ? 'Collapse documents' : 'Expand documents'}
          onClick={() => setIsDocumentsCardExpanded((prev) => !prev)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-medium text-text-default">Documents</span>
            <span className="text-xs text-text-muted">
              {documents.length} document{documents.length === 1 ? '' : 's'}
            </span>
          </div>
          <span className="text-text-muted">
            {isDocumentsCardExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
        {isEditable && !hasPendingMarkdownImport ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            aria-label="Add Document"
            className="h-8 w-8 shrink-0 px-0 text-base font-semibold leading-none"
            onClick={() => {
              setIsDocumentsCardExpanded(true)
              setExternalDocumentAddRequest({
                id: Date.now(),
                mode: 'link',
              })
            }}
          >
            +
          </Button>
        ) : null}
      </div>
      {isDocumentsCardExpanded ? (
        <div className="border-t border-border p-3">
          <TestDocumentsEditor
            testId={quiz.id}
            documents={documents}
            apiBasePath={apiBasePath}
            isEditable={isEditable && !hasPendingMarkdownImport}
            onDocumentsChange={setDocuments}
            addButtonPlacement="none"
            externalAddRequest={externalDocumentAddRequest}
            onExternalAddRequestHandled={() => setExternalDocumentAddRequest(null)}
          />
        </div>
      ) : null}
    </div>
  )

  const testQuestionEditorPane = (
    <div data-testid="test-question-editor-pane" className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-muted">
            <span>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
            </span>
            <span aria-hidden="true">•</span>
            <span data-testid="test-question-editor-header-summary">
              {questions.length} question{questions.length === 1 ? '' : 's'} • {totalQuestionPoints} pts
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={areAllEditorSectionsExpanded ? 'Collapse all sections' : 'Expand all sections'}
            onClick={handleToggleAllQuestions}
            disabled={!hasCollapsibleEditorSections}
            className="h-8 w-8 shrink-0 p-0 text-text-muted hover:text-text-default"
          >
            {areAllEditorSectionsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn('flex h-full min-h-0 flex-col', hasPendingMarkdownImport && 'opacity-60')}>
          <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="test-question-accordion-list">
            <div className="space-y-3">
              {testsInlineDocumentsCard}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={questions.map((question) => question.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {questions.map((question, index) => (
                      <TestQuestionEditor
                        key={question.id}
                        question={question}
                        questionNumber={index + 1}
                        isEditable={isEditable}
                        onChange={handleQuestionChange}
                        onDuplicate={handleDuplicateQuestion}
                        onDelete={handleQuestionDelete}
                        variant="accordion"
                        isExpanded={expandedQuestionIds.includes(question.id)}
                        onToggleExpanded={() => handleToggleQuestionExpanded(question.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>

          {isEditable ? (
            <div className="border-t border-border p-3">
              {renderTestAddQuestionSplitButton()}
            </div>
          ) : null}
        </div>
        {hasPendingMarkdownImport ? (
          <div
            data-testid="markdown-pending-lock"
            className="absolute inset-0 z-10 flex items-center justify-center bg-surface/75 px-6 text-center"
          >
            <div className="max-w-sm rounded-md border border-warning bg-surface px-4 py-3 text-sm text-text-default shadow-lg">
              Apply or undo markdown changes to continue editing questions.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )

  const testsSummaryDetailPanel = (
    <div
      ref={summaryDetailWorkspaceRef}
      data-testid="test-summary-detail-layout"
      className="flex h-full min-h-0 flex-1"
    >
      <SummaryDetailWorkspaceShell
        className="flex-1"
        orientation={usesWideSummaryDetailLayout ? 'row' : 'responsive'}
        leftPaneClassName="min-h-0 bg-surface-2"
        rightPaneClassName="min-h-0"
        rightWidthPercent={usesWideSummaryDetailLayout ? clampedSummaryDetailMarkdownWidthPercent : undefined}
        divider={{
          label: 'Resize question and markdown panes',
          onPointerDown: handleSummaryDetailResizeStart,
          onDoubleClick: handleSummaryDetailResizeReset,
        }}
        left={testQuestionEditorPane}
        right={
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" data-testid="test-question-markdown-pane">
            <div className="flex min-h-0 flex-1 flex-col p-4">
              {testsMarkdownPanel}
            </div>
          </div>
        }
      />
    </div>
  )

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* Tabs */}
      {!usesSummaryDetailQuestions && !usesEditorOnlyQuestions && !usesMarkdownOnlyQuestions && (
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
            {`Questions (${questions.length})`}
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
        {isTestsView && showMarkdown && (
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
        {resolvedShowResultsTab && (
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
        )}
        {isTestsView && showPreviewButton && (
          <div className="ml-2 flex items-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void handleOpenTestPreview()
              }}
              disabled={openingTestPreview || hasPendingMarkdownImport}
              className="h-8 gap-1.5 px-3 font-semibold"
            >
              <ExternalLink className="h-4 w-4" />
              {openingTestPreview ? 'Opening Preview...' : 'Preview'}
            </Button>
          </div>
        )}
        {isTestsView && onRequestDelete && showInlineDeleteAction ? (
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
      )}

      {/* Content */}
      <div
        className={[
          'flex-1',
          usesSummaryDetailQuestions || usesEditorOnlyQuestions || usesMarkdownOnlyQuestions
            ? 'min-h-0 overflow-hidden p-0'
            : 'overflow-y-auto p-4',
        ].join(' ')}
      >
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

        {usesEditorOnlyQuestions ? (
          <div data-testid="test-editor-only-layout" className="h-full min-h-0 bg-surface-2">
            {testQuestionEditorPane}
          </div>
        ) : usesMarkdownOnlyQuestions ? (
          <div data-testid="test-markdown-only-layout" className="flex h-full min-h-0 flex-col p-4">
            {testsMarkdownPanel}
          </div>
        ) : usesSummaryDetailQuestions ? (
          testsSummaryDetailPanel
        ) : viewMode === 'questions' ? (
          <div className="space-y-3">
            {/* Inline editable title */}
            {isEditingTitle ? (
              <div className="flex items-center gap-1">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editTitle}
                  onChange={(e) => {
                    const nextTitle = e.target.value
                    setEditTitle(nextTitle)
                    emitDraftSummaryChange({
                      title: nextTitle,
                      show_results: draftShowResults,
                      questions,
                    })
                  }}
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

            <div className="relative">
              <div className={cn('space-y-3', isTestsView && hasPendingMarkdownImport && 'opacity-60')}>
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
                          onDuplicate={handleDuplicateQuestion}
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
                    renderTestAddQuestionSplitButton()
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
              {isTestsView && hasPendingMarkdownImport ? (
                <div
                  data-testid="markdown-pending-lock"
                  className="absolute inset-0 z-10 flex items-center justify-center bg-surface/75 px-6 text-center"
                >
                  <div className="max-w-sm rounded-md border border-warning bg-surface px-4 py-3 text-sm text-text-default shadow-lg">
                    Apply or undo markdown changes to continue editing questions.
                  </div>
                </div>
              ) : null}
            </div>

          </div>
        ) : viewMode === 'documents' && isTestsView ? (
          <div className="space-y-3">
            <TestDocumentsEditor
              testId={quiz.id}
              documents={documents}
              apiBasePath={apiBasePath}
              isEditable={isEditable}
              onDocumentsChange={setDocuments}
              addButtonPlacement="header"
              headerTitle="Reference Documents"
            />
          </div>
        ) : viewMode === 'markdown' && isTestsView && showMarkdown ? (
          testsMarkdownPanel
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
                  <div
                    key={optionIndex}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-hover'
                    }`}
                    onClick={() => setSelected((prev) => ({ ...prev, [question.id]: optionIndex }))}
                  >
                    <input
                      type="radio"
                      name={`preview-${question.id}`}
                      checked={isSelected}
                      aria-label={option}
                      onChange={() => setSelected((prev) => ({ ...prev, [question.id]: optionIndex }))}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-primary' : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </span>
                    <QuestionMarkdown content={option} className="min-w-0 flex-1" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
