'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/ui'
import { RichTextViewer } from '@/components/editor'
import { HistoryList } from '@/components/HistoryList'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { formatInTimeZone } from 'date-fns-tz'
import type { Assignment, AssignmentDoc, AssignmentDocHistoryEntry, AssignmentStatus, TiptapContent } from '@/types'

interface StudentWorkData {
  assignment: Assignment
  classroom: { id: string; title: string }
  student: { id: string; email: string; name: string | null }
  doc: AssignmentDoc | null
  status: AssignmentStatus
}

interface TeacherStudentWorkPanelProps {
  assignmentId: string
  studentId: string
}

type RightTab = 'history' | 'grading'

export function TeacherStudentWorkPanel({
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

  // Grading state
  const [rightTab, setRightTab] = useState<RightTab>('history')
  const [scoreCompletion, setScoreCompletion] = useState<string>('')
  const [scoreThinking, setScoreThinking] = useState<string>('')
  const [scoreWorkflow, setScoreWorkflow] = useState<string>('')
  const [feedback, setFeedback] = useState<string>('')
  const [gradeSaving, setGradeSaving] = useState(false)
  const [gradeError, setGradeError] = useState('')
  const [autoGrading, setAutoGrading] = useState(false)

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
    if (doc?.graded_at) {
      setScoreCompletion(doc.score_completion?.toString() ?? '')
      setScoreThinking(doc.score_thinking?.toString() ?? '')
      setScoreWorkflow(doc.score_workflow?.toString() ?? '')
      setFeedback(doc.feedback ?? '')
      setRightTab('grading')
    } else {
      setScoreCompletion('')
      setScoreThinking('')
      setScoreWorkflow('')
      setFeedback('')
      setRightTab('history')
    }
  }

  // Load student work
  useEffect(() => {
    setLoading(true)
    setError('')
    setData(null)
    handleExitPreview()
    setGradeError('')

    async function loadStudentWork() {
      try {
        const response = await fetch(`/api/teacher/assignments/${assignmentId}/students/${studentId}`)
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load student work')
        }
        setData(result)
        populateGradeForm(result.doc)
      } catch (err: any) {
        setError(err.message || 'Failed to load student work')
      } finally {
        setLoading(false)
      }
    }

    loadStudentWork()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, studentId])

  // Load history
  useEffect(() => {
    setHistoryLoading(true)
    setHistoryError('')
    setHistoryEntries([])

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

  async function handleSaveGrade() {
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
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          score_completion: sc,
          score_thinking: st,
          score_workflow: sw,
          feedback,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save grade')
      // Update local state
      setData((prev) => prev ? { ...prev, doc: result.doc } : prev)
    } catch (err: any) {
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
      }
      // Reload data to get updated grades
      const reloadRes = await fetch(`/api/teacher/assignments/${assignmentId}/students/${studentId}`)
      const reloadData = await reloadRes.json()
      if (reloadRes.ok) {
        setData(reloadData)
        populateGradeForm(reloadData.doc)
      }
    } catch (err: any) {
      setGradeError(err.message || 'Auto-grade failed')
    } finally {
      setAutoGrading(false)
    }
  }

  if (loading) {
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

  const sc = Number(scoreCompletion) || 0
  const st = Number(scoreThinking) || 0
  const sw = Number(scoreWorkflow) || 0
  const totalScore = sc + st + sw
  const totalPercent = Math.round((totalScore / 30) * 100)

  return (
    <div className="flex flex-col h-full">
      {/* Preview banner */}
      {previewEntry && (
        <div className="px-4 py-2 bg-info-bg border-b border-primary">
          <div className="text-xs text-info">
            Previewing: {formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'MMM d, h:mm a')}
          </div>
        </div>
      )}

      {/* Main content area: Student work + Right panel side by side */}
      <div className="flex-1 min-h-0 flex">
        {/* Student work content */}
        <div className={`flex-1 min-h-0 overflow-auto p-4 ${previewEntry ? 'ring-2 ring-primary ring-inset' : ''}`}>
          {displayContent && !isEmpty(displayContent) ? (
            <div>
              <RichTextViewer content={displayContent} />
              <div className="mt-4 text-xs text-text-muted">
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
        <div className="w-56 border-l border-border bg-page flex flex-col min-h-0">
          {/* Tab switcher */}
          <div className="flex border-b border-border">
            <button
              type="button"
              className={`flex-1 px-3 py-2 text-xs font-medium ${
                rightTab === 'history'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text-default'
              }`}
              onClick={() => setRightTab('history')}
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
              onClick={() => setRightTab('grading')}
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
                {historyLoading ? (
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
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
              {gradeError && (
                <div className="text-xs text-danger">{gradeError}</div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Completion (0–10)</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={scoreCompletion}
                  onChange={(e) => setScoreCompletion(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text-default"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Thinking (0–10)</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={scoreThinking}
                  onChange={(e) => setScoreThinking(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text-default"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Workflow (0–10)</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={scoreWorkflow}
                  onChange={(e) => setScoreWorkflow(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text-default"
                />
              </div>

              <div className="text-sm font-medium text-text-default">
                Total: {totalScore}/30 ({totalPercent}%)
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Feedback</label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={4}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text-default resize-none"
                  placeholder="Write feedback..."
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button size="sm" onClick={handleSaveGrade} disabled={gradeSaving}>
                  {gradeSaving ? 'Saving...' : 'Save Grade'}
                </Button>
                <Button size="sm" variant="secondary" onClick={handleAutoGrade} disabled={autoGrading}>
                  {autoGrading ? 'Grading...' : 'Auto-grade'}
                </Button>
              </div>

              {data.doc?.graded_at && (
                <div className="text-xs text-text-muted">
                  Graded {formatInTimeZone(new Date(data.doc.graded_at), 'America/Toronto', 'MMM d, h:mm a')}
                  {data.doc.graded_by && ` by ${data.doc.graded_by}`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
