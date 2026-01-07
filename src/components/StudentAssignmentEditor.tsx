'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/RichTextEditor'
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
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
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

      setDoc(data.doc)
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

  function handlePreviewClick(entry: AssignmentDocHistoryEntry) {
    // Reconstruct content for this entry (client-side, no API call)
    // API returns newest-first, but reconstruction needs oldest-first
    const oldestFirst = [...historyEntries].reverse()
    const reconstructed = reconstructAssignmentDocContent(oldestFirst, entry.id)

    if (reconstructed) {
      setPreviewEntry(entry)
      setPreviewContent(reconstructed)
    }
  }

  function handleExitPreview() {
    setPreviewEntry(null)
    setPreviewContent(null)
    setShowRestoreModal(false)
  }

  function handleRestoreClick() {
    if (!previewEntry) return
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
      handleExitPreview()
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

  const editorContent = (
    <div className="space-y-6">
      {/* Description */}
      {!isEmbedded && assignment.description && (
        <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{assignment.description}</p>
        </div>
      )}

      {/* Editor with History Column */}
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {previewEntry ? (
              <span className="text-yellow-600 dark:text-yellow-400">
                Previewing save from {formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'MMM d, h:mm a')}
              </span>
            ) : (
              'Your Response'
            )}
          </span>
          <span
            className={`text-xs ${
              saveStatus === 'saved'
                ? 'text-green-600 dark:text-green-400'
                : saveStatus === 'saving'
                  ? 'text-gray-500 dark:text-gray-400'
                  : 'text-orange-600 dark:text-orange-400'
            }`}
          >
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved changes'}
          </span>
        </div>

        {/* Main Content Area: Editor + History Column */}
        <div className="flex flex-col md:flex-row">
          {/* Editor */}
          <div className="flex-1 p-4 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
            <div className={previewEntry ? 'ring-2 ring-yellow-400 dark:ring-yellow-600 rounded-lg' : ''}>
              <RichTextEditor
                content={previewContent || content}
                onChange={handleContentChange}
                placeholder="Write your response here..."
                disabled={submitting || !!previewEntry}
                editable={!isSubmitted && !previewEntry}
                onBlur={flushAutosave}
              />
            </div>

            {error && (
              <div className="mt-4">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* History Column (Desktop) */}
          <div className="hidden md:block w-60 bg-gray-50 dark:bg-gray-950 overflow-y-auto" style={{ maxHeight: '600px' }}>
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                History
              </h3>
            </div>
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
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {(() => {
                  const entriesByDate = historyEntries.reduce((acc, entry) => {
                    const date = formatInTimeZone(new Date(entry.created_at), 'America/Toronto', 'MMM d')
                    if (!acc[date]) acc[date] = []
                    acc[date]!.push(entry)
                    return acc
                  }, {} as Record<string, AssignmentDocHistoryEntry[]>)

                  return Object.entries(entriesByDate).map(([date, entries]) => (
                    <div key={date} className="px-3 py-2">
                      <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{date}</div>
                      <div className="space-y-1">
                        {entries.map((entry, idx) => {
                          const prevEntry = idx > 0 ? entries[idx - 1] : null
                          const charDiff = prevEntry ? entry.char_count - prevEntry.char_count : entry.char_count
                          const isActive = previewEntry?.id === entry.id

                          return (
                            <button
                              key={entry.id}
                              onClick={() => handlePreviewClick(entry)}
                              className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                                isActive
                                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                                  : 'hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono">
                                  {formatInTimeZone(new Date(entry.created_at), 'America/Toronto', 'h:mm a')}
                                </span>
                                <span className={`text-[10px] ${
                                  charDiff > 200 ? 'text-orange-600 dark:text-orange-400 font-bold' :
                                  charDiff > 0 ? 'text-green-600 dark:text-green-400' :
                                  charDiff < 0 ? 'text-red-600 dark:text-red-400' :
                                  'text-gray-500 dark:text-gray-500'
                                }`}>
                                  {charDiff > 0 ? '+' : ''}{charDiff}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Footer with Actions */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {countCharacters(previewContent || content)} characters
          </div>

          <div className="flex gap-2">
            {previewEntry ? (
              <>
                <Button onClick={handleExitPreview} variant="secondary">
                  Exit Preview
                </Button>
                {!isSubmitted && (
                  <Button onClick={handleRestoreClick} disabled={restoringId !== null}>
                    {restoringId ? 'Restoring...' : 'Restore This Version'}
                  </Button>
                )}
              </>
            ) : (
              <>
                {isSubmitted ? (
                  <Button onClick={handleUnsubmit} variant="secondary" disabled={submitting}>
                    {submitting ? 'Unsubmitting...' : 'Unsubmit'}
                  </Button>
                ) : (
                  <Button onClick={handleSubmit} disabled={submitting || isEmpty(content)}>
                    {submitting ? 'Submitting...' : 'Submit'}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Mobile History Drawer */}
        <div className="md:hidden border-t border-gray-200 dark:border-gray-700">
          <details className="group">
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
                <div className="space-y-3 mt-3">
                  {(() => {
                    const entriesByDate = historyEntries.reduce((acc, entry) => {
                      const date = formatInTimeZone(new Date(entry.created_at), 'America/Toronto', 'MMM d')
                      if (!acc[date]) acc[date] = []
                      acc[date]!.push(entry)
                      return acc
                    }, {} as Record<string, AssignmentDocHistoryEntry[]>)

                    return Object.entries(entriesByDate).map(([date, entries]) => (
                      <div key={date}>
                        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{date}</div>
                        <div className="space-y-1">
                          {entries.map((entry, idx) => {
                            const prevEntry = idx > 0 ? entries[idx - 1] : null
                            const charDiff = prevEntry ? entry.char_count - prevEntry.char_count : entry.char_count
                            const isActive = previewEntry?.id === entry.id

                            return (
                              <button
                                key={entry.id}
                                onClick={() => handlePreviewClick(entry)}
                                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                                  isActive
                                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                                    : 'bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-mono">
                                    {formatInTimeZone(new Date(entry.created_at), 'America/Toronto', 'h:mm a')}
                                  </span>
                                  <span className={`text-xs ${
                                    charDiff > 200 ? 'text-orange-600 dark:text-orange-400 font-bold' :
                                    charDiff > 0 ? 'text-green-600 dark:text-green-400' :
                                    charDiff < 0 ? 'text-red-600 dark:text-red-400' :
                                    'text-gray-500'
                                  }`}>
                                    {charDiff > 0 ? '+' : ''}{charDiff}
                                  </span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>
          </details>
        </div>
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
    <PageLayout>
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

      <PageContent>{editorContent}</PageContent>
    </PageLayout>
  )
}
