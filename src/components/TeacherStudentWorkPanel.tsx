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

  // Load student work
  useEffect(() => {
    setLoading(true)
    setError('')
    setData(null)
    handleExitPreview()

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

      {/* Main content area: Student work + History side by side */}
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

        {/* History panel */}
        <div
          className="w-48 border-l border-border bg-page flex flex-col min-h-0"
          onMouseLeave={handleHistoryMouseLeave}
        >
          <div className="px-3 py-2 border-b border-border">
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
        </div>
      </div>
    </div>
  )
}
