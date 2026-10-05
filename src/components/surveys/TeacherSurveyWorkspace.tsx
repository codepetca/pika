'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react'
import { Code2, Copy, ExternalLink, Eye, ListPlus, Plus, RotateCcw, Settings, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Card, ConfirmDialog, FormField, Input, SaveStatus, Tooltip, type SaveStatusState } from '@/ui'
import { MarkdownContentEditor } from '@/components/editor'
import { TeacherWorkSurfaceIconMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { SurveyQuestionOptions } from '@/components/surveys/SurveyQuestionOptions'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { Spinner } from '@/components/Spinner'
import { SurveyOptionResultBar } from '@/components/surveys/SurveyOptionResultBar'
import { getDisplayAssessmentTitle, isGeneratedAssessmentTitle } from '@/lib/assessment-titles'
import {
  DEFAULT_SURVEY_LINK_MAX_CHARS,
  DEFAULT_SURVEY_TEXT_MAX_CHARS,
  getSurveyStatusLabel,
  normalizeSurveyQuestionInput,
} from '@/lib/surveys'
import { markdownToSurvey, surveyToMarkdown } from '@/lib/survey-markdown'
import type { Survey, SurveyQuestion, SurveyQuestionResult, SurveyQuestionType } from '@/types'

interface TeacherSurveyWorkspaceProps {
  classroomId: string
  surveyId: string
  isReadOnly?: boolean
  initialEditMode?: 'edit' | 'markdown'
  autoEditTitle?: boolean
  onInitialEditModeConsumed?: () => void
  onCloseReady?: (close: (() => Promise<void>) | null) => void
  onBack: () => void
  onSurveyUpdated: (survey: Survey) => void
  onQuestionCountChanged?: (surveyId: string, questionsCount: number) => void
  onSurveyDeleted: (surveyId: string) => void
}

type SurveyDetailPayload = {
  survey: Survey
  questions: SurveyQuestion[]
}

type SurveyResultsPayload = {
  results: SurveyQuestionResult[]
  stats: {
    total_students: number
    responded: number
  }
}

type SurveyPreviewResponse = {
  selectedOption?: number
  responseText?: string
}

type SurveyTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  hasError?: boolean
}

const SurveyTextarea = forwardRef<HTMLTextAreaElement, SurveyTextareaProps>(
  function SurveyTextarea({ hasError: _hasError, ...props }, ref) {
    return <textarea ref={ref} {...props} />
  }
)

function defaultMaxChars(questionType: SurveyQuestionType) {
  return questionType === 'link' ? DEFAULT_SURVEY_LINK_MAX_CHARS : DEFAULT_SURVEY_TEXT_MAX_CHARS
}

function buildQuestionSavePayload(
  questionType: SurveyQuestionType,
  questionText: string,
  optionsText: string,
  responseMaxChars: string,
) {
  return {
    question_type: questionType,
    question_text: questionText,
    options: questionType === 'multiple_choice' ? optionsText.split('\n').map((option) => option.trim()).filter(Boolean) : [],
    response_max_chars: Number(responseMaxChars) || defaultMaxChars(questionType),
  }
}

type QuestionEditorHandle = {
  flush: () => Promise<boolean>
  delete: () => Promise<void>
  setType: (type: SurveyQuestionType) => void
  getDraft: () => ReturnType<typeof buildQuestionSavePayload>
}

function SurveyQuestionFields({ questionType, questionText, optionsText, responseMaxChars, disabled, promptLabel, onTextChange, onOptionsChange, onLimitChange, onBlur }: {
  questionType: SurveyQuestionType
  questionText: string
  optionsText: string
  responseMaxChars: string
  disabled: boolean
  promptLabel: string
  onTextChange: (value: string) => void
  onOptionsChange: (value: string) => void
  onLimitChange: (value: string) => void
  onBlur?: () => void
}) {
  return (
    <>
      <MarkdownContentEditor markdown={questionText} onMarkdownChange={onTextChange} aria-label={promptLabel} placeholder="Ask students a question" toolbarPreset="compact" disabled={disabled} onBlur={onBlur} className="shrink-0 overflow-hidden rounded-md border border-border bg-surface [&_.ProseMirror]:!min-h-32" />
      {questionType === 'multiple_choice' ? (
        <SurveyQuestionOptions options={optionsText.split('\n')} disabled={disabled} onChange={(options) => onOptionsChange(options.join('\n'))} onBlur={onBlur} />
      ) : (
        <div className="min-h-0 flex-1 rounded-md bg-surface-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{questionType === 'link' ? 'Link response' : 'Open response'}</p>
          <p className="mt-2 text-sm text-text-muted">{questionType === 'link' ? 'Students share a URL.' : 'Students answer in their own words.'}</p>
          <FormField label="Response character limit" className="mt-3"><Input type="number" min="1" max="5000" value={responseMaxChars} disabled={disabled} onChange={(event) => onLimitChange(event.target.value)} onBlur={onBlur} /></FormField>
        </div>
      )}
    </>
  )
}

