'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react'
import { Code, ExternalLink, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button, Card, ConfirmDialog, FormField, Input, Select } from '@/ui'
import { AssessmentSetupCheckbox } from '@/components/assessment/AssessmentSetupForm'
import { EditableAssessmentTitle } from '@/components/assessment/EditableAssessmentTitle'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { Spinner } from '@/components/Spinner'
import { SurveyOptionResultBar } from '@/components/surveys/SurveyOptionResultBar'
import { isGeneratedAssessmentTitle } from '@/lib/assessment-titles'
import {
  DEFAULT_SURVEY_LINK_MAX_CHARS,
  DEFAULT_SURVEY_TEXT_MAX_CHARS,
  getSurveyStatusBadgeClass,
  getSurveyStatusLabel,
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
  onBack: () => void
  onSurveyUpdated: (survey: Survey) => void
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

const QUESTION_TYPE_OPTIONS = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'short_text', label: 'Short text' },
  { value: 'link', label: 'Link' },
]

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
    options: questionType === 'multiple_choice' ? optionsText.split('\n') : [],
    response_max_chars: Number(responseMaxChars) || defaultMaxChars(questionType),
  }
}

function QuestionEditor({
  question,
  disabled,
  onSaved,
  onDeleted,
}: {
  question: SurveyQuestion
  disabled: boolean
  onSaved: (question: SurveyQuestion) => void
  onDeleted: (questionId: string) => void
}) {
  const [questionType, setQuestionType] = useState<SurveyQuestionType>(question.question_type)
  const [questionText, setQuestionText] = useState(question.question_text)
  const [optionsText, setOptionsText] = useState(question.options.join('\n'))
  const [responseMaxChars, setResponseMaxChars] = useState(String(question.response_max_chars))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lastSavedPayloadRef = useRef('')
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
    } catch (err) {
      lastAttemptedPayloadRef.current = lastSavedPayloadRef.current
      setError(err instanceof Error ? err.message : 'Failed to save question')
    } finally {
      setSaving(false)
    }
  }, [onSaved, question.id, question.survey_id])

  const saveCurrentQuestion = useCallback(() => {
    if (disabled || saving) return

    const payload = buildQuestionSavePayload(questionType, questionText, optionsText, responseMaxChars)
    const payloadKey = JSON.stringify(payload)
    if (
      payloadKey === lastSavedPayloadRef.current ||
      payloadKey === lastAttemptedPayloadRef.current
    ) {
      return
    }

    void saveQuestion(payload, payloadKey)
  }, [disabled, optionsText, questionText, questionType, responseMaxChars, saveQuestion, saving])

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
      setSaving(false)
    }
  }

  return (
    <Card tone="panel" padding="md" className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)_auto] lg:items-start">
        <FormField label="Type">
          <Select
            value={questionType}
            onChange={(event) => {
              const nextType = event.target.value as SurveyQuestionType
              setQuestionType(nextType)
              setResponseMaxChars(String(defaultMaxChars(nextType)))
            }}
            options={QUESTION_TYPE_OPTIONS}
            disabled={disabled || saving}
            onBlur={saveCurrentQuestion}
          />
        </FormField>
        <FormField label="Prompt" error={error}>
          <Input
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            onBlur={saveCurrentQuestion}
            disabled={disabled || saving}
          />
        </FormField>
        <div className="flex items-end lg:pt-6">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-danger hover:bg-danger-bg"
            onClick={deleteQuestion}
            disabled={disabled || saving}
          >
            <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      {questionType === 'multiple_choice' && (
        <FormField label="Options">
          <SurveyTextarea
            value={optionsText}
            onChange={(event) => setOptionsText(event.target.value)}
            onBlur={saveCurrentQuestion}
            disabled={disabled || saving}
            rows={4}
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2"
          />
        </FormField>
      )}
    </Card>
  )
}

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

