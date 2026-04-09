'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button, RefreshingIndicator, SplitButton, Tooltip } from '@/ui'
import { RichTextViewer } from '@/components/editor'
import { HistoryList } from '@/components/HistoryList'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { formatInTimeZone } from 'date-fns-tz'
import { TEACHER_GRADE_UPDATED_EVENT, type TeacherGradeUpdatedEventDetail } from '@/lib/events'
import type {
  Assignment,
  AssignmentDoc,
  AssignmentDocHistoryEntry,
  AssignmentFeedbackEntry,
  AssignmentRepoReviewResult,
  AssignmentRepoTarget,
  AssignmentRepoTargetSelectionMode,
  AssignmentRepoTargetValidationStatus,
  AssignmentStatus,
  AuthenticityFlag,
  TiptapContent,
} from '@/types'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { readCookie, writeCookie } from '@/lib/cookies'

function AuthenticityGauge({ score, flags }: { score: number | null; flags: AuthenticityFlag[] }) {
  const hasScore = score !== null
  const displayScore = score ?? 0
  const color = !hasScore ? 'bg-gray-300' : displayScore >= 70 ? 'bg-green-500' : displayScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  const textColor = !hasScore ? 'text-text-muted' : displayScore >= 70 ? 'text-green-700' : displayScore >= 40 ? 'text-yellow-700' : 'text-red-700'

  const bar = (
    <div className="relative h-5 rounded-full bg-gray-200 overflow-hidden">
      {hasScore && (
        <div className={`h-full rounded-full ${color}`} style={{ width: `${displayScore}%` }} />
      )}
      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${hasScore ? textColor : 'text-text-muted'}`}>
        Authenticity {hasScore ? `${displayScore}%` : '—'}
      </span>
    </div>
  )

  if (flags.length === 0) return bar

  return (
    <Tooltip
      content={
        <div className="space-y-1 py-0.5">
          {flags.map((flag, i) => (
            <div key={i}>
              {flag.reason === 'paste'
                ? `${flag.wordDelta} words pasted`
                : `${flag.wordDelta} words in ${flag.seconds}s (${Math.round(flag.wps * 60)} wpm)`}
            </div>
          ))}
        </div>
      }
    >
      <div>{bar}</div>
    </Tooltip>
  )
}

function RepoMetricBar({ label, value }: { label: string; value: number }) {
  const percentage = Math.max(0, Math.min(100, Math.round(value * 100)))

  return (
    <div className="relative h-6 overflow-hidden rounded-full border border-border bg-surface-2">
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width]" style={{ width: `${percentage}%` }} />
      <div className="absolute inset-0 z-10 flex items-center justify-between px-3 text-[10px] font-semibold leading-none">
        <span className="text-text-default">{label}</span>
        <span className="text-text-default">{percentage}%</span>
      </div>
    </div>
  )
}

function ScoreInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const quickScores = Array.from({ length: 11 }, (_, i) => i)
  const n = Number(value)
  const selected = Number.isInteger(n) && n >= 0 && n <= 10 ? n : null

  function handleInputChange(next: string) {
    onChange(next)
  }

  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_2.25rem] items-center gap-x-1.5">
      <label
        className={[
          'whitespace-nowrap text-[11px] font-medium text-text-muted',
          label === 'Completion' ? 'pr-2' : 'pr-1',
        ].join(' ')}
      >
        {label}
      </label>
      <div className="flex min-w-0 items-center justify-start gap-0">
        {quickScores.map((score) => {
          const isActive = selected === score
          return (
            <Tooltip key={score} content={score} delayDuration={0} side="top">
              <button
                type="button"
                onClick={() => onChange(String(score))}
                className={[
                  'inline-flex h-6 w-[clamp(0.5rem,calc(100%/11),1.5rem)] flex-none items-center justify-center rounded border px-0 text-[10px] font-semibold leading-none transition-colors',
                  isActive
                    ? 'border-primary bg-primary text-text-inverse'
                    : 'border-border bg-surface text-text-default hover:bg-surface-hover',
                ].join(' ')}
                aria-label={`Set ${label} score to ${score}`}
                aria-pressed={isActive}
              >
                {''}
              </button>
            </Tooltip>
          )
        })}
      </div>
      <input
        type="number"
        min={0}
        max={10}
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        className="h-6 w-9 justify-self-end rounded border border-border bg-surface px-1 py-0.5 text-xs font-medium text-text-default text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label={`${label} score`}
      />
    </div>
  )
}

interface StudentWorkData {
  assignment: Assignment
  classroom: { id: string; title: string }
  student: { id: string; email: string; name: string | null }
  doc: AssignmentDoc | null
  status: AssignmentStatus
  feedback_entries: AssignmentFeedbackEntry[]
  repo_target: {
    target: AssignmentRepoTarget | null
    submittedRepoUrl: string | null
    submittedGitHubUsername: string | null
    effectiveRepoUrl: string | null
    effectiveGitHubUsername: string | null
    repoOwner: string | null
    repoName: string | null
    selectionMode: AssignmentRepoTargetSelectionMode
    validationStatus: AssignmentRepoTargetValidationStatus
    validationMessage: string | null
    latest_result: AssignmentRepoReviewResult | null
  }
}

interface TeacherStudentWorkPanelProps {
  classroomId: string
  assignmentId: string
  studentId: string
}

type RightTab = 'history' | 'grading'
type GradeSaveMode = 'draft' | 'graded'
const RIGHT_TAB_COOKIE_PREFIX = 'pika_teacher_student_work_tab'

function getRightTabCookieName(classroomId: string) {
  return `${RIGHT_TAB_COOKIE_PREFIX}:${classroomId}`
}

export function TeacherStudentWorkPanel({
  classroomId,
  assignmentId,
  studentId,
}: TeacherStudentWorkPanelProps) {
  const [data, setData] = useState<StudentWorkData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // History state
  const [historyEntries, setHistoryEntries] = useState<AssignmentDocHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [previewEntry, setPreviewEntry] = useState<AssignmentDocHistoryEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<TiptapContent | null>(null)
  const [lockedEntryId, setLockedEntryId] = useState<string | null>(null)
  const rightTabCookieName = getRightTabCookieName(classroomId)

  // Grading state
  const [rightTab, setRightTab] = useState<RightTab>(() => (
    readCookie(getRightTabCookieName(classroomId)) === 'grading' ? 'grading' : 'history'
  ))
  const [scoreCompletion, setScoreCompletion] = useState<string>('')
  const [scoreThinking, setScoreThinking] = useState<string>('')
  const [scoreWorkflow, setScoreWorkflow] = useState<string>('')
  const [feedbackDraft, setFeedbackDraft] = useState<string>('')
  const [gradeSaving, setGradeSaving] = useState(false)
  const [gradeError, setGradeError] = useState('')
  const [autoGrading, setAutoGrading] = useState(false)
  const [feedbackReturning, setFeedbackReturning] = useState(false)
  const [repoAnalyzing, setRepoAnalyzing] = useState(false)
  const showInitialSpinner = useDelayedBusy(loading && !data)

  function dispatchGradeUpdated(doc: AssignmentDoc | null) {
    const detail: TeacherGradeUpdatedEventDetail = {
      assignmentId,
      studentId,
      doc,
    }
    window.dispatchEvent(new CustomEvent<TeacherGradeUpdatedEventDetail>(TEACHER_GRADE_UPDATED_EVENT, { detail }))
  }

  function handleRightTabChange(nextTab: RightTab) {
    setRightTab(nextTab)
    writeCookie(rightTabCookieName, nextTab)
  }

  function updatePreview(entry: AssignmentDocHistoryEntry): boolean {
    const oldestFirst = [...historyEntries].reverse()
    const reconstructed = reconstructAssignmentDocContent(oldestFirst, entry.id)

    if (reconstructed) {
      setPreviewEntry(entry)
      setPreviewContent(reconstructed)
      return true
    }
    return false
  }

  function handlePreviewHover(entry: AssignmentDocHistoryEntry) {
    if (lockedEntryId) return
    updatePreview(entry)
  }

  function handlePreviewLock(entry: AssignmentDocHistoryEntry) {
    const success = updatePreview(entry)
    if (success) {
      setLockedEntryId(entry.id)
    }
  }

  function handleExitPreview() {
    setPreviewEntry(null)
    setPreviewContent(null)
    setLockedEntryId(null)
  }

  function handleHistoryMouseLeave() {
    if (lockedEntryId) return
    handleExitPreview()
  }

  function populateGradeForm(doc: AssignmentDoc | null) {
    if (doc) {
      setScoreCompletion(doc.score_completion?.toString() ?? '')
      setScoreThinking(doc.score_thinking?.toString() ?? '')
      setScoreWorkflow(doc.score_workflow?.toString() ?? '')
      setFeedbackDraft(doc.teacher_feedback_draft ?? doc.feedback ?? '')
    } else {
      setScoreCompletion('')
      setScoreThinking('')
      setScoreWorkflow('')
      setFeedbackDraft('')
    }
  }

  function populateRepoForm(nextData: StudentWorkData) {
    void nextData
  }

  const loadStudentWork = useCallback(async (): Promise<StudentWorkData | null> => {
    setLoading(true)
    setError('')
    setGradeError('')
    handleExitPreview()
    try {
      const response = await fetch(`/api/teacher/assignments/${assignmentId}/students/${studentId}`)
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load student work')
      }
      setData(result)
      populateGradeForm(result.doc)
      populateRepoForm(result)
      return result
    } catch (err: any) {
      setError(err.message || 'Failed to load student work')
      return null
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, studentId])

  // Load student work
  useEffect(() => {
    void loadStudentWork()
  }, [loadStudentWork])

  // Load history
  useEffect(() => {
    setHistoryLoading(true)
    setHistoryError('')

    async function loadHistory() {
      try {
        const response = await fetch(
          `/api/assignment-docs/${assignmentId}/history?student_id=${studentId}`
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load history')
        }
        setHistoryEntries(result.history || [])
      } catch (err: any) {
        setHistoryError(err.message || 'Failed to load history')
      } finally {
        setHistoryLoading(false)
      }
    }

    loadHistory()
  }, [assignmentId, studentId])

  async function handleSaveGrade(selectedSaveMode: GradeSaveMode) {
    if (!data) return
    const sc = Number(scoreCompletion)
    const st = Number(scoreThinking)
    const sw = Number(scoreWorkflow)

    if ([sc, st, sw].some((n) => !Number.isInteger(n) || n < 0 || n > 10)) {
      setGradeError('Scores must be integers 0–10')
      return
    }

    setGradeSaving(true)
    setGradeError('')
    const previousDoc = data.doc
    const optimisticDoc: AssignmentDoc = {
      ...(previousDoc || {
        id: '',
        assignment_id: assignmentId,
        student_id: studentId,
        content: { type: 'doc', content: [] },
        repo_url: null,
        github_username: null,
        is_submitted: false,
        submitted_at: null,
        viewed_at: null,
        score_completion: null,
        score_thinking: null,
        score_workflow: null,
        feedback: null,
        teacher_feedback_draft: null,
        teacher_feedback_draft_updated_at: null,
        feedback_returned_at: null,
        ai_feedback_suggestion: null,
        ai_feedback_suggested_at: null,
        ai_feedback_model: null,
        teacher_cleared_at: null,
        graded_at: null,
        graded_by: null,
        returned_at: null,
        authenticity_score: null,
        authenticity_flags: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      score_completion: sc,
      score_thinking: st,
      score_workflow: sw,
      teacher_feedback_draft: feedbackDraft,
      teacher_feedback_draft_updated_at: new Date().toISOString(),
      graded_at: selectedSaveMode === 'graded'
        ? (previousDoc?.graded_at || new Date().toISOString())
        : null,
      graded_by: selectedSaveMode === 'graded'
        ? (previousDoc?.graded_by || 'teacher')
        : null,
      updated_at: new Date().toISOString(),
    }
    setData((prev) => (prev ? { ...prev, doc: optimisticDoc } : prev))
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          score_completion: sc,
          score_thinking: st,
          score_workflow: sw,
          feedback: feedbackDraft,
          save_mode: selectedSaveMode,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save grade')
      // Update local state
      setData((prev) => prev ? { ...prev, doc: result.doc } : prev)
      dispatchGradeUpdated(result.doc)
    } catch (err: any) {
      setData((prev) => (prev ? { ...prev, doc: previousDoc } : prev))
      setGradeError(err.message || 'Failed to save grade')
    } finally {
      setGradeSaving(false)
    }
  }

  async function handleAutoGrade() {
    if (!data) return
    setAutoGrading(true)
    setGradeError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}/auto-grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [studentId] }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Auto-grade failed')
      if (result.errors?.length) {
        setGradeError(result.errors.join(', '))
        return // Don't reload — grading failed
      }
      if (result.graded_count === 0) {
        setGradeError('No gradable content found — the submission may be empty')
        return
      }
      const refreshed = await loadStudentWork()
      handleRightTabChange('grading')
      dispatchGradeUpdated(refreshed?.doc ?? null)
    } catch (err: any) {
      setGradeError(err.message || 'Auto-grade failed')
    } finally {
      setAutoGrading(false)
    }
  }

  async function handleReturnFeedback() {
    if (!data) return
    const trimmed = feedbackDraft.trim()
    if (!trimmed) {
      setGradeError('Feedback draft is required before returning feedback')
      return
    }

    setFeedbackReturning(true)
    setGradeError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}/feedback-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          feedback: trimmed,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to return feedback')

      setData((prev) => prev ? {
        ...prev,
        doc: result.doc,
        feedback_entries: [...prev.feedback_entries, result.entry],
      } : prev)
      populateGradeForm(result.doc)
      dispatchGradeUpdated(result.doc)
    } catch (err: any) {
      setGradeError(err.message || 'Failed to return feedback')
    } finally {
      setFeedbackReturning(false)
    }
  }

  async function handleAnalyzeRepo() {
    if (!data) return
    setRepoAnalyzing(true)
    setGradeError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}/artifact-repo/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [studentId] }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Repo analysis failed')
      const refreshed = await loadStudentWork()
      dispatchGradeUpdated(refreshed?.doc ?? null)
      if ((result.analyzed_students ?? 0) === 0 && result.skipped_reasons) {
        const message = Object.entries(result.skipped_reasons as Record<string, number>)
          .map(([reason, count]) => `${count} ${reason}`)
          .join(' ')
        if (message) {
          setGradeError(message)
        }
      }
    } catch (err: any) {
      setGradeError(err.message || 'Repo analysis failed')
    } finally {
      setRepoAnalyzing(false)
    }
  }

  if (showInitialSpinner) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-danger">{error}</div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 text-sm text-text-muted">No data</div>
    )
  }

  const isPreviewLocked = lockedEntryId !== null
  const displayContent = previewContent || data.doc?.content
  const repoReviewResult = data.repo_target?.latest_result || null
  const feedbackEntries = data.feedback_entries || []
  const repoDisplayUrl =
    data.repo_target.submittedRepoUrl ||
    data.repo_target.effectiveRepoUrl ||
    data.repo_target.target?.selected_repo_url ||
    ''
  const repoDisplayGitHubUsername =
    data.repo_target.submittedGitHubUsername ||
    data.repo_target.effectiveGitHubUsername ||
    repoReviewResult?.github_login ||
    ''

  const sc = Number(scoreCompletion) || 0
  const st = Number(scoreThinking) || 0
  const sw = Number(scoreWorkflow) || 0
  const totalScore = sc + st + sw
  const totalPercent = Math.round((totalScore / 30) * 100)

  return (
    <div className="flex flex-col h-full">
      {loading && (
        <RefreshingIndicator />
      )}
      {/* Main content area: Student work + Right panel side by side */}
      <div className="flex-1 min-h-0 flex">
        {/* Student work content */}
        <div
          className={`flex-1 min-h-0 overflow-auto ${
            previewEntry
              ? 'outline outline-2 outline-primary outline-offset-[-2px]'
              : ''
          }`}
        >
          {(repoDisplayUrl || repoDisplayGitHubUsername) && (
            <div className="border-b border-border bg-surface px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="truncate text-sm font-medium text-text-default">
                  <span className="text-text-muted">Repo </span>
                  {repoDisplayUrl ? (
                    <a
                      href={repoDisplayUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {repoDisplayUrl}
                    </a>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="truncate text-sm text-text-muted">
                  <span className="font-medium text-text-default">
                    {repoDisplayGitHubUsername ? `@${repoDisplayGitHubUsername}` : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}
          {displayContent && !isEmpty(displayContent) ? (
            <div className="p-4">
              <RichTextViewer content={displayContent} fillHeight />
              <div className="mt-4 text-center text-xs text-text-muted">
                {countCharacters(displayContent)} characters
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-text-muted">
              No work submitted yet
            </div>
          )}
        </div>

        {/* Right panel with tabs */}
        <div className="w-80 border-l border-border bg-page flex flex-col min-h-0">
          {/* Tab switcher */}
          <div className="flex border-b border-border">
            <button
              type="button"
              className={`flex-1 px-3 py-2 text-xs font-medium ${
                rightTab === 'history'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text-default'
              }`}
              onClick={() => handleRightTabChange('history')}
            >
              History
            </button>
            <button
              type="button"
              className={`flex-1 px-3 py-2 text-xs font-medium ${
                rightTab === 'grading'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text-default'
              }`}
              onClick={() => handleRightTabChange('grading')}
            >
              Grading
            </button>
          </div>

          {rightTab === 'history' ? (
            <>
              <div
                className="flex-1 min-h-0 overflow-y-auto"
                onMouseLeave={handleHistoryMouseLeave}
              >
                {historyLoading && historyEntries.length === 0 ? (
                  <div className="p-4 text-center">
                    <Spinner size="sm" />
                  </div>
                ) : historyError ? (
                  <div className="p-3">
                    <p className="text-xs text-danger">{historyError}</p>
                  </div>
                ) : historyEntries.length === 0 ? (
                  <div className="p-3">
                    <p className="text-xs text-text-muted">No saves yet</p>
                  </div>
                ) : (
                  <HistoryList
                    entries={historyEntries}
                    activeEntryId={previewEntry?.id ?? null}
                    onEntryClick={handlePreviewLock}
                    onEntryHover={handlePreviewHover}
                  />
                )}
                {historyLoading && historyEntries.length > 0 && (
                  <RefreshingIndicator label="Refreshing history..." className="px-3 pb-2 pt-0" />
                )}
              </div>
              {isPreviewLocked && previewEntry && (
                <div className="px-3 py-2 border-t border-border">
                  <Button onClick={handleExitPreview} variant="secondary" size="sm" className="w-full">
                    Exit preview
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
              <AuthenticityGauge
                score={data.doc?.authenticity_score ?? null}
                flags={data.doc?.authenticity_flags ?? []}
              />

              {gradeError && (
                <div className="rounded border border-danger bg-danger-bg px-2 py-1.5 text-xs text-danger">{gradeError}</div>
              )}

              {data.doc?.ai_feedback_suggestion?.trim() && (
                <div className="rounded border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-text-muted">AI Suggestion</div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setFeedbackDraft(data.doc?.ai_feedback_suggestion || '')}
                    >
                      Use
                    </Button>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-text-default">
                    {data.doc.ai_feedback_suggestion}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Repo Analysis</div>
                  <Button
                    size="sm"
                    onClick={() => { void handleAnalyzeRepo() }}
                    disabled={repoAnalyzing || !data.repo_target.effectiveRepoUrl || !data.repo_target.effectiveGitHubUsername}
                  >
                    {repoAnalyzing ? 'Analyzing...' : 'Analyze Repo'}
                  </Button>
                </div>

                {repoReviewResult && (
                  <div className="space-y-2">
                    <RepoMetricBar
                      label="Contribution"
                      value={repoReviewResult.relative_contribution_share || 0}
                    />
                    <RepoMetricBar
                      label="Consistency"
                      value={repoReviewResult.spread_score || 0}
                    />
                    <RepoMetricBar
                      label="Iteration"
                      value={repoReviewResult.iteration_score || 0}
                    />
                  </div>
                )}
              </div>

              <ScoreInput label="Completion" value={scoreCompletion} onChange={setScoreCompletion} />
              <ScoreInput label="Thinking" value={scoreThinking} onChange={setScoreThinking} />
              <ScoreInput label="Workflow" value={scoreWorkflow} onChange={setScoreWorkflow} />

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                <span aria-hidden="true" />
                <span
                  className={[
                    'inline-flex h-8 w-12 items-center justify-center justify-self-end rounded border text-sm font-medium',
                    totalPercent >= 80
                      ? 'border-green-200 bg-green-100 text-green-700'
                      : totalPercent >= 60
                        ? 'border-yellow-200 bg-yellow-100 text-yellow-700'
                        : totalPercent >= 50
                          ? 'border-orange-200 bg-orange-100 text-orange-700'
                          : 'border-red-200 bg-red-100 text-red-700',
                  ].join(' ')}
                >
                  {totalPercent}%
                </span>
                <div className="flex items-center justify-self-end gap-1">
                  <span className="text-xs text-text-muted">30</span>
                  <span className="inline-flex h-8 w-12 items-center justify-center rounded border border-border bg-surface text-sm font-medium text-text-default">
                    {totalScore}
                  </span>
                </div>
              </div>

              {feedbackEntries.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Returned Feedback</div>
                  <div className="rounded border border-border bg-surface p-3">
                    <div className="space-y-3">
                      {feedbackEntries.map((entry, index) => (
                        <div key={entry.id} className={index > 0 ? 'border-t border-border pt-3' : ''}>
                          <div className="mb-1 text-[11px] font-medium text-text-muted">
                            {formatInTimeZone(new Date(entry.returned_at), 'America/Toronto', 'MMM d, h:mm a')}
                          </div>
                          <div className="whitespace-pre-wrap text-sm text-text-default">{entry.body}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Feedback Draft</div>
                <textarea
                  value={feedbackDraft}
                  onChange={(e) => setFeedbackDraft(e.target.value)}
                  className="min-h-[10rem] w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text-default resize-y"
                  placeholder="Teacher feedback draft"
                />
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={handleAutoGrade} disabled={autoGrading}>
                  {autoGrading ? 'Grading...' : 'AI grade'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => { void handleReturnFeedback() }}
                  disabled={feedbackReturning || !feedbackDraft.trim()}
                >
                  {feedbackReturning ? 'Returning...' : 'Return Feedback'}
                </Button>
                <SplitButton
                  label={gradeSaving ? 'Saving...' : 'Save'}
                  onPrimaryClick={() => {
                    void handleSaveGrade('graded')
                  }}
                  options={[
                    {
                      id: 'draft',
                      label: 'Draft',
                      onSelect: () => {
                        void handleSaveGrade('draft')
                      },
                    },
                  ]}
                  size="sm"
                  className="flex-1"
                  disabled={gradeSaving}
                  toggleAriaLabel="Choose save mode"
                  primaryButtonProps={{ className: 'flex-1 justify-center' }}
                />
              </div>

              {data.doc?.graded_at && (
                <div className="shrink-0 text-xs text-text-muted">
                  Graded {formatInTimeZone(new Date(data.doc.graded_at), 'America/Toronto', 'MMM d, h:mm a')}
                  {data.doc.graded_by && ` by ${data.doc.graded_by.startsWith('ai:') ? 'AI' : data.doc.graded_by}`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
