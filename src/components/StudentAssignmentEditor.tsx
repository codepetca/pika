'use client'

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Tooltip } from '@/ui'
import { History } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor, RichTextViewer } from '@/components/editor'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  calculateAssignmentStatus,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import { isEmpty } from '@/lib/tiptap-content'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { formatInTimeZone } from 'date-fns-tz'
import { HistoryList } from '@/components/HistoryList'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { usePetLevelUp } from '@/hooks/usePetLevelUp'
import { LevelUpCelebration } from '@/components/pet/LevelUpCelebration'
import type { Assignment, AssignmentDoc, AssignmentDocHistoryEntry, TiptapContent } from '@/types'

export interface StudentAssignmentEditorHandle {
  submit: () => Promise<void>
  unsubmit: () => Promise<void>
  isSubmitted: boolean
  canSubmit: boolean
  submitting: boolean
}

interface Props {
  classroomId: string
  assignmentId: string
  variant?: 'standalone' | 'embedded'
  onExit?: () => void
  onStateChange?: (state: { isSubmitted: boolean; canSubmit: boolean; submitting: boolean }) => void
}

export const StudentAssignmentEditor = forwardRef<StudentAssignmentEditorHandle, Props>(function StudentAssignmentEditor({
  classroomId,
  assignmentId,
  variant = 'standalone',
  onExit,
  onStateChange,
}, ref) {
  const router = useRouter()
  const notifications = useStudentNotifications()
  const { checkLevel, celebrationState, dismissCelebration } = usePetLevelUp(classroomId)
  const isEmbedded = variant === 'embedded'

  const AUTOSAVE_DEBOUNCE_MS = 5000
  const AUTOSAVE_MIN_INTERVAL_MS = 15000

  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [doc, setDoc] = useState<AssignmentDoc | null>(null)
  const [content, setContent] = useState<TiptapContent>({ type: 'doc', content: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyEntries, setHistoryEntries] = useState<AssignmentDocHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [previewEntry, setPreviewEntry] = useState<AssignmentDocHistoryEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<TiptapContent | null>(null)
  const [lockedEntryId, setLockedEntryId] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(true)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  // Save state
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [submitting, setSubmitting] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const pendingContentRef = useRef<TiptapContent | null>(null)
  const draftBeforePreviewRef = useRef<TiptapContent | null>(null)

  // Input tracking for authenticity
  const pasteWordCountRef = useRef(0)
  const keystrokeCountRef = useRef(0)

  const loadAssignment = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load assignment')
      }

      setAssignment(data.assignment)
      setDoc(data.doc)
      setContent(data.doc?.content || { type: 'doc', content: [] })
      lastSavedContentRef.current = JSON.stringify(data.doc?.content || { type: 'doc', content: [] })

      // Decrement notification count only if this was the first view (server confirmed)
      if (data.wasFirstView) {
        notifications?.decrementUnviewedCount()
      }
    } catch (err: any) {
      console.error('Error loading assignment:', err)
      setError(err.message || 'Failed to load assignment')
    } finally {
      setLoading(false)
    }
  }, [assignmentId, notifications])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}/history`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load history')
      }
      setHistoryEntries(data.history || [])
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load history')
    } finally {
      setHistoryLoading(false)
    }
  }, [assignmentId])

  useEffect(() => {
    loadAssignment()
    loadHistory()
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
      }
    }
  }, [loadAssignment, loadHistory])

  // Autosave with debouncing
  const saveContent = useCallback(async (
    newContent: TiptapContent,
    options?: { trigger?: 'autosave' | 'blur' }
  ) => {
    const newContentStr = JSON.stringify(newContent)
    if (newContentStr === lastSavedContentRef.current) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')
    lastSaveAttemptAtRef.current = Date.now()

    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newContent,
          trigger: options?.trigger ?? 'autosave',
          paste_word_count: pasteWordCountRef.current,
          keystroke_count: keystrokeCountRef.current,
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      const historyEntry = data.historyEntry as AssignmentDocHistoryEntry | null | undefined

      setDoc(data.doc)
      if (historyEntry) {
        setHistoryEntries(prev => {
          const existingIndex = prev.findIndex(entry => entry.id === historyEntry.id)
          const next = existingIndex === -1 ? [historyEntry, ...prev] : [...prev]

          if (existingIndex !== -1) {
            next[existingIndex] = historyEntry
          }

          return next.sort((a, b) => b.created_at.localeCompare(a.created_at))
        })
        setPreviewEntry(prev => (prev?.id === historyEntry.id ? historyEntry : prev))
      }
      lastSavedContentRef.current = newContentStr
      pasteWordCountRef.current = 0
      keystrokeCountRef.current = 0
      setSaveStatus('saved')
    } catch (err: any) {
      console.error('Error saving:', err)
      setSaveStatus('unsaved')
    }
  }, [assignmentId])

  const scheduleSave = useCallback((
    newContent: TiptapContent,
    options?: { force?: boolean; trigger?: 'autosave' | 'blur' }
  ) => {
    pendingContentRef.current = newContent

    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastAttempt = now - lastSaveAttemptAtRef.current

    if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
      void saveContent(newContent, { trigger: options?.trigger })
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttledSaveTimeoutRef.current = setTimeout(() => {
      throttledSaveTimeoutRef.current = null
      const latest = pendingContentRef.current
      if (latest) {
        void saveContent(latest, { trigger: options?.trigger })
      }
    }, waitMs)
  }, [AUTOSAVE_MIN_INTERVAL_MS, saveContent])

  function handleContentChange(newContent: TiptapContent) {
    if (previewEntry) return
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent

    // Debounce save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(newContent, { trigger: 'autosave' })
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function flushAutosave() {
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      scheduleSave(pendingContentRef.current, { force: true, trigger: 'blur' })
    }
  }

  const handleSubmit = useCallback(async () => {
    // Save first if there are unsaved changes
    if (JSON.stringify(content) !== lastSavedContentRef.current) {
      await saveContent(content, { trigger: 'autosave' })
    }

    setSubmitting(true)

    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}/submit`, {
        method: 'POST'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit')
      }

      setDoc(data.doc)
      if (data.achievements?.newLevel != null) {
        checkLevel(data.achievements.newLevel)
      }
      // Update lastSavedContentRef to match the current content after successful submit
      lastSavedContentRef.current = JSON.stringify(content)
      setSaveStatus('saved')
    } catch (err: any) {
      console.error('Error submitting:', err)
      setError(err.message || 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }, [assignmentId, content, saveContent, checkLevel])

  const handleUnsubmit = useCallback(async () => {
    setSubmitting(true)

    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}/unsubmit`, {
        method: 'POST'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to unsubmit')
      }

      setDoc(data.doc)
    } catch (err: any) {
      console.error('Error unsubmitting:', err)
      setError(err.message || 'Failed to unsubmit')
    } finally {
      setSubmitting(false)
    }
  }, [assignmentId])

  function updatePreview(entry: AssignmentDocHistoryEntry): boolean {
    if (!draftBeforePreviewRef.current) {
      draftBeforePreviewRef.current = JSON.parse(JSON.stringify(content)) as TiptapContent
    }
    // Reconstruct content for this entry (client-side, no API call)
    // API returns newest-first, but reconstruction needs oldest-first
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

  function handleHistoryMouseLeave() {
    if (lockedEntryId) return
    handleExitPreview()
  }

  function handleHistoryToggle() {
    if (isHistoryOpen) {
      handleExitPreview()
    }
    setIsHistoryOpen(prev => !prev)
  }

  function handleExitPreview(options?: { restoreDraft?: boolean }) {
    const shouldRestore = options?.restoreDraft !== false
    if (shouldRestore && draftBeforePreviewRef.current) {
      const restoredDraft = draftBeforePreviewRef.current
      setContent(restoredDraft)
      pendingContentRef.current = restoredDraft
      const restoredStr = JSON.stringify(restoredDraft)
      setSaveStatus(restoredStr === lastSavedContentRef.current ? 'saved' : 'unsaved')
    }
    setPreviewEntry(null)
    setPreviewContent(null)
    setShowRestoreModal(false)
    setLockedEntryId(null)
    draftBeforePreviewRef.current = null
  }

  function handleRestoreClick() {
    if (!previewEntry || !lockedEntryId) return
    setShowRestoreModal(true)
  }

  async function confirmRestore() {
    if (!previewEntry) return

    setRestoringId(previewEntry.id)
    setHistoryError('')
    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history_id: previewEntry.id })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to restore')
      }
      setDoc(data.doc)
      setContent(data.doc?.content || { type: 'doc', content: [] })
      lastSavedContentRef.current = JSON.stringify(data.doc?.content || { type: 'doc', content: [] })
      setSaveStatus('saved')
      await loadHistory()
      handleExitPreview({ restoreDraft: false })
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to restore')
    } finally {
      setRestoringId(null)
      setShowRestoreModal(false)
    }
  }

  // Compute state for imperative handle (before early returns)
  const isSubmitted = doc?.is_submitted || false
  const canSubmit = !isEmpty(content) && !previewEntry

  // Expose imperative handle for parent components
  useImperativeHandle(ref, () => ({
    submit: handleSubmit,
    unsubmit: handleUnsubmit,
    isSubmitted,
    canSubmit,
    submitting,
  }), [handleSubmit, handleUnsubmit, isSubmitted, canSubmit, submitting])

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.({ isSubmitted, canSubmit, submitting })
  }, [isSubmitted, canSubmit, submitting, onStateChange])

  if (loading) {
    if (isEmbedded) {
      return (
        <div className="bg-surface rounded-lg shadow-sm border border-border">
          <div className="p-6 flex justify-center">
            <Spinner size="lg" />
          </div>
        </div>
      )
    }
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error && !assignment) {
    const exit = onExit ?? (() => router.push(`/classrooms/${classroomId}?tab=assignments`))
    if (isEmbedded) {
      return (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-8 text-center">
          <p className="text-danger mb-4">{error}</p>
          <button
            onClick={exit}
            className="text-primary hover:text-primary-hover"
          >
            Back to assignments
          </button>
        </div>
      )
    }
    return (
      <div className="bg-surface rounded-lg shadow-sm p-8 text-center">
        <p className="text-danger mb-4">{error}</p>
        <button
          onClick={() => router.back()}
          className="text-primary hover:text-primary-hover"
        >
          Go back
        </button>
      </div>
    )
  }

  if (!assignment) {
    return null
  }

  const status = calculateAssignmentStatus(assignment, doc)
  const isPreviewLocked = lockedEntryId !== null
  const hasFeedback = Boolean(doc?.feedback?.trim())
  const hasCompletionScore = doc?.score_completion != null
  const hasThinkingScore = doc?.score_thinking != null
  const hasWorkflowScore = doc?.score_workflow != null
  const hasAnyScore = hasCompletionScore || hasThinkingScore || hasWorkflowScore
  const hasFullScoreSet = hasCompletionScore && hasThinkingScore && hasWorkflowScore

  const editorContent = (
    <div className="flex flex-col gap-6 h-full min-h-0">
      {/* Instructions */}
      {!isEmbedded && (assignment.rich_instructions || assignment.description) && (
        <div className="bg-page border border-border rounded-lg p-4">
          {assignment.rich_instructions ? (
            <RichTextViewer content={assignment.rich_instructions} />
          ) : (
            <p className="text-text-muted whitespace-pre-wrap">{assignment.description}</p>
          )}
        </div>
      )}

      {/* Editor with History Column */}
      <div className="bg-surface rounded-lg shadow-sm border border-border flex flex-col min-h-0 flex-1">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text-muted truncate">
                {assignment.title}
              </div>
            </div>
            <div
              className={`text-xs ${
                saveStatus === 'saved'
                  ? 'text-success'
                  : saveStatus === 'saving'
                    ? 'text-text-muted'
                    : 'text-warning'
              }`}
            >
              {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
            </div>
            <Tooltip content={isHistoryOpen ? 'Hide history' : 'Show history'}>
              <button
                type="button"
                onClick={handleHistoryToggle}
                className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover"
                aria-expanded={isHistoryOpen}
                aria-label={isHistoryOpen ? 'Hide history' : 'Show history'}
              >
                <History className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Main Content Area: Editor + History Column */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* Editor */}
          <div className={`flex-1 min-h-0 border-b md:border-b-0 border-border flex flex-col ${isHistoryOpen ? 'md:border-r' : ''}`}>
            <div className={previewEntry ? 'ring-2 ring-warning rounded-lg flex-1 min-h-0' : 'flex-1 min-h-0'}>
              <RichTextEditor
                content={previewContent || content}
                onChange={handleContentChange}
                placeholder="Write your response here..."
                disabled={submitting || !!previewEntry}
                editable={!isSubmitted && !previewEntry}
                onBlur={flushAutosave}
                onPaste={(wordCount) => { pasteWordCountRef.current += wordCount }}
                onKeystroke={() => { keystrokeCountRef.current++ }}
                className="h-full"
                enableImageUpload
                onImageUploadError={(message) => setError(message)}
              />
            </div>

            {error && (
              <div className="mt-4">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}
          </div>

          {/* History Column (Desktop) */}
          {isHistoryOpen && (
            <div
              className="hidden md:flex w-60 bg-page flex-col min-h-0"
              onMouseLeave={handleHistoryMouseLeave}
            >
              <div className="p-3 border-b border-border">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  History
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {historyLoading ? (
                  <div className="p-4 text-center">
                    <Spinner size="sm" />
                  </div>
                ) : historyError ? (
                  <div className="p-4">
                    <p className="text-xs text-danger">{historyError}</p>
                  </div>
                ) : historyEntries.length === 0 ? (
                  <div className="p-4">
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
                <div className="px-3 py-3 border-t border-border">
                  <div className="flex flex-col gap-2">
                    {!isSubmitted && (
                      <Button onClick={handleRestoreClick} disabled={restoringId !== null}>
                        {restoringId ? 'Restoring...' : 'Restore'}
                      </Button>
                    )}
                    <Button onClick={() => handleExitPreview()} variant="secondary">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile History Drawer */}
        {isHistoryOpen && (
          <div className="md:hidden border-t border-border">
          <details
            className="group"
            onToggle={(event) => {
              const target = event.currentTarget
              if (!target.open && !lockedEntryId) {
                handleExitPreview()
              }
            }}
          >
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-text-muted hover:bg-surface-hover flex items-center justify-between">
              <span>View History ({historyEntries.length})</span>
              <svg className="w-5 h-5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-4 pb-4 max-h-80 overflow-y-auto bg-page">
              {historyLoading ? (
                <div className="p-4 text-center">
                  <Spinner size="sm" />
                </div>
              ) : historyError ? (
                <p className="text-xs text-danger">{historyError}</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-xs text-text-muted">No saves yet</p>
              ) : (
                <HistoryList
                  entries={historyEntries}
                  activeEntryId={previewEntry?.id ?? null}
                  onEntryClick={handlePreviewLock}
                  variant="mobile"
                />
              )}
              {isPreviewLocked && previewEntry && (
                <div className="pt-4 flex flex-col gap-2">
                  {!isSubmitted && (
                    <Button onClick={handleRestoreClick} disabled={restoringId !== null}>
                      {restoringId ? 'Restoring...' : 'Restore'}
                    </Button>
                  )}
                  <Button onClick={() => handleExitPreview()} variant="secondary">
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </details>
        </div>
        )}
      </div>

      {/* Restore Confirmation Modal */}
      {showRestoreModal && previewEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-text-default mb-2">
              Restore this version?
            </h3>
            <p className="text-sm text-text-muted mb-4">
              This will replace your current draft with the version saved on{' '}
              {formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'MMM d, yyyy')} at{' '}
              {formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'h:mm a')}.
            </p>
            <div className="flex gap-3 justify-end">
              <Button onClick={() => setShowRestoreModal(false)} variant="secondary">
                Cancel
              </Button>
              <Button onClick={confirmRestore} disabled={restoringId !== null}>
                {restoringId ? 'Restoring...' : 'Restore'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Grade panel (shown when work has been returned) */}
      {doc?.returned_at && (hasFeedback || hasAnyScore) && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-default">Feedback</h3>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-2 text-sm md:pr-4 md:border-r md:border-border">
              {hasCompletionScore && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Completion</span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {doc.score_completion}
                    </span>
                    <span className="text-xs text-text-muted">10</span>
                  </span>
                </div>
              )}
              {hasThinkingScore && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Thinking</span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {doc.score_thinking}
                    </span>
                    <span className="text-xs text-text-muted">10</span>
                  </span>
                </div>
              )}
              {hasWorkflowScore && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Workflow</span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {doc.score_workflow}
                    </span>
                    <span className="text-xs text-text-muted">10</span>
                  </span>
                </div>
              )}
              {hasFullScoreSet && (
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 pt-1">
                  <span className="text-text-default font-medium">Total</span>
                  <div className="flex justify-center">
                    <span className="inline-flex items-center border border-border rounded-md px-3 py-1 text-xl font-semibold text-text-default">
                      {Math.round((((doc.score_completion ?? 0) + (doc.score_thinking ?? 0) + (doc.score_workflow ?? 0)) / 30) * 100)}%
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {(doc.score_completion ?? 0) + (doc.score_thinking ?? 0) + (doc.score_workflow ?? 0)}
                    </span>
                    <span className="text-xs text-text-muted">30</span>
                  </span>
                </div>
              )}
              {!hasAnyScore && (
                <div className="text-xs text-text-muted">No score assigned.</div>
              )}
            </div>
            <div>
              <div className="text-sm text-text-default whitespace-pre-wrap">
                {doc.feedback?.trim() || 'No feedback provided yet.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submission info */}
      {isSubmitted && doc?.submitted_at && (
        <div className="text-sm text-text-muted text-center">
          Submitted on{' '}
          {new Date(doc.submitted_at).toLocaleString('en-CA', {
            timeZone: 'America/Toronto',
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </div>
      )}

      {celebrationState && (
        <LevelUpCelebration
          isOpen={celebrationState.isOpen}
          newLevel={celebrationState.newLevel}
          onClose={dismissCelebration}
        />
      )}
    </div>
  )

  if (isEmbedded) {
    return editorContent
  }

  return (
    <PageLayout className="h-full flex flex-col">
      <PageActionBar
        primary={
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                className={ACTIONBAR_BUTTON_CLASSNAME}
                onClick={() => router.push(`/classrooms/${classroomId}`)}
              >
                Back to classroom
              </button>
              <div className="mt-2 text-sm font-medium text-text-default truncate">
                {assignment.title}
              </div>
              <div className="text-xs text-text-muted truncate">
                Due: {formatDueDate(assignment.due_at)} • {formatRelativeDueDate(assignment.due_at)}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded text-sm font-medium ${getAssignmentStatusBadgeClass(status)}`}>
                {getAssignmentStatusLabel(status)}
              </span>
              {isSubmitted ? (
                <Button size="sm" onClick={handleUnsubmit} variant="secondary" disabled={submitting || !!previewEntry}>
                  {submitting ? 'Unsubmitting...' : 'Unsubmit'}
                </Button>
              ) : (
                <Button size="sm" onClick={handleSubmit} disabled={submitting || isEmpty(content) || !!previewEntry}>
                  {submitting ? 'Submitting...' : 'Submit'}
                </Button>
              )}
            </div>
          </div>
        }
      />

      <PageContent className="flex-1 min-h-0">{editorContent}</PageContent>
    </PageLayout>
  )
})
