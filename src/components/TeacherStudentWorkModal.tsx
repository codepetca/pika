'use client'

import { useEffect, useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/RichTextViewer'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { formatDueDate, getAssignmentStatusBadgeClass, getAssignmentStatusLabel } from '@/lib/assignments'
import { formatInTimeZone } from 'date-fns-tz'
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
}

function formatTorontoDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function TeacherStudentWorkModal({
  isOpen,
  onClose,
  assignmentId,
  studentId,
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

  function updatePreview(entry: AssignmentDocHistoryEntry) {
    // Reconstruct content for this entry (client-side, no API call)
    // API returns newest-first, but reconstruction needs oldest-first
    const oldestFirst = [...historyEntries].reverse()
    const reconstructed = reconstructAssignmentDocContent(oldestFirst, entry.id)

    if (reconstructed) {
      setPreviewEntry(entry)
      setPreviewContent(reconstructed)
    }
  }

  function handlePreviewHover(entry: AssignmentDocHistoryEntry) {
    if (lockedEntryId) return
    updatePreview(entry)
  }

  function handlePreviewLock(entry: AssignmentDocHistoryEntry) {
    updatePreview(entry)
    setLockedEntryId(entry.id)
  }

  function handleExitPreview() {
    setPreviewEntry(null)
    setPreviewContent(null)
    setLockedEntryId(null)
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

  function getTriggerBadgeClasses(trigger: AssignmentDocHistoryEntry['trigger']) {
    return 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }

  const isPreviewLocked = lockedEntryId !== null

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        aria-label="Close dialog"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-6xl h-[90vh] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 dark:border-gray-700 p-4">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {data?.student?.name || data?.student?.email || 'Student submission'}
            </div>
            {data?.student?.name && data.student.email && (
              <div className="text-sm text-gray-600 dark:text-gray-300 truncate">{data.student.email}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : !data ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">No data</div>
          ) : (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {data.assignment.title}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                      Due: {formatDueDate(data.assignment.due_at)}
                    </div>
                    {data.doc?.submitted_at && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Submitted: {formatTorontoDateTime(data.doc.submitted_at)}
                      </div>
                    )}
                    {data.doc?.updated_at && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Last updated: {formatTorontoDateTime(data.doc.updated_at)}
                      </div>
                    )}
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(data.status)}`}
                  >
                    {getAssignmentStatusLabel(data.status)}
                  </span>
                </div>
              </div>

              {/* Student Response with History Column */}
              <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {previewEntry ? (
                      <span className="text-blue-600 dark:text-blue-400">
                        Previewing save from {formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'MMM d, h:mm a')}
                      </span>
                    ) : (
                      'Student response'
                    )}
                  </span>
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 select-none">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 dark:border-gray-600"
                      checked={showPlainText}
                      onChange={(e) => setShowPlainText(e.target.checked)}
                    />
                    Plain text
                  </label>
                </div>

                {/* Main Content Area: Response + History Column */}
                <div className="flex flex-col md:flex-row">
                  {/* Student Response */}
                  <div className="flex-1 p-4 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700">
                    {data.doc && data.doc.content && !isEmpty(data.doc.content) ? (
                      <div className="min-h-[300px]">
                        <div className={previewEntry ? 'ring-2 ring-blue-400 dark:ring-blue-600 rounded-lg p-2' : ''}>
                          <RichTextViewer
                            content={previewContent || data.doc.content}
                            showPlainText={showPlainText}
                          />
                        </div>
                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                          {countCharacters(previewContent || data.doc.content)} characters
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                        No work submitted yet
                      </div>
                    )}

                  </div>

                  {/* History Column (Desktop) */}
                  <div
                    className="hidden md:block w-60 bg-gray-50 dark:bg-gray-950 overflow-y-auto"
                    style={{ maxHeight: '500px' }}
                    onMouseLeave={handleExitPreview}
                  >
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
                                      onClick={() => handlePreviewLock(entry)}
                                      onMouseEnter={() => handlePreviewHover(entry)}
                                      className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                                        isActive
                                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                                          : 'hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono">
                                            {formatInTimeZone(new Date(entry.created_at), 'America/Toronto', 'h:mm a')}
                                          </span>
                                          <span
                                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getTriggerBadgeClasses(entry.trigger)}`}
                                          >
                                            {entry.trigger}
                                          </span>
                                        </div>
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
                    {isPreviewLocked && previewEntry && (
                      <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700">
                        <Button onClick={handleExitPreview} variant="secondary" className="w-full">
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Mobile History Drawer */}
                <div className="md:hidden border-t border-gray-200 dark:border-gray-700">
                  <details
                    className="group"
                    onToggle={(event) => {
                      const target = event.currentTarget
                      if (!target.open) {
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
                                        onClick={() => handlePreviewLock(entry)}
                                        className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                                          isActive
                                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                                            : 'bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono">
                                              {formatInTimeZone(new Date(entry.created_at), 'America/Toronto', 'h:mm a')}
                                            </span>
                                            <span
                                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getTriggerBadgeClasses(entry.trigger)}`}
                                            >
                                              {entry.trigger}
                                            </span>
                                          </div>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
