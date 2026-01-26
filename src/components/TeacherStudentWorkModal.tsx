'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react'
import { Button } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { formatInTimeZone } from 'date-fns-tz'
import { HistoryList } from '@/components/HistoryList'
import type { Assignment, AssignmentDoc, AssignmentDocHistoryEntry, AssignmentStatus, TiptapContent } from '@/types'

interface StudentWorkData {
  assignment: Assignment
  classroom: { id: string; title: string }
  student: { id: string; email: string; name: string | null }
  doc: AssignmentDoc | null
  status: AssignmentStatus
}

interface TeacherStudentWorkModalProps {
  isOpen: boolean
  onClose: () => void
  assignmentId: string
  studentId: string
  canGoPrev?: boolean
  canGoNext?: boolean
  onGoPrev?: () => void
  onGoNext?: () => void
}

export function TeacherStudentWorkModal({
  isOpen,
  onClose,
  assignmentId,
  studentId,
  canGoPrev = false,
  canGoNext = false,
  onGoPrev,
  onGoNext,
}: TeacherStudentWorkModalProps) {
  const [data, setData] = useState<StudentWorkData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPlainText, setShowPlainText] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<AssignmentDocHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [previewEntry, setPreviewEntry] = useState<AssignmentDocHistoryEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<TiptapContent | null>(null)
  const [lockedEntryId, setLockedEntryId] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(true)

  function updatePreview(entry: AssignmentDocHistoryEntry): boolean {
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

  function handleExitPreview() {
    setPreviewEntry(null)
    setPreviewContent(null)
    setLockedEntryId(null)
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
  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (previewEntry) {
          handleExitPreview()
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose, previewEntry])

  useEffect(() => {
    if (!isOpen) return
    handleExitPreview()
    setLoading(true)
    setError('')
    setData(null)
    setShowPlainText(false)

    async function loadStudentWork() {
      try {
        const response = await fetch(`/api/teacher/assignments/${assignmentId}/students/${studentId}`)
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load student work')
        }
        setData(result)
      } catch (err: any) {
        setError(err.message || 'Failed to load student work')
      } finally {
        setLoading(false)
      }
    }

    loadStudentWork()
  }, [assignmentId, isOpen, studentId])

  useEffect(() => {
    if (!isOpen) return
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
  }, [assignmentId, isOpen, studentId])

  const isPreviewLocked = lockedEntryId !== null

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-2">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        aria-label="Close dialog"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-6xl h-[95vh] rounded-lg border border-border bg-surface shadow-xl overflow-hidden flex flex-col"
      >
        <div className="border-b border-border p-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-default truncate">
                {data?.student?.name || data?.student?.email || 'Student submission'}
              </div>
            </div>
            <div className="min-w-0 max-w-[40vw] text-center">
              <div className="text-base font-semibold text-text-default truncate">
                {data?.assignment?.title || 'Assignment'}
              </div>
              {previewEntry && (
                <div className="text-xs text-primary truncate">
                  Previewing save from {formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'MMM d, h:mm a')}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onGoPrev}
                disabled={!canGoPrev}
                className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Previous student"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onGoNext}
                disabled={!canGoNext}
                className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Next student"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setShowPlainText(prev => !prev)}
                className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover"
                aria-pressed={showPlainText}
                aria-label={showPlainText ? 'Show rich text' : 'Show plain text'}
              >
                {showPlainText ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M4 6h16M12 6v12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M4 6h16M12 6v12" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={handleHistoryToggle}
                className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover"
                aria-expanded={isHistoryOpen}
                aria-label={isHistoryOpen ? 'Hide history' : 'Show history'}
              >
                {isHistoryOpen ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-md hover:bg-surface-hover text-text-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : !data ? (
            <div className="text-sm text-text-muted">No data</div>
          ) : (
            <div className="flex flex-col gap-4 min-h-0 flex-1">
              {/* Student Response with History Column */}
              <div className="bg-surface rounded-lg border border-border overflow-hidden flex flex-col min-h-0 flex-1">
                {/* Main Content Area: Response + History Column */}
                <div className="flex flex-1 min-h-0 flex-col md:flex-row">
                  {/* Student Response */}
                  <div className={`flex-1 min-h-0 border-b md:border-b-0 border-border flex flex-col ${isHistoryOpen ? 'md:border-r' : ''}`}>
                    {data.doc && data.doc.content && !isEmpty(data.doc.content) ? (
                      <div className="flex-1 min-h-0">
                        <div className={previewEntry ? 'ring-2 ring-blue-400 dark:ring-blue-600 rounded-lg p-2 h-full' : 'h-full'}>
                          <RichTextViewer
                            content={previewContent || data.doc.content}
                            showPlainText={showPlainText}
                          />
                        </div>
                        <div className="mt-2 text-xs text-text-muted">
                          {countCharacters(previewContent || data.doc.content)} characters
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0 flex items-center justify-center text-text-muted">
                        No work submitted yet
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
                            <p className="text-xs text-red-600 dark:text-red-400">{historyError}</p>
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
                          <Button onClick={handleExitPreview} variant="secondary" className="w-full">
                            Cancel
                          </Button>
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
                        <p className="text-xs text-red-600 dark:text-red-400">{historyError}</p>
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
                      <div className="pt-4">
                        <Button onClick={handleExitPreview} variant="secondary" className="w-full">
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </details>
                </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