const QuestionEditor = forwardRef<QuestionEditorHandle, {
  question: SurveyQuestion
  disabled: boolean
  interactionDisabled?: boolean
  onSaved: (question: SurveyQuestion) => void
  onDeleted: (questionId: string) => void
  onStatusChange: (status: SaveStatusState) => void
  onTypeChange: (type: SurveyQuestionType) => void
}>(function QuestionEditor({
  question,
  disabled,
  interactionDisabled = false,
  onSaved,
  onDeleted,
  onStatusChange,
  onTypeChange,
}, ref) {
  const [questionType, setQuestionType] = useState<SurveyQuestionType>(question.question_type)
  const [questionText, setQuestionText] = useState(question.question_text)
  const [optionsText, setOptionsText] = useState(question.options.join('\n'))
  const [responseMaxChars, setResponseMaxChars] = useState(String(question.response_max_chars))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pendingSaveRef = useRef<Promise<boolean> | null>(null)
  const deletingRef = useRef(false)
  const lastSavedPayloadRef = useRef(JSON.stringify(buildQuestionSavePayload(question.question_type, question.question_text, question.options.join('\n'), String(question.response_max_chars))))
  const lastAttemptedPayloadRef = useRef('')

  useEffect(() => {
    setQuestionType(question.question_type)
    setQuestionText(question.question_text)
    setOptionsText(question.options.join('\n'))
    setResponseMaxChars(String(question.response_max_chars))
    const nextPayload = buildQuestionSavePayload(
      question.question_type,
      question.question_text,
      question.options.join('\n'),
      String(question.response_max_chars),
    )
    const nextPayloadKey = JSON.stringify(nextPayload)
    lastSavedPayloadRef.current = nextPayloadKey
    lastAttemptedPayloadRef.current = nextPayloadKey
    setError('')
  }, [question])

  const saveQuestion = useCallback(async (
    payload: ReturnType<typeof buildQuestionSavePayload>,
    payloadKey: string,
  ) => {
    lastAttemptedPayloadRef.current = payloadKey
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${question.survey_id}/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save question')
      lastSavedPayloadRef.current = payloadKey
      onSaved(data.question)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save question')
      return false
    } finally {
      setSaving(false)
    }
  }, [onSaved, question.id, question.survey_id])

  const saveCurrentQuestion = useCallback(async () => {
    if (disabled) return true
    if (deletingRef.current) return false
    if (pendingSaveRef.current) return pendingSaveRef.current

    const payload = buildQuestionSavePayload(questionType, questionText, optionsText, responseMaxChars)
    const payloadKey = JSON.stringify(payload)
    if (payloadKey === lastSavedPayloadRef.current) return true

    const pending = saveQuestion(payload, payloadKey)
    pendingSaveRef.current = pending
    try {
      return await pending
    } finally {
      pendingSaveRef.current = null
    }
  }, [disabled, optionsText, questionText, questionType, responseMaxChars, saveQuestion])

  useImperativeHandle(ref, () => ({
    flush: saveCurrentQuestion,
    delete: deleteQuestion,
    setType: (type) => { setQuestionType(type); setResponseMaxChars(String(defaultMaxChars(type))) },
    getDraft: () => buildQuestionSavePayload(questionType, questionText, optionsText, responseMaxChars),
  }))

  useEffect(() => {
    if (disabled || saving) return

    const payload = buildQuestionSavePayload(questionType, questionText, optionsText, responseMaxChars)
    const payloadKey = JSON.stringify(payload)
    if (
      payloadKey === lastSavedPayloadRef.current ||
      payloadKey === lastAttemptedPayloadRef.current
    ) {
      return
    }

    const timeout = window.setTimeout(() => {
      saveCurrentQuestion()
    }, 600)

    return () => window.clearTimeout(timeout)
  }, [disabled, optionsText, questionText, questionType, responseMaxChars, saveCurrentQuestion, saving])

  async function deleteQuestion() {
    if (deletingRef.current || pendingSaveRef.current) return
    deletingRef.current = true
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${question.survey_id}/questions/${question.id}`, {
        method: 'DELETE',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to delete question')
      onDeleted(question.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete question')
    } finally {
      deletingRef.current = false
      setSaving(false)
    }
  }

  const currentPayloadKey = JSON.stringify(buildQuestionSavePayload(questionType, questionText, optionsText, responseMaxChars))
  const saveStatus = error ? 'error' : saving ? 'saving' : currentPayloadKey === lastSavedPayloadRef.current ? 'saved' : 'unsaved'

  useEffect(() => { onStatusChange(saveStatus) }, [onStatusChange, saveStatus])
  useEffect(() => { onTypeChange(questionType) }, [onTypeChange, questionType])

  return (
    <>
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      <SurveyQuestionFields questionType={questionType} questionText={questionText} optionsText={optionsText} responseMaxChars={responseMaxChars} disabled={disabled || interactionDisabled || saving} promptLabel="Prompt" onTextChange={setQuestionText} onOptionsChange={setOptionsText} onLimitChange={setResponseMaxChars} />
    </>
  )
})

export function TeacherSurveyResultsView({ payload }: { payload: SurveyResultsPayload | null }) {
  if (!payload) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  }

  if (payload.results.length === 0) {
    return <p className="py-4 text-sm text-text-muted">No responses yet.</p>
  }

  return (
    <div className="space-y-6">
      {payload.results.map((result, index) => (
        <div key={result.question_id} className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Q{index + 1}</p>
            <QuestionMarkdown content={result.question_text} />
          </div>

          {result.question_type === 'multiple_choice' ? (
            <div className="space-y-1.5">
              {result.options.map((option, optionIndex) => {
                const count = result.counts[optionIndex] || 0
                return (
                  <SurveyOptionResultBar
                    key={optionIndex}
                    option={option}
                    count={count}
                    totalResponses={result.total_responses}
                  />
                )
              })}
            </div>
          ) : result.responses.length === 0 ? (
            <p className="text-sm text-text-muted">No text responses yet.</p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {result.responses.map((response) => (
                <div key={response.response_id} className="grid gap-1 bg-surface px-3 py-2 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <span className="min-w-0 truncate font-medium text-text-default">
                    {response.name || response.email || 'Student'}
                  </span>
                  {result.question_type === 'link' ? (
                    <a
                      href={response.response_text}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
                    >
                      <span className="truncate">{response.response_text}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="whitespace-pre-wrap text-text-default">{response.response_text}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function TeacherSurveyPreview({
  survey,
  questions,
}: {
  survey: Survey
  questions: SurveyQuestion[]
}) {
  const [responses, setResponses] = useState<Record<string, SurveyPreviewResponse>>({})

  useEffect(() => {
    setResponses({})
  }, [questions, survey.id])

  return (
    <Card tone="panel" padding="lg" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-text-default">{survey.title}</h2>
          <p className="mt-1 text-sm text-text-muted">Survey</p>
        </div>
        <span className="self-start rounded-badge bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">
          Student preview
        </span>
      </div>

      {questions.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-4 text-center text-sm text-text-muted">
          No questions to preview.
        </p>
      ) : (
        <>
          <div className="space-y-5">
            {questions.map((question, index) => {
              const response = responses[question.id] || {}
              return (
                <div key={question.id} className="space-y-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Q{index + 1}</p>
                    <QuestionMarkdown content={question.question_text} />
                  </div>

                  {question.question_type === 'multiple_choice' ? (
                    <div className="space-y-2">
                      {question.options.map((option, optionIndex) => {
                        const isSelected = response.selectedOption === optionIndex
                        return (
                          <button
                            key={optionIndex}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => {
                              setResponses((current) => ({
                                ...current,
                                [question.id]: { selectedOption: optionIndex },
                              }))
                            }}
                            className={[
                              'flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors',
                              isSelected
                                ? 'border-primary bg-primary/5 text-text-default'
                                : 'border-border bg-surface text-text-default hover:bg-surface-hover',
                            ].join(' ')}
                          >
                            <span
                              aria-hidden="true"
                              className={[
                                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                                isSelected ? 'border-primary' : 'border-border',
                              ].join(' ')}
                            >
                              {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                            </span>
                            <span>{option}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : question.question_type === 'link' ? (
                    <Input
                      type="url"
                      aria-label={`Q${index + 1} link response preview`}
                      value={response.responseText || ''}
                      onChange={(event) => {
                        setResponses((current) => ({
                          ...current,
                          [question.id]: { responseText: event.target.value },
                        }))
                      }}
                      placeholder="https://example.com"
                    />
                  ) : (
                    <textarea
                      aria-label={`Q${index + 1} text response preview`}
                      value={response.responseText || ''}
                      onChange={(event) => {
                        setResponses((current) => ({
                          ...current,
                          [question.id]: { responseText: event.target.value },
                        }))
                      }}
                      rows={4}
                      maxLength={question.response_max_chars}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Write your response..."
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button type="button" disabled>
              Submit
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

export function TeacherSurveyWorkspace({
  surveyId,
  isReadOnly = false,
  initialEditMode,
  autoEditTitle = false,
  onInitialEditModeConsumed,
  onBack,
  onCloseReady,
  onSurveyUpdated,
  onQuestionCountChanged,
  onSurveyDeleted,
}: TeacherSurveyWorkspaceProps) {
  const questionEditorRef = useRef<QuestionEditorHandle>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [editingQuestionType, setEditingQuestionType] = useState<SurveyQuestionType | null>(null)
  const navigationPendingRef = useRef(false)
  const [navigationPending, setNavigationPending] = useState(false)
  const [detail, setDetail] = useState<SurveyDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newQuestionType, setNewQuestionType] = useState<SurveyQuestionType>('multiple_choice')
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newOptionsText, setNewOptionsText] = useState('\n')
  const [newResponseMaxChars, setNewResponseMaxChars] = useState(String(DEFAULT_SURVEY_TEXT_MAX_CHARS))
  const [numberDraft, setNumberDraft] = useState('1')
  const [questionStatus, setQuestionStatus] = useState<SaveStatusState>('saved')
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titlePendingRef = useRef<Promise<boolean> | null>(null)
  const focusedTitleRef = useRef<string | null>(null)
  const titleFocusRequestedRef = useRef(autoEditTitle)
  if (autoEditTitle) titleFocusRequestedRef.current = true
  const createPendingRef = useRef<Promise<boolean> | null>(null)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [titleSaving, setTitleSaving] = useState(false)
  const [responseSettingSaving, setResponseSettingSaving] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [surveyEditMode, setSurveyEditMode] = useState<'edit' | 'markdown' | 'preview'>('edit')
  const [surveyMarkdown, setSurveyMarkdown] = useState('')
  const [surveyMarkdownDirty, setSurveyMarkdownDirty] = useState(false)
  const [surveyMarkdownSaving, setSurveyMarkdownSaving] = useState(false)
  const [surveyMarkdownError, setSurveyMarkdownError] = useState('')
  const [surveyMarkdownInfo, setSurveyMarkdownInfo] = useState('')
  const onSurveyUpdatedRef = useRef(onSurveyUpdated)
  const consumedInitialEditModeRef = useRef<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const currentSurveyIdRef = useRef(surveyId)
  currentSurveyIdRef.current = surveyId

  useEffect(() => {
    onSurveyUpdatedRef.current = onSurveyUpdated
  }, [onSurveyUpdated])

  const activeDetail = detail?.survey?.id === surveyId ? detail : null
  const survey = activeDetail?.survey ?? null
  const questions = useMemo(() => activeDetail?.questions ?? [], [activeDetail?.questions])
  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId) ?? null
  const currentSurveyMarkdown = useMemo(
    () => (survey ? surveyToMarkdown({ survey, questions }) : ''),
    [questions, survey],
  )

  useEffect(() => {
    if (survey) setTitleDraft(getDisplayAssessmentTitle(survey.title, 'Untitled Survey'))
  }, [survey])

  useEffect(() => {
    if (!survey || isReadOnly || !titleFocusRequestedRef.current || focusedTitleRef.current === survey.id || titleDraft !== getDisplayAssessmentTitle(survey.title, 'Untitled Survey')) return
    focusedTitleRef.current = survey.id
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
    titleFocusRequestedRef.current = false
  }, [autoEditTitle, isReadOnly, survey, titleDraft])

  useEffect(() => { setNumberDraft(String(Math.max(0, questions.findIndex((question) => question.id === selectedQuestionId)) + 1)) }, [questions, selectedQuestionId])

  const loadSurvey = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const requestedSurveyId = surveyId
    setLoading(true)
    setError('')
    try {
      // Bypass fetchJSONWithCache for selected survey freshness; request ids guard stale responses.
      const response = await fetch(`/api/teacher/surveys/${surveyId}`)
      const data = await response.json()
      if (loadRequestIdRef.current !== requestId || currentSurveyIdRef.current !== requestedSurveyId) return
      if (!response.ok) throw new Error(data.error || 'Failed to load survey')
      setDetail({ survey: data.survey, questions: data.questions || [] })
      setSelectedQuestionId(data.questions?.[0]?.id ?? null)
      setEditingQuestionType(null)
      setNewQuestionText('')
      setNewQuestionType('multiple_choice')
      setNewOptionsText('\n')
      onSurveyUpdatedRef.current(data.survey)
    } catch (err) {
      if (loadRequestIdRef.current === requestId && currentSurveyIdRef.current === requestedSurveyId) {
        setError(err instanceof Error ? err.message : 'Failed to load survey')
        setDetail(null)
      }
    } finally {
      if (loadRequestIdRef.current === requestId && currentSurveyIdRef.current === requestedSurveyId) {
        setLoading(false)
      }
    }
  }, [surveyId])

  useEffect(() => {
    void loadSurvey()
  }, [loadSurvey])

  useEffect(() => {
    if (!survey) return
    if (surveyMarkdownDirty) return
    if (surveyMarkdown !== currentSurveyMarkdown) {
      setSurveyMarkdown(currentSurveyMarkdown)
    }
  }, [currentSurveyMarkdown, survey, surveyMarkdown, surveyMarkdownDirty])

  useEffect(() => {
    if (!survey || !initialEditMode) return
    const initialEditModeKey = `${survey.id}:${initialEditMode}`
    if (consumedInitialEditModeRef.current === initialEditModeKey) return

    consumedInitialEditModeRef.current = initialEditModeKey
    setSurveyEditMode(initialEditMode)
    setSurveyMarkdownError('')
    setSurveyMarkdownInfo('')
    onInitialEditModeConsumed?.()
  }, [initialEditMode, onInitialEditModeConsumed, survey])

  async function saveTitle(title: string) {
    if (!survey || isReadOnly) return false

    const cleanTitle = title.trim()
    if (
      !cleanTitle ||
      ((cleanTitle === 'Untitled' || cleanTitle === 'Untitled Survey') &&
        isGeneratedAssessmentTitle(survey.title))
    ) {
      setTitleDraft(getDisplayAssessmentTitle(survey.title, 'Untitled Survey'))
      setTitleError('')
      return true
    }

    if (cleanTitle === survey.title) {
      setTitleError('')
      return true
    }

    setTitleSaving(true)
    setTitleError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${surveyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanTitle }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update survey title')
      if (currentSurveyIdRef.current !== surveyId) return false
      setDetail((current) => current ? { ...current, survey: data.survey } : current)
      onSurveyUpdated(data.survey)
      return true
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : 'Failed to update survey title')
      return false
    } finally {
      setTitleSaving(false)
    }
  }

  async function flushTitle() {
    if (isReadOnly) return true
    if (titlePendingRef.current) return titlePendingRef.current
    const pending = saveTitle(titleDraft)
    titlePendingRef.current = pending
    try { return await pending } finally { titlePendingRef.current = null }
  }

  async function saveSetting(field: 'dynamic_responses' | 'show_results', value: boolean) {
    if (!survey || isReadOnly || value === survey[field]) return
    if (!await flushTitle()) return

    setResponseSettingSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${surveyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update survey')
      if (currentSurveyIdRef.current !== surveyId) return
      setDetail((current) => current ? { ...current, survey: data.survey } : current)
      onSurveyUpdated(data.survey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update survey')
    } finally {
      setResponseSettingSaving(false)
    }
  }

  async function createQuestion(payload: ReturnType<typeof buildQuestionSavePayload>) {
    setAddingQuestion(true)
    setError('')
    try {
      const normalized = normalizeSurveyQuestionInput(payload)
      if (!normalized.valid) throw new Error(normalized.error)
      const response = await fetch(`/api/teacher/surveys/${surveyId}/questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(normalized.question),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to add question')
      if (currentSurveyIdRef.current !== surveyId) return false
      setDetail((current) => current?.survey.id === surveyId ? { ...current, questions: [...current.questions, data.question] } : current)
      setSelectedQuestionId(data.question.id)
      setEditingQuestionType(null)
      onQuestionCountChanged?.(surveyId, questions.length + 1)
      setNewQuestionText('')
      setNewOptionsText('\n')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add question')
      return false
    } finally { setAddingQuestion(false) }
  }

  async function addQuestion() {
    if (isReadOnly) return false
    if (createPendingRef.current) return createPendingRef.current
    const pending = createQuestion(buildQuestionSavePayload(newQuestionType, newQuestionText, newOptionsText, newResponseMaxChars))
    createPendingRef.current = pending
    try { return await pending } finally { createPendingRef.current = null }
  }

  function handleSurveyMarkdownChange(content: string) {
    setSurveyMarkdown(content)
    setSurveyMarkdownDirty(true)
    setSurveyMarkdownError('')
    setSurveyMarkdownInfo('')
  }

  function handleUndoSurveyMarkdownChanges() {
    setSurveyMarkdown(currentSurveyMarkdown)
    setSurveyMarkdownDirty(false)
    setSurveyMarkdownError('')
    setSurveyMarkdownInfo('')
  }

  async function applySurveyMarkdown() {
    if (!survey) return
    if (isReadOnly) {
      setSurveyMarkdownError('This survey is read-only.')
      return
    }

    setSurveyMarkdownSaving(true)
    setSurveyMarkdownError('')
    setSurveyMarkdownInfo('')

    const parsed = markdownToSurvey(surveyMarkdown, {
      defaultShowResults: survey.show_results,
      defaultDynamicResponses: survey.dynamic_responses,
      existingQuestions: questions.map((question) => ({ id: question.id })),
    })

    if (parsed.errors.length > 0 || !parsed.content) {
      setSurveyMarkdownError(parsed.errors.join('\n') || 'Invalid markdown')
      setSurveyMarkdownSaving(false)
      return
    }

    try {
      let nextSurvey = survey
      const surveyUpdate: Record<string, unknown> = {}
      if (parsed.content.title !== survey.title) surveyUpdate.title = parsed.content.title
      if (parsed.content.show_results !== survey.show_results) {
        surveyUpdate.show_results = parsed.content.show_results
      }
      if (parsed.content.dynamic_responses !== survey.dynamic_responses) {
        surveyUpdate.dynamic_responses = parsed.content.dynamic_responses
      }

      if (Object.keys(surveyUpdate).length > 0) {
        const response = await fetch(`/api/teacher/surveys/${surveyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(surveyUpdate),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to update survey')
        nextSurvey = data.survey
      }

      const existingById = new Map(questions.map((question) => [question.id, question]))
      const retainedQuestionIds = new Set<string>()
      const savedQuestions: SurveyQuestion[] = []

      for (let index = 0; index < parsed.content.questions.length; index += 1) {
        const question = parsed.content.questions[index]
        const body = {
          question_type: question.question_type,
          question_text: question.question_text,
          options: question.options,
          response_max_chars: question.response_max_chars,
          position: index,
        }
        const existingQuestion = question.id ? existingById.get(question.id) : undefined
        const response = await fetch(
          existingQuestion
            ? `/api/teacher/surveys/${surveyId}/questions/${encodeURIComponent(existingQuestion.id)}`
            : `/api/teacher/surveys/${surveyId}/questions`,
          {
            method: existingQuestion ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        )
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to save question')
        retainedQuestionIds.add(data.question.id)
        savedQuestions.push(data.question)
      }

      for (const existingQuestion of questions) {
        if (retainedQuestionIds.has(existingQuestion.id)) continue
        const response = await fetch(
          `/api/teacher/surveys/${surveyId}/questions/${encodeURIComponent(existingQuestion.id)}`,
          { method: 'DELETE' },
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to delete removed question')
      }

      const nextQuestions = savedQuestions
        .slice()
        .sort((left, right) => left.position - right.position)
      setDetail({ survey: nextSurvey, questions: nextQuestions })
      onSurveyUpdated(nextSurvey)
      onQuestionCountChanged?.(surveyId, nextQuestions.length)

      const nextMarkdown = surveyToMarkdown({ survey: nextSurvey, questions: nextQuestions })
      setSurveyMarkdown(nextMarkdown)
      setSurveyMarkdownDirty(false)
      setSurveyMarkdownInfo('Markdown applied')
      setSelectedQuestionId(nextQuestions[0]?.id ?? null)
      setSurveyEditMode('edit')
    } catch (err) {
      setSurveyMarkdownError(err instanceof Error ? err.message : 'Failed to apply markdown')
    } finally {
      setSurveyMarkdownSaving(false)
    }
  }

  async function deleteSurvey() {
    if (!survey) return
    setStatusChanging(true)
    try {
      const response = await fetch(`/api/teacher/surveys/${survey.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to delete survey')
      onSurveyDeleted(survey.id)
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete survey')
    } finally {
      setStatusChanging(false)
      setDeleteConfirmOpen(false)
    }
  }

  async function navigate(action: () => void | Promise<void>) {
    if (navigationPendingRef.current || surveyMarkdownSaving || responseSettingSaving || statusChanging) return
    const requestedSurveyId = surveyId
    navigationPendingRef.current = true
    setNavigationPending(true)
    try {
      if (!await flushTitle()) return
      if (surveyMarkdownDirty && surveyEditMode === 'markdown') {
        setError('Apply or undo Markdown edits before continuing.')
        return
      }
      const saved = createPendingRef.current ? await createPendingRef.current : !selectedQuestion && (newQuestionText.trim() || newOptionsText.trim()) && surveyEditMode === 'edit' ? await addQuestion() : await (questionEditorRef.current?.flush() ?? Promise.resolve(true))
      if (saved && currentSurveyIdRef.current === requestedSurveyId) await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save survey')
    } finally {
      navigationPendingRef.current = false
      setNavigationPending(false)
    }
  }

  function startQuestion(type: SurveyQuestionType) {
    void navigate(() => {
      setSelectedQuestionId(null)
      setEditingQuestionType(null)
      setSurveyEditMode('edit')
      setNewQuestionType(type)
      setNewQuestionText('')
      setNewOptionsText('\n')
      setNewResponseMaxChars(String(defaultMaxChars(type)))
      setQuestionStatus('saved')
    })
  }

  function duplicateQuestion() {
    void navigate(async () => {
      const draft = questionEditorRef.current?.getDraft()
      if (draft) await createQuestion(draft)
    })
  }

  async function publishSurvey() {
    if (isReadOnly || !survey || survey.status !== 'draft') return
    await navigate(async () => {
      setStatusChanging(true)
      try {
        const response = await fetch(`/api/teacher/surveys/${surveyId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to publish survey')
        if (currentSurveyIdRef.current !== surveyId) return
        setDetail((current) => current ? { ...current, survey: data.survey } : current)
        onSurveyUpdated(data.survey)
      } finally { setStatusChanging(false) }
    })
  }

  async function closeEditor() {
    if (surveyMarkdownDirty) {
      setError('Apply or undo Markdown edits before closing.')
      return
    }
    await navigate(onBack)
  }

  function selectQuestion(questionId: string | null) {
    setNumberDraft(String(questions.findIndex((question) => question.id === selectedQuestionId) + 1))
    void navigate(() => {
      setSelectedQuestionId(questionId)
      setEditingQuestionType(null)
      setQuestionStatus('saved')
      setSurveyEditMode('edit')
    })
  }

  useEffect(() => {
    onCloseReady?.(closeEditor)
    return () => onCloseReady?.(null)
  })

  if (loading || (detail !== null && !activeDetail)) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (!survey) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-danger">
        {error || 'Survey unavailable'}
      </div>
    )
  }

  const selectedIndex = selectedQuestion ? questions.indexOf(selectedQuestion) : -1
  const currentType = selectedQuestion ? editingQuestionType ?? selectedQuestion.question_type : newQuestionType
  const busy = navigationPending || surveyMarkdownSaving || addingQuestion || responseSettingSaving || statusChanging
  const metadataDisabled = isReadOnly || surveyEditMode === 'markdown' || busy
  const titleDirty = titleDraft !== getDisplayAssessmentTitle(survey.title, 'Untitled Survey')
  const newQuestionDirty = !selectedQuestion && Boolean(newQuestionText.trim() || newOptionsText.trim())
  const newQuestionValid = normalizeSurveyQuestionInput(buildQuestionSavePayload(newQuestionType, newQuestionText, newOptionsText, newResponseMaxChars)).valid
  const actionItems = [
    { id: 'add-mc', label: 'Add multiple-choice question', icon: <Plus className="h-4 w-4" aria-hidden="true" />, disabled: isReadOnly, onSelect: () => startQuestion('multiple_choice') },
    { id: 'add-open', label: 'Add open-response question', icon: <Plus className="h-4 w-4" aria-hidden="true" />, disabled: isReadOnly, onSelect: () => startQuestion('short_text') },
    { id: 'add-link', label: 'Add link question', icon: <Plus className="h-4 w-4" aria-hidden="true" />, disabled: isReadOnly, onSelect: () => startQuestion('link') },
    ...(['multiple_choice', 'short_text', 'link'] as const).map((type, index) => ({
      id: `type-${type}`, label: `Change to ${type === 'multiple_choice' ? 'multiple choice' : type === 'short_text' ? 'open response' : 'link'}`,
      dividerBefore: index === 0, checked: currentType === type, checkedRole: 'menuitemradio' as const, disabled: isReadOnly,
      onSelect: () => {
        if (selectedQuestion) questionEditorRef.current?.setType(type)
        else { setNewQuestionType(type); setNewResponseMaxChars(String(defaultMaxChars(type))) }
      },
    })),
    { id: 'duplicate', label: 'Duplicate question', icon: <Copy className="h-4 w-4" aria-hidden="true" />, dividerBefore: true, disabled: isReadOnly || !selectedQuestion, onSelect: duplicateQuestion },
    { id: 'delete', label: 'Delete question', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, destructive: true, disabled: isReadOnly || !selectedQuestion, onSelect: () => { void questionEditorRef.current?.delete() } },
  ]

  return (
    <div data-testid="survey-split-layout" className="grid h-full min-h-0 auto-rows-max grid-cols-1 overflow-y-auto lg:grid-cols-3 lg:grid-rows-1 lg:overflow-hidden">
      <div data-testid="survey-editor-details-pane" className="flex min-h-0 flex-col gap-3 bg-surface-2 p-3 sm:p-4 lg:overflow-y-auto">
        <FormField label="Title" required error={titleError} labelAccessory={(
          <div className="flex items-center gap-1">
            <SaveStatus status={titleError ? 'error' : titleSaving || busy ? 'saving' : titleDirty || newQuestionDirty ? 'unsaved' : questionStatus} className={!titleSaving && !busy && !titleDirty && !newQuestionDirty && questionStatus === 'saved' ? 'text-text-muted' : undefined} />
            <TeacherWorkSurfaceIconMenuButton icon={<Settings className="h-4 w-4" aria-hidden="true" />} ariaLabel="Settings" tooltip="Settings" variant="ghost" menuAriaLabel="Survey settings" menuPlacement="down" menuAlign="end" disabled={metadataDisabled} items={[
              { id: 'results', label: 'Show class results to students', checked: survey.show_results, checkedRole: 'menuitemcheckbox', onSelect: () => { void saveSetting('show_results', !survey.show_results) } },
              { id: 'dynamic', label: 'Allow students to update responses', checked: survey.dynamic_responses, checkedRole: 'menuitemcheckbox', onSelect: () => { void saveSetting('dynamic_responses', !survey.dynamic_responses) } },
              { id: 'delete', label: 'Delete survey', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, dividerBefore: true, destructive: true, onSelect: () => setDeleteConfirmOpen(true) },
            ]} />
            <Tooltip content="Close"><Button type="button" variant="ghost" size="sm" aria-label="Close survey editor" disabled={busy} onClick={() => { void closeEditor() }} className="h-11 w-11 p-0"><X className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
          </div>
        )}>
          <Input ref={titleInputRef} aria-label="Survey title" value={titleDraft} placeholder="Title" disabled={metadataDisabled || titleSaving} onChange={(event) => { setTitleDraft(event.target.value); setTitleError('') }} onBlur={() => { if (!metadataDisabled) void flushTitle() }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void flushTitle() } }} />
        </FormField>
        <div className="rounded-md border border-border bg-surface px-3 py-2"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">Questions</p><p className="text-xs text-text-muted">{questions.length} total</p></div></div>
        <Button type="button" variant={surveyEditMode === 'markdown' ? 'subtle' : 'surface'} size="sm" fullWidth aria-pressed={surveyEditMode === 'markdown'} disabled={busy} onClick={() => { void navigate(() => { setSurveyEditMode((current) => current === 'markdown' ? 'edit' : 'markdown'); setSurveyMarkdownError(''); setSurveyMarkdownInfo('') }) }} className="justify-start"><Code2 className="h-4 w-4" aria-hidden="true" />Markdown</Button>
        {error ? <p className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">{error}</p> : null}
        {surveyMarkdownDirty ? <p className="text-xs text-warning">Markdown edits not applied</p> : null}
        <div className="mt-1 shrink-0 lg:mt-auto">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={surveyEditMode === 'preview' ? 'subtle' : 'secondary'} size="sm" fullWidth disabled={busy || surveyEditMode === 'markdown'} aria-pressed={surveyEditMode === 'preview'} onClick={() => { void navigate(() => setSurveyEditMode((current) => current === 'preview' ? 'edit' : 'preview')) }}><Eye className="h-4 w-4" aria-hidden="true" />{surveyEditMode === 'preview' ? 'Back to editor' : 'Preview'}</Button>
            <Button type="button" size="sm" fullWidth disabled={metadataDisabled || survey.status !== 'draft' || questions.length === 0} onClick={() => { void publishSurvey() }}>{survey.status === 'draft' ? 'Publish' : getSurveyStatusLabel(survey.status)}</Button>
          </div>
        </div>
      </div>
      <div data-testid="survey-editor-content-pane" className="flex min-h-96 min-w-0 flex-col gap-3 p-3 sm:p-4 lg:col-span-2 lg:min-h-0 lg:overflow-y-auto">
        {surveyEditMode === 'markdown' ? (
          <Card tone="panel" padding="md" className="flex min-h-96 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-text-default">Survey Markdown</h3>
                <p className="text-sm text-text-muted">{questions.length} question{questions.length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {surveyMarkdownDirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Undo markdown edits"
                    title="Undo markdown edits"
                    onClick={handleUndoSurveyMarkdownChanges}
                    disabled={surveyMarkdownSaving}
                    className="h-11 w-11 p-0"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void applySurveyMarkdown()
                  }}
                  disabled={isReadOnly || surveyMarkdownSaving || !surveyMarkdownDirty}
                >
                  {surveyMarkdownSaving ? 'Applying...' : 'Apply Markdown'}
                </Button>
              </div>
            </div>

            {surveyMarkdownInfo ? (
              <div className="rounded-md border border-success bg-success-bg px-3 py-2 text-sm text-success">
                {surveyMarkdownInfo}
              </div>
            ) : null}
            {surveyMarkdownError ? (
              <div className="whitespace-pre-wrap rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                {surveyMarkdownError}
              </div>
            ) : null}

            <textarea
              data-testid="survey-markdown-editor"
              aria-label="Survey markdown editor"
              value={surveyMarkdown}
              onChange={(event) => handleSurveyMarkdownChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && surveyMarkdownDirty) {
                  event.preventDefault()
                  void applySurveyMarkdown()
                }
              }}
              readOnly={isReadOnly || surveyMarkdownSaving}
              className="min-h-80 flex-1 rounded-md border border-border bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2"
              spellCheck={false}
            />
          </Card>
        ) : surveyEditMode === 'preview' ? (
          <TeacherSurveyPreview survey={survey} questions={questions} />

        ) : (
          <>
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <p className="col-start-1 row-start-2 text-xs text-text-muted lg:row-start-1">{currentType === 'multiple_choice' ? 'Multiple choice' : currentType === 'short_text' ? 'Open response' : 'Link response'}</p>
              <div role="group" aria-label="Question navigation" className="col-span-2 col-start-1 row-start-1 flex items-center justify-self-center gap-1 lg:col-span-1 lg:col-start-2">
                <Tooltip content="Previous question"><Button type="button" variant="ghost" size="sm" aria-label="Previous question" disabled={busy || selectedIndex <= 0} onClick={() => selectQuestion(questions[selectedIndex - 1].id)} className="h-11 w-11 p-0 text-text-muted"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
                {selectedQuestion ? <Input type="number" min="1" max={questions.length} value={numberDraft} aria-label="Question number" disabled={busy} onChange={(event) => setNumberDraft(event.target.value)} onBlur={() => {
                  const requested = Number.parseInt(numberDraft, 10)
                  const index = Math.max(0, Math.min(questions.length - 1, Number.isFinite(requested) ? requested - 1 : selectedIndex))
                  if (index !== selectedIndex) selectQuestion(questions[index].id)
                  else setNumberDraft(String(selectedIndex + 1))
                }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} className="w-14 px-2 text-center" /> : <span className="px-2 text-sm font-medium">New question</span>}
                <span className="whitespace-nowrap text-xs text-text-muted">/ {questions.length}</span>
                <Tooltip content="Next question"><Button type="button" variant="ghost" size="sm" aria-label="Next question" disabled={busy || selectedIndex < 0 || selectedIndex === questions.length - 1} onClick={() => selectQuestion(questions[selectedIndex + 1].id)} className="h-11 w-11 p-0 text-text-muted"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
              </div>
              <div className="col-start-2 row-start-2 justify-self-end lg:col-start-3 lg:row-start-1"><TeacherWorkSurfaceIconMenuButton icon={<ListPlus className="h-5 w-5" aria-hidden="true" />} ariaLabel="Question actions" tooltip="Question actions" menuAriaLabel="Question actions" variant="primary" menuPlacement="down" menuAlign="end" disabled={isReadOnly || busy || questionStatus === 'saving'} className="h-11 w-14 shadow-sm" items={actionItems} /></div>
            </div>
            {selectedQuestion ? (
              <QuestionEditor key={selectedQuestion.id} ref={questionEditorRef} question={selectedQuestion} disabled={isReadOnly} interactionDisabled={navigationPending} onStatusChange={setQuestionStatus} onTypeChange={setEditingQuestionType} onSaved={(updatedQuestion) => {
                setDetail((current) => current?.survey.id === updatedQuestion.survey_id ? { ...current, questions: current.questions.map((item) => item.id === updatedQuestion.id ? updatedQuestion : item) } : current)
              }} onDeleted={(questionId) => {
                const remaining = questions.filter((question) => question.id !== questionId)
                setDetail((current) => current ? { ...current, questions: remaining } : current)
                setSelectedQuestionId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? null)
                setQuestionStatus('saved')
                setEditingQuestionType(null)
                onQuestionCountChanged?.(surveyId, remaining.length)
              }} />
            ) : (
              <>
                <SurveyQuestionFields questionType={newQuestionType} questionText={newQuestionText} optionsText={newOptionsText} responseMaxChars={newResponseMaxChars} disabled={isReadOnly || busy} promptLabel="New question" onTextChange={setNewQuestionText} onOptionsChange={setNewOptionsText} onLimitChange={setNewResponseMaxChars} />
                <div className="flex justify-end"><Button type="button" size="sm" onClick={() => { void addQuestion() }} disabled={isReadOnly || busy || !newQuestionValid}><Plus className="h-4 w-4" aria-hidden="true" />{addingQuestion ? 'Adding...' : 'Add question'}</Button></div>
              </>
            )}
          </>
        )}
      </div>
      <ConfirmDialog isOpen={deleteConfirmOpen} title="Delete survey?" description={`${survey.title}\n\nThis cannot be undone.`} confirmLabel={statusChanging ? 'Deleting...' : 'Delete'} cancelLabel="Cancel" confirmVariant="danger" isConfirmDisabled={statusChanging} isCancelDisabled={statusChanging} onCancel={() => (statusChanging ? null : setDeleteConfirmOpen(false))} onConfirm={() => { void deleteSurvey() }} />
    </div>
  )
}