export function TeacherSurveyWorkspace({
  surveyId,
  isReadOnly = false,
  initialEditMode,
  autoEditTitle = false,
  onInitialEditModeConsumed,
  onBack,
  onSurveyUpdated,
  onSurveyDeleted,
}: TeacherSurveyWorkspaceProps) {
  const [detail, setDetail] = useState<SurveyDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newQuestionType, setNewQuestionType] = useState<SurveyQuestionType>('multiple_choice')
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newOptionsText, setNewOptionsText] = useState('Option 1\nOption 2')
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [titleSaving, setTitleSaving] = useState(false)
  const [responseSettingSaving, setResponseSettingSaving] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [surveyEditMode, setSurveyEditMode] = useState<'edit' | 'markdown'>('edit')
  const [surveyMarkdown, setSurveyMarkdown] = useState('')
  const [surveyMarkdownDirty, setSurveyMarkdownDirty] = useState(false)
  const [surveyMarkdownSaving, setSurveyMarkdownSaving] = useState(false)
  const [surveyMarkdownError, setSurveyMarkdownError] = useState('')
  const [surveyMarkdownInfo, setSurveyMarkdownInfo] = useState('')
  const onSurveyUpdatedRef = useRef(onSurveyUpdated)
  const consumedInitialEditModeRef = useRef<string | null>(null)

  useEffect(() => {
    onSurveyUpdatedRef.current = onSurveyUpdated
  }, [onSurveyUpdated])

  const survey = detail?.survey ?? null
  const questions = useMemo(() => detail?.questions ?? [], [detail?.questions])
  const statusClassName = survey ? getSurveyStatusBadgeClass(survey.status) : ''
  const currentSurveyMarkdown = useMemo(
    () => (survey ? surveyToMarkdown({ survey, questions }) : ''),
    [questions, survey],
  )

  const loadSurvey = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${surveyId}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load survey')
      setDetail({ survey: data.survey, questions: data.questions || [] })
      onSurveyUpdatedRef.current(data.survey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load survey')
      setDetail(null)
    } finally {
      setLoading(false)
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
    if (!survey) return

    const cleanTitle = title.trim()
    if (
      !cleanTitle ||
      ((cleanTitle === 'Untitled' || cleanTitle === 'Untitled Survey') &&
        isGeneratedAssessmentTitle(survey.title))
    ) {
      setTitleError('')
      return
    }

    if (cleanTitle === survey.title) {
      setTitleError('')
      return
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
      setDetail((current) => current ? { ...current, survey: data.survey } : current)
      onSurveyUpdated(data.survey)
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : 'Failed to update survey title')
    } finally {
      setTitleSaving(false)
    }
  }

  async function saveResponseEditing(nextDynamicResponses: boolean) {
    if (!survey || nextDynamicResponses === survey.dynamic_responses) return

    setResponseSettingSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${surveyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dynamic_responses: nextDynamicResponses }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update survey')
      setDetail((current) => current ? { ...current, survey: data.survey } : current)
      onSurveyUpdated(data.survey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update survey')
    } finally {
      setResponseSettingSaving(false)
    }
  }

  async function addQuestion() {
    setAddingQuestion(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${surveyId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_type: newQuestionType,
          question_text: newQuestionText,
          options: newQuestionType === 'multiple_choice' ? newOptionsText.split('\n') : [],
          response_max_chars: defaultMaxChars(newQuestionType),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to add question')
      setDetail((current) =>
        current
          ? { ...current, questions: [...current.questions, data.question] }
          : current
      )
      setNewQuestionText('')
      setNewOptionsText('Option 1\nOption 2')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add question')
    } finally {
      setAddingQuestion(false)
    }
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

      const nextMarkdown = surveyToMarkdown({ survey: nextSurvey, questions: nextQuestions })
      setSurveyMarkdown(nextMarkdown)
      setSurveyMarkdownDirty(false)
      setSurveyMarkdownInfo('Markdown applied')
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

  if (loading) {
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

  return (
    <div className="h-full min-h-0 overflow-auto p-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Card tone="panel" padding="md" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <EditableAssessmentTitle
              title={survey.title}
              inputLabel="Survey title"
              editLabel="Edit survey title"
              disabled={isReadOnly || titleSaving}
              saving={titleSaving}
              error={titleError}
              generatedTitleLabel="Untitled Survey"
              autoEdit={autoEditTitle}
              onSave={saveTitle}
              trailing={
                <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${statusClassName}`}>
                  {getSurveyStatusLabel(survey.status)}
                </span>
              }
            />

            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <AssessmentSetupCheckbox
                checked={survey.dynamic_responses}
                disabled={isReadOnly || responseSettingSaving}
                onChange={(checked) => {
                  void saveResponseEditing(checked)
                }}
              >
                Allow live changes
              </AssessmentSetupCheckbox>
              <Button
                size="sm"
                variant={surveyEditMode === 'markdown' ? 'subtle' : 'secondary'}
                aria-pressed={surveyEditMode === 'markdown'}
                onClick={() => {
                  setSurveyEditMode((current) => (current === 'markdown' ? 'edit' : 'markdown'))
                  setSurveyMarkdownError('')
                  setSurveyMarkdownInfo('')
                }}
              >
                <Code className="mr-1 h-4 w-4" aria-hidden="true" />
                Code
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:bg-danger-bg"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={isReadOnly || statusChanging}
              >
                <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          {surveyMarkdownDirty && surveyEditMode === 'markdown' ? (
            <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              Markdown edits not applied
            </div>
          ) : null}
        </Card>

        {surveyEditMode === 'markdown' ? (
          <Card tone="panel" padding="md" className="flex min-h-[560px] flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-text-default">Code</h3>
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
                    className="h-8 w-8 p-0"
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
              value={surveyMarkdown}
              onChange={(event) => handleSurveyMarkdownChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && surveyMarkdownDirty) {
                  event.preventDefault()
                  void applySurveyMarkdown()
                }
              }}
              readOnly={isReadOnly || surveyMarkdownSaving}
              className="min-h-[460px] flex-1 rounded-md border border-border bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2"
              spellCheck={false}
            />
          </Card>
        ) : (
          <>
            <Card tone="panel" padding="md" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-text-default">Questions</h3>
                <span className="text-sm text-text-muted">{questions.length} total</span>
              </div>

              <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
                <FormField label="Type">
                  <Select
                    value={newQuestionType}
                    onChange={(event) => setNewQuestionType(event.target.value as SurveyQuestionType)}
                    options={QUESTION_TYPE_OPTIONS}
                    disabled={isReadOnly || addingQuestion}
                  />
                </FormField>
                <FormField label="New question">
                  <Input
                    value={newQuestionText}
                    onChange={(event) => setNewQuestionText(event.target.value)}
                    placeholder="Ask students a question"
                    disabled={isReadOnly || addingQuestion}
                  />
                </FormField>
                {newQuestionType === 'multiple_choice' && (
                  <div className="lg:col-span-2">
                    <FormField label="Options">
                      <SurveyTextarea
                        value={newOptionsText}
                        onChange={(event) => setNewOptionsText(event.target.value)}
                        rows={3}
                        disabled={isReadOnly || addingQuestion}
                        className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2"
                      />
                    </FormField>
                  </div>
                )}
                <div className="lg:col-span-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={addQuestion}
                    disabled={isReadOnly || addingQuestion || !newQuestionText.trim()}
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                    {addingQuestion ? 'Adding...' : 'Add question'}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {questions.length === 0 ? (
                  <p className="rounded-lg border border-border bg-surface px-3 py-4 text-center text-sm text-text-muted">
                    Add at least one question before opening the survey.
                  </p>
                ) : (
                  questions.map((question) => (
                    <QuestionEditor
                      key={question.id}
                      question={question}
                      disabled={isReadOnly}
                      onSaved={(updatedQuestion) => {
                        setDetail((current) =>
                          current
                            ? {
                                ...current,
                                questions: current.questions.map((item) =>
                                  item.id === updatedQuestion.id ? updatedQuestion : item
                                ),
                              }
                            : current
                        )
                      }}
                      onDeleted={(questionId) => {
                        setDetail((current) =>
                          current
                            ? {
                                ...current,
                                questions: current.questions.filter((item) => item.id !== questionId),
                              }
                            : current
                        )
                      }}
                    />
                  ))
                )}
              </div>
            </Card>

          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete survey?"
        description={`${survey.title}\n\nThis cannot be undone.`}
        confirmLabel={statusChanging ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={statusChanging}
        isCancelDisabled={statusChanging}
        onCancel={() => (statusChanging ? null : setDeleteConfirmOpen(false))}
        onConfirm={() => {
          void deleteSurvey()
        }}
      />
    </div>
  )
}
