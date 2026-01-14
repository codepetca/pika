'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import type { Assignment, AssignmentDoc, AssignmentStatus } from '@/types'

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
  canGoPrev?: boolean
  canGoNext?: boolean
  onGoPrev?: () => void
  onGoNext?: () => void
}

export function TeacherStudentWorkPanel({
  assignmentId,
  studentId,
  canGoPrev = false,
  canGoNext = false,
  onGoPrev,
  onGoNext,
}: TeacherStudentWorkPanelProps) {
  const [data, setData] = useState<StudentWorkData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    setData(null)

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

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 text-sm text-gray-600 dark:text-gray-300">No data</div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with student name and navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {data.student?.name || data.student?.email || 'Student'}
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button
            type="button"
            onClick={onGoPrev}
            disabled={!canGoPrev}
            className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Previous student"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onGoNext}
            disabled={!canGoNext}
            className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Next student"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {data.doc && data.doc.content && !isEmpty(data.doc.content) ? (
          <div>
            <RichTextViewer content={data.doc.content} />
            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              {countCharacters(data.doc.content)} characters
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
            No work submitted yet
          </div>
        )}
      </div>
    </div>
  )
}
