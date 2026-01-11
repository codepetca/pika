'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Eye, EyeOff } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/editor'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  calculateAssignmentStatus,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { formatInTimeZone } from 'date-fns-tz'
import { HistoryList } from '@/components/HistoryList'
import type { Assignment, AssignmentDoc, AssignmentDocHistoryEntry, TiptapContent } from '@/types'

interface Props {
  classroomId: string
  assignmentId: string
  variant?: 'standalone' | 'embedded'
  onExit?: () => void
}

export function StudentAssignmentEditor({
  classroomId,
  assignmentId,
  variant = 'standalone',
  onExit,
}: Props) {
  const router = useRouter()
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
    } catch (err: any) {
      console.error('Error loading assignment:', err)
      setError(err.message || 'Failed to load assignment')
    } finally {
      setLoading(false)
    }
  }, [assignmentId])

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

  async function handleSubmit() {
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
      // Update lastSavedContentRef to match the current content after successful submit
      lastSavedContentRef.current = JSON.stringify(content)
      setSaveStatus('saved')
    } catch (err: any) {
      console.error('Error submitting:', err)
      setError(err.message || 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUnsubmit() {
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
  }

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

  if (loading) {
    if (isEmbedded) {
      return (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
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
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={exit}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            Back to assignments
          </button>
        </div>
      )
    }
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-8 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => router.back()}
          className="text-blue-600 hover:text-blue-700"
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
  const isSubmitted = doc?.is_submitted || false
  const isPreviewLocked = lockedEntryId !== null

  const editorContent = (
    <div className="flex flex-col gap-6 h-full min-h-0">
      {/* Description */}
      {!isEmbedded && assignment.description && (
        <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{assignment.description}</p>
        </div>
      )}

      {/* Editor with History Column */}
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col min-h-0 flex-1">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                {assignment.title}
              </div>
              {previewEntry && (
                <div className="text-xs text-yellow-600 dark:text-yellow-400">
                  Previewing save from {formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'MMM d, h:mm a')}
                </div>
              )}
            </div>
            <div
              className={`text-xs text-center ${
                saveStatus === 'saved'
                  ? 'text-green-600 dark:text-green-400'
                  : saveStatus === 'saving'
                    ? 'text-gray-500 dark:text-gray-400'
                    : 'text-orange-600 dark:text-orange-400'
              }`}
            >
              {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved changes'}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleHistoryToggle}
                className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                aria-expanded={isHistoryOpen}
                aria-label={isHistoryOpen ? 'Hide history' : 'Show history'}
              >
                {isHistoryOpen ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area: Editor + History Column */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* Editor */}
          <div className={`flex-1 min-h-0 border-b md:border-b-0 border-gray-200 dark:border-gray-700 flex flex-col ${isHistoryOpen ? 'md:border-r' : ''}`}>
            <div className={previewEntry ? 'ring-2 ring-yellow-400 dark:ring-yellow-600 rounded-lg flex-1 min-h-0' : 'flex-1 min-h-0'}>
              <RichTextEditor
                content={previewContent || content}
                onChange={handleContentChange}
                placeholder="Write your response here..."
                disabled={submitting || !!previewEntry}
                editable={!isSubmitted && !previewEntry}
                onBlur={flushAutosave}
                className="h-full"
              />
            </div>

            {error && (
              <div className="mt-4">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* History Column (Desktop) */}
          {isHistoryOpen && (
            <div
              className="hidden md:flex w-60 bg-gray-50 dark:bg-gray-950 flex-col min-h-0"
              onMouseLeave={handleHistoryMouseLeave}
            >
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
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
                    <p className="text-xs text-red-600 dark:text-red-400">{historyError}</p>
                  </div>
                ) : historyEntries.length === 0 ? (
                  <div className="p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">No saves yet</p>
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
                <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700">
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

        {/* Footer with Actions */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {countCharacters(previewContent || content)} characters
          </div>

          <div className="flex gap-2">
            {isSubmitted ? (
              <Button onClick={handleUnsubmit} variant="secondary" disabled={submitting || !!previewEntry}>
                {submitting ? 'Unsubmitting...' : 'Unsubmit'}
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting || isEmpty(content) || !!previewEntry}>
                {submitting ? 'Submitting...' : 'Submit'}
              </Button>
            )}
          </div>
        </div>

        {/* Mobile History Drawer */}
        {isHistoryOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-700">
          <details
            className="group"
            onToggle={(event) => {
              const target = event.currentTarget
              if (!target.open && !lockedEntryId) {
                handleExitPreview()
              }
            }}
          >
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between">
              <span>View History ({historyEntries.length})</span>
              <svg className="w-5 h-5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-4 pb-4 max-h-80 overflow-y-auto bg-gray-50 dark:bg-gray-950">
              {historyLoading ? (
                <div className="p-4 text-center">
                  <Spinner size="sm" />
                </div>
              ) : historyError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{historyError}</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">No saves yet</p>
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
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Restore this version?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
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

      {/* Submission info */}
      {isSubmitted && doc?.submitted_at && (
        <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
          Submitted on{' '}
          {new Date(doc.submitted_at).toLocaleString('en-CA', {
            timeZone: 'America/Toronto',
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </div>
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
              <div className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {assignment.title}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                Due: {formatDueDate(assignment.due_at)} • {formatRelativeDueDate(assignment.due_at)}
              </div>
            </div>
            <span className={`px-3 py-1 rounded text-sm font-medium ${getAssignmentStatusBadgeClass(status)}`}>
              {getAssignmentStatusLabel(status)}
            </span>
          </div>
        }
      />

      <PageContent className="flex-1 min-h-0">{editorContent}</PageContent>
    </PageLayout>
  )
}
