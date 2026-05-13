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
import { ArrowLeft, BarChart3, Code, ExternalLink, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button, Card, ConfirmDialog, FormField, Input, Select } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { Spinner } from '@/components/Spinner'
import { SurveyModal } from '@/components/surveys/SurveyModal'
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

  useEffect(() => {
    setQuestionType(question.question_type)
    setQuestionText(question.question_text)
    setOptionsText(question.options.join('\n'))
    setResponseMaxChars(String(question.response_max_chars))
    setError('')
  }, [question])

  async function saveQuestion() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${question.survey_id}/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_type: questionType,
          question_text: questionText,
          options: questionType === 'multiple_choice' ? optionsText.split('\n') : [],
          response_max_chars: Number(responseMaxChars) || defaultMaxChars(questionType),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save question')
      onSaved(data.question)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save question')
    } finally {
      setSaving(false)
    }
  }

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
      <div className="grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
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
          />
        </FormField>
        <FormField label="Prompt" error={error}>
          <Input
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            disabled={disabled || saving}
          />
        </FormField>
      </div>

      {questionType === 'multiple_choice' ? (
        <FormField label="Options">
          <SurveyTextarea
            value={optionsText}
            onChange={(event) => setOptionsText(event.target.value)}
            disabled={disabled || saving}
            rows={4}
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2"
          />
        </FormField>
      ) : (
        <FormField label="Max characters">
          <Input
            type="number"
            min={1}
            max={5000}
            value={responseMaxChars}
            onChange={(event) => setResponseMaxChars(event.target.value)}
            disabled={disabled || saving}
          />
        </FormField>
      )}

      <div className="flex flex-wrap justify-end gap-2">
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
        <Button type="button" size="sm" onClick={saveQuestion} disabled={disabled || saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </Card>
  )
}

function ResultsView({ payload }: { payload: SurveyResultsPayload | null }) {
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
      <div className="text-sm text-text-muted">
        {payload.stats.responded} of {payload.stats.total_students} students responded
      </div>
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
                const percent = result.total_responses > 0 ? (count / result.total_responses) * 100 : 0
                return (
                  <div key={optionIndex} className="space-y-0.5">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="min-w-0 text-text-default">{option}</span>
                      <span className="shrink-0 text-text-muted">{count} ({percent.toFixed(0)}%)</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
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
  classroomId,
  surveyId,
  isReadOnly = false,
  onBack,
  onSurveyUpdated,
  onSurveyDeleted,
}: TeacherSurveyWorkspaceProps) {
  const [detail, setDetail] = useState<SurveyDetailPayload | null>(null)
  const [results, setResults] = useState<SurveyResultsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newQuestionType, setNewQuestionType] = useState<SurveyQuestionType>('multiple_choice')
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newOptionsText, setNewOptionsText] = useState('Option 1\nOption 2')
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [surveyEditMode, setSurveyEditMode] = useState<'edit' | 'markdown'>('edit')
  const [surveyMarkdown, setSurveyMarkdown] = useState('')
  const [surveyMarkdownDirty, setSurveyMarkdownDirty] = useState(false)
  const [surveyMarkdownSaving, setSurveyMarkdownSaving] = useState(false)
  const [surveyMarkdownError, setSurveyMarkdownError] = useState('')
  const [surveyMarkdownInfo, setSurveyMarkdownInfo] = useState('')
  const onSurveyUpdatedRef = useRef(onSurveyUpdated)

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

  const loadResults = useCallback(async () => {
    try {
      const response = await fetch(`/api/teacher/surveys/${surveyId}/results`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load survey results')
      setResults(data)
    } catch (err) {
      console.error('Error loading survey results:', err)
      setResults({ results: [], stats: { responded: 0, total_students: 0 } })
    }
  }, [surveyId])

  useEffect(() => {
    void loadSurvey()
    void loadResults()
  }, [loadResults, loadSurvey])

  useEffect(() => {
    if (!survey) return
    if (surveyMarkdownDirty) return
    if (surveyMarkdown !== currentSurveyMarkdown) {
      setSurveyMarkdown(currentSurveyMarkdown)
    }
  }, [currentSurveyMarkdown, survey, surveyMarkdown, surveyMarkdownDirty])

  const canOpen = useMemo(() => survey?.status === 'draft' && questions.length > 0, [questions.length, survey?.status])

  async function patchSurvey(update: Record<string, unknown>) {
    setStatusChanging(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${surveyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update survey')
      setDetail((current) => current ? { ...current, survey: data.survey } : current)
      onSurveyUpdated(data.survey)
      void loadResults()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update survey')
    } finally {
      setStatusChanging(false)
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
      await loadResults()

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
            <div className="min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-text-muted hover:text-text-default"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Classwork
              </button>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="min-w-0 text-xl font-semibold text-text-default">{survey.title}</h2>
                <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${statusClassName}`}>
                  {getSurveyStatusLabel(survey.status)}
                </span>
                {survey.dynamic_responses && (
                  <span className="rounded-badge bg-info-bg px-2.5 py-1 text-xs font-semibold text-primary">
                    Dynamic
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
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
              <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
                <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
                Settings
              </Button>
              {survey.status === 'draft' ? (
                <Button
                  size="sm"
                  onClick={() => patchSurvey({ status: 'active' })}
                  disabled={isReadOnly || statusChanging || !canOpen}
                >
                  Open
                </Button>
              ) : survey.status === 'active' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => patchSurvey({ status: 'closed' })}
                  disabled={isReadOnly || statusChanging}
                >
                  Close
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => patchSurvey({ status: 'active' })}
                  disabled={isReadOnly || statusChanging}
                >
                  Reopen
                </Button>
              )}
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
                        void loadResults()
                      }}
                    />
                  ))
                )}
              </div>
            </Card>

            <Card tone="panel" padding="md" className="space-y-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-text-muted" aria-hidden="true" />
                <h3 className="text-base font-semibold text-text-default">Results</h3>
              </div>
              <ResultsView payload={results} />
            </Card>
          </>
        )}
      </div>

      <SurveyModal
        isOpen={settingsOpen}
        classroomId={classroomId}
        survey={survey}
        onClose={() => setSettingsOpen(false)}
        onSuccess={(updatedSurvey) => {
          setDetail((current) => current ? { ...current, survey: updatedSurvey } : current)
          onSurveyUpdated(updatedSurvey)
        }}
      />

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
