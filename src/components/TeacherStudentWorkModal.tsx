'use client'

import { useEffect, useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/RichTextViewer'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import { formatDueDate, getAssignmentStatusBadgeClass, getAssignmentStatusLabel } from '@/lib/assignments'
import type { Assignment, AssignmentDoc, AssignmentStatus } from '@/types'

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

  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

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

              <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Student response</span>
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

                <div className="p-4">
                  {data.doc && data.doc.content && !isEmpty(data.doc.content) ? (
                    <div className="min-h-[300px]">
                      <RichTextViewer content={data.doc.content} showPlainText={showPlainText} />
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {countCharacters(data.doc.content)} characters
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                      No work submitted yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

