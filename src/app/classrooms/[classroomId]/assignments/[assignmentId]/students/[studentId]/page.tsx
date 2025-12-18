'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/RichTextViewer'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import {
  formatDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass
} from '@/lib/assignments'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import type { Assignment, AssignmentDoc, AssignmentStatus } from '@/types'

interface StudentWorkData {
  assignment: Assignment
  classroom: {
    id: string
    title: string
  }
  student: {
    id: string
    email: string
    name: string | null
  }
  doc: AssignmentDoc | null
  status: AssignmentStatus
}

export default function StudentWorkPage() {
  const params = useParams()
  const router = useRouter()

  const classroomId = params.classroomId as string
  const assignmentId = params.assignmentId as string
  const studentId = params.studentId as string

  const [data, setData] = useState<StudentWorkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showPlainText, setShowPlainText] = useState(false)

  useEffect(() => {
    loadStudentWork()
  }, [assignmentId, studentId])

  async function loadStudentWork() {
    try {
      const response = await fetch(
        `/api/teacher/assignments/${assignmentId}/students/${studentId}`
      )
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load student work')
      }

      setData(result)
    } catch (err: any) {
      console.error('Error loading student work:', err)
      setError(err.message || 'Failed to load student work')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <p className="text-red-600 mb-4">{error || 'Student work not found'}</p>
          <button
            onClick={() => router.back()}
            className="text-blue-600 hover:text-blue-700"
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  const { assignment, classroom, student, doc, status } = data

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <PageLayout>
        <PageActionBar
          primary={
            <div className="min-w-0">
              <button
                type="button"
                className={ACTIONBAR_BUTTON_CLASSNAME}
                onClick={() => router.push(`/classrooms/${classroomId}/assignments/${assignmentId}`)}
              >
                Back to assignment
              </button>
              <div className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {student.name || student.email}
              </div>
              {student.name && (
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  {student.email}
                </div>
              )}
              {doc?.submitted_at && (
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  Submitted:{' '}
                  {new Date(doc.submitted_at).toLocaleString('en-CA', {
                    timeZone: 'America/Toronto',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
              )}
            </div>
          }
          actions={
            [
              {
                id: 'plain-text',
                label: showPlainText ? 'Plain text ✓' : 'Plain text',
                onSelect: () => setShowPlainText((prev) => !prev),
              },
            ] satisfies ActionBarItem[]
          }
        />

        <PageContent className="space-y-6">
          {/* Assignment Info */}
          <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-medium text-gray-900 dark:text-gray-100 truncate">{assignment.title}</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Due: {formatDueDate(assignment.due_at)}
                </p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(status)}`}>
                {getAssignmentStatusLabel(status)}
              </span>
            </div>
          </div>

          {/* Student Work */}
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Student Response</div>
              {doc && doc.content && !isEmpty(doc.content) ? (
                <div className="min-h-[200px]">
                  <RichTextViewer content={doc.content} showPlainText={showPlainText} />
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {countCharacters(doc.content)} characters
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  No work submitted yet
                </div>
              )}
            </div>

            {doc?.updated_at && (
              <div className="px-4 pb-4">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Last updated:{' '}
                  {new Date(doc.updated_at).toLocaleString('en-CA', {
                    timeZone: 'America/Toronto',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            )}
          </div>
        </PageContent>
      </PageLayout>
    </div>
  )
}
